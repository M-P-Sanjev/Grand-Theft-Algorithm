from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

KNOWLEDGE_ROOT = Path(__file__).resolve().parents[2] / 'knowledge'
DATA_DIR = Path(__file__).resolve().parents[2] / 'data'
INDEX_PATH = DATA_DIR / 'rag_index.json'

CHUNK_SIZE = 500
CHUNK_OVERLAP = 80


def _split_text(text: str, source: str, domain: str) -> list[dict[str, Any]]:
    text = re.sub(r'\n{3,}', '\n\n', text.strip())
    chunks: list[dict[str, Any]] = []
    if not text:
        return chunks
    start = 0
    idx = 0
    while start < len(text):
        end = min(len(text), start + CHUNK_SIZE)
        if end < len(text):
            # break on paragraph/sentence if possible
            window = text[start:end]
            br = max(window.rfind('\n\n'), window.rfind('. '))
            if br > CHUNK_SIZE // 3:
                end = start + br + 1
        piece = text[start:end].strip()
        if piece:
            # Prefer first markdown heading as title
            heading = ''
            for line in piece.split('\n'):
                if line.startswith('#'):
                    heading = line.lstrip('#').strip()
                    break
            title = heading or Path(source).stem.replace('_', ' ')
            chunks.append(
                {
                    'id': f'{domain}:{Path(source).stem}:{idx}',
                    'domain': domain,
                    'source': source,
                    'title': title,
                    'text': piece,
                }
            )
            idx += 1
        if end >= len(text):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
    return chunks


def build_index() -> dict[str, Any]:
    chunks: list[dict[str, Any]] = []
    for domain in ('legal', 'therapy'):
        folder = KNOWLEDGE_ROOT / domain
        if not folder.exists():
            continue
        for path in sorted(folder.glob('*.md')):
            chunks.extend(_split_text(path.read_text(encoding='utf-8'), path.name, domain))
    index = {'version': 1, 'chunks': chunks}
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(index, indent=2), encoding='utf-8')
    return index


def load_index() -> dict[str, Any]:
    if not INDEX_PATH.exists():
        return build_index()
    try:
        return json.loads(INDEX_PATH.read_text(encoding='utf-8'))
    except Exception:
        return build_index()


def ensure_index(force: bool = False) -> dict[str, Any]:
    """Rebuild if missing, forced, or knowledge newer than index."""
    if force or not INDEX_PATH.exists():
        return build_index()
    try:
        idx_mtime = INDEX_PATH.stat().st_mtime
        newest = idx_mtime
        for domain in ('legal', 'therapy'):
            folder = KNOWLEDGE_ROOT / domain
            if not folder.exists():
                continue
            for path in folder.glob('*.md'):
                newest = max(newest, path.stat().st_mtime)
        if newest > idx_mtime:
            return build_index()
    except Exception:
        return build_index()
    return load_index()
