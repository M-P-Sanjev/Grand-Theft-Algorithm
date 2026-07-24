from __future__ import annotations

from typing import Any


def run_legal(case: dict[str, Any], question: str | None = None) -> dict[str, Any]:
    from backend.orchestration.rag.answer import answer_with_rag

    q = (question or '').strip() or 'What immediate legal protections exist?'
    rag = answer_with_rag('legal', q, case)
    answer = rag['answer']
    return {
        'agent': 'legal',
        'source': rag['mode'],
        'question': rag['question'],
        'answer': answer,
        'sources': rag.get('sources') or [],
        'intent': rag.get('intent'),
        'message': answer[:240],
        'rationale': f"RAG legal ({rag['mode']}/{rag.get('intent')})",
    }
