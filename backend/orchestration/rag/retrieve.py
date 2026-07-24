from __future__ import annotations

import math
import os
import re
from collections import Counter
from typing import Any

from backend.orchestration.rag.ingest import ensure_index
from backend.orchestration.rag.intent import detect_intent, preferred_sources, rewrite_query

TOKEN_RE = re.compile(r'[a-z0-9]{2,}', re.I)


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in TOKEN_RE.findall(text or '')]


def _tfidf_vectors(docs: list[list[str]]) -> tuple[list[dict[str, float]], dict[str, float]]:
    df: Counter[str] = Counter()
    for toks in docs:
        df.update(set(toks))
    n = max(len(docs), 1)
    idf = {t: math.log((n + 1) / (df[t] + 1)) + 1.0 for t in df}
    vectors: list[dict[str, float]] = []
    for toks in docs:
        tf = Counter(toks)
        length = max(len(toks), 1)
        vectors.append({t: (c / length) * idf.get(t, 0.0) for t, c in tf.items()})
    return vectors, idf


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    keys = set(a) | set(b)
    dot = sum(a.get(k, 0.0) * b.get(k, 0.0) for k in keys)
    na = math.sqrt(sum(v * v for v in a.values())) or 1e-9
    nb = math.sqrt(sum(v * v for v in b.values())) or 1e-9
    return dot / (na * nb)


def _gemini_embed(texts: list[str]) -> list[list[float]] | None:
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key or not texts:
        return None
    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        out: list[list[float]] = []
        for text in texts:
            resp = genai.embed_content(
                model=os.getenv('GEMINI_EMBED_MODEL', 'models/gemini-embedding-001'),
                content=text[:8000],
                task_type='retrieval_document',
                output_dimensionality=768,
            )
            emb = resp.get('embedding') if isinstance(resp, dict) else None
            if emb is None and hasattr(resp, 'embedding'):
                emb = resp.embedding  # type: ignore[attr-defined]
            if not emb:
                return None
            out.append(list(emb))
        return out
    except Exception:
        return None


def _cosine_dense(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(y * y for y in b)) or 1e-9
    return dot / (na * nb)


def retrieve(
    domain: str,
    query: str,
    top_k: int = 4,
    *,
    intent: str | None = None,
) -> list[dict[str, Any]]:
    index = ensure_index()
    chunks = [c for c in index.get('chunks') or [] if c.get('domain') == domain]
    if not chunks:
        return []

    intent_name = intent or detect_intent(domain, query)
    search_q = rewrite_query(domain, query, intent_name)  # type: ignore[arg-type]
    preferred = preferred_sources(domain, intent_name)  # type: ignore[arg-type]

    def searchable(c: dict[str, Any]) -> str:
        return f"{c.get('title') or ''} {c.get('source') or ''} {c.get('text') or ''}"

    q_emb = _gemini_embed([search_q])
    if q_emb:
        doc_embs = _gemini_embed([searchable(c) for c in chunks])
        if doc_embs and len(doc_embs) == len(chunks):
            scored = []
            for c, de in zip(chunks, doc_embs):
                score = _cosine_dense(q_emb[0], de)
                src = c.get('source') or ''
                for i, pref in enumerate(preferred):
                    if pref == src:
                        score += 0.35 - i * 0.05
                scored.append({**c, 'score': score, 'intent': intent_name})
            scored.sort(key=lambda x: x['score'], reverse=True)
            return scored[:top_k]

    docs = [_tokenize(searchable(c)) for c in chunks]
    vectors, idf = _tfidf_vectors(docs)
    q_toks = _tokenize(search_q)
    q_tf = Counter(q_toks)
    q_len = max(len(q_toks), 1)
    q_vec = {t: (c / q_len) * idf.get(t, 0.0) for t, c in q_tf.items()}

    scored = []
    ql = query.lower()
    for c, v in zip(chunks, vectors):
        score = _cosine(q_vec, v)
        blob = searchable(c).lower()
        src = c.get('source') or ''
        for i, pref in enumerate(preferred):
            if pref == src:
                score += 0.45 - i * 0.08
        for kw, boost in (
            ('child', 0.35),
            ('hit', 0.2),
            ('shout', 0.3),
            ('yell', 0.3),
            ('protection order', 0.3),
            ('residence', 0.2),
            ('fir', 0.25),
            ('evidence', 0.2),
            ('helpline', 0.2),
            ('1091', 0.2),
            ('ground', 0.35),
            ('breath', 0.3),
            ('panic', 0.25),
            ('shame', 0.25),
            ('safety plan', 0.3),
            ('verbal', 0.25),
            ('emotional', 0.25),
        ):
            if kw in ql and kw in blob:
                score += boost
        scored.append({**c, 'score': score, 'intent': intent_name})

    scored.sort(key=lambda x: x['score'], reverse=True)
    return [s for s in scored[:top_k] if s['score'] > 0] or scored[: min(top_k, 2)]
