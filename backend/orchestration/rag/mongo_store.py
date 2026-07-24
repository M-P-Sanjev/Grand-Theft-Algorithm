from __future__ import annotations

import hashlib
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

load_dotenv()
load_dotenv('backend/.env')

logger = logging.getLogger(__name__)

KNOWLEDGE_ROOT = Path(__file__).resolve().parents[2] / 'knowledge'
VECTOR_INDEX = os.getenv('MONGO_RAG_INDEX', 'rag_vector_index')
COLLECTION = os.getenv('MONGO_RAG_COLLECTION', 'rag_chunks')
# gemini-embedding-001 with output_dimensionality=768
EMBED_DIMS = 768
EMBED_MODEL = os.getenv('GEMINI_EMBED_MODEL', 'models/gemini-embedding-001')


def _mongo_db():
    uri = os.getenv('MONGO_ENDPOINT')
    if not uri:
        return None
    try:
        from pymongo import MongoClient

        client = MongoClient(uri, serverSelectionTimeoutMS=4000)
        client.admin.command('ping')
        db_name = os.getenv('MONGO_DB_NAME', 'SheBuilds')
        return client[db_name]
    except Exception as exc:
        logger.warning('Mongo unavailable for RAG: %s', exc)
        return None


def embed_text(text: str, *, task: str = 'retrieval_document') -> Optional[list[float]]:
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        return None
    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        resp = genai.embed_content(
            model=EMBED_MODEL,
            content=(text or '')[:8000],
            task_type=task,
            output_dimensionality=EMBED_DIMS,
        )
        emb = resp.get('embedding') if isinstance(resp, dict) else getattr(resp, 'embedding', None)
        if not emb:
            return None
        return list(emb)
    except Exception as exc:
        logger.warning('Embed failed: %s', exc)
        return None


def _chunk_markdown(path: Path, domain: str) -> list[dict[str, Any]]:
    raw = path.read_text(encoding='utf-8')
    parts = re.split(r'\n(?=## )', raw)
    out: list[dict[str, Any]] = []
    for i, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue
        lines = part.split('\n')
        title = lines[0].lstrip('#').strip() if lines else path.stem
        # Extract section-like refs
        section_m = re.search(r'Section\s+(\d+[A-Za-z]*)', part, re.I)
        law_m = re.search(
            r'(Protection of Women from Domestic Violence Act|IPC|CrPC|BNS|PWDVA)[^\n.]{0,40}',
            part,
            re.I,
        )
        body = '\n'.join(lines[1:]).strip() if len(lines) > 1 else part
        text = f'{title}\n{body}'.strip()
        cid = hashlib.sha1(f'{domain}:{path.name}:{i}:{title}'.encode()).hexdigest()[:24]
        out.append(
            {
                '_id': cid,
                'domain': domain,
                'source': path.name,
                'title': title[:120],
                'text': text[:4000],
                'section': section_m.group(0) if section_m else title[:80],
                'law_ref': law_m.group(0).strip() if law_m else (
                    'PWDVA / Indian DV framework' if domain == 'legal' else 'Mental health first-aid'
                ),
            }
        )
    return out


def seed_knowledge_to_mongo(force: bool = False) -> dict[str, Any]:
    """Embed local knowledge markdown into Atlas collection for vector search."""
    db = _mongo_db()
    if db is None:
        return {'ok': False, 'reason': 'mongo_unavailable'}
    col = db[COLLECTION]
    existing = col.estimated_document_count()
    if existing > 0 and not force:
        return {'ok': True, 'skipped': True, 'count': existing}

    docs: list[dict[str, Any]] = []
    for domain in ('legal', 'therapy'):
        folder = KNOWLEDGE_ROOT / domain
        if not folder.exists():
            continue
        for path in sorted(folder.glob('*.md')):
            docs.extend(_chunk_markdown(path, domain))

    upserted = 0
    for d in docs:
        emb = embed_text(d['text'])
        if not emb:
            # still store without embedding for text fallback
            d['embedding'] = None
        else:
            d['embedding'] = emb
        col.update_one({'_id': d['_id']}, {'$set': d}, upsert=True)
        upserted += 1

    return {'ok': True, 'upserted': upserted}


def vector_search(domain: str, query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """Atlas $vectorSearch when available; else local TF-IDF fallback via orchestration.rag."""
    q_emb = embed_text(query, task='retrieval_query')
    db = _mongo_db()
    hits: list[dict[str, Any]] = []

    if db is not None and q_emb is not None:
        col = db[COLLECTION]
        # Prefer unfiltered vector search + Python domain filter so indexes without
        # a `domain` filter field still work (M0 default JSON often omits filters).
        try:
            pipeline = [
                {
                    '$vectorSearch': {
                        'index': VECTOR_INDEX,
                        'path': 'embedding',
                        'queryVector': q_emb,
                        'numCandidates': max(80, top_k * 20),
                        'limit': max(top_k * 6, 12),
                    }
                },
                {
                    '$project': {
                        'title': 1,
                        'text': 1,
                        'source': 1,
                        'section': 1,
                        'law_ref': 1,
                        'domain': 1,
                        'score': {'$meta': 'vectorSearchScore'},
                    }
                },
            ]
            raw = list(col.aggregate(pipeline))
            hits = [d for d in raw if (d.get('domain') or '') == domain][:top_k]
            if not hits:
                hits = raw[:top_k]
        except Exception as exc:
            logger.warning('vectorSearch failed, trying text filter: %s', exc)
            # Fallback: keyword regex over stored chunks
            try:
                tokens = [t for t in re.findall(r'[a-zA-Z]{4,}', query.lower())][:6]
                rx = '|'.join(map(re.escape, tokens)) if tokens else 'protection'
                cur = col.find(
                    {'domain': domain, 'text': {'$regex': rx, '$options': 'i'}},
                    {'title': 1, 'text': 1, 'source': 1, 'section': 1, 'law_ref': 1},
                ).limit(top_k)
                hits = [{**d, 'score': 0.5} for d in cur]
            except Exception:
                hits = []

    if not hits:
        from backend.orchestration.rag.retrieve import retrieve

        local = retrieve(domain, query, top_k=top_k)
        for h in local:
            hits.append(
                {
                    'title': h.get('title'),
                    'text': h.get('text'),
                    'source': h.get('source'),
                    'section': h.get('title'),
                    'law_ref': h.get('source'),
                    'score': float(h.get('score') or 0),
                }
            )

    # Normalize
    out = []
    for h in hits:
        score = float(h.get('score') or 0)
        # Atlas scores often 0-1; local tfidf too
        conf = min(0.99, max(0.15, score if score <= 1.5 else score / 2))
        out.append(
            {
                'title': h.get('title') or 'Source',
                'text': h.get('text') or '',
                'source': h.get('source') or '',
                'section': h.get('section') or h.get('title') or '',
                'law_ref': h.get('law_ref') or h.get('section') or '',
                'score': round(score, 4),
                'confidence': round(conf, 3),
            }
        )
    return out
