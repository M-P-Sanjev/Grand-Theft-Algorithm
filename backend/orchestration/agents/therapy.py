from __future__ import annotations

from typing import Any

CRISIS_KEYWORDS = (
    'kill myself',
    'suicide',
    'end my life',
    'want to die',
    'self-harm',
    'self harm',
)

CRISIS_ANSWER = (
    'I hear that you are in deep distress. Please reach emergency services or a crisis '
    'helpline **now** — call **112** or women helpline **1091**. '
    'Stay with someone if you can; go to the nearest hospital emergency if needed. '
    'You deserve urgent human care. This assistant cannot replace emergency responders.'
)


def run_therapy(case: dict[str, Any], question: str | None = None) -> dict[str, Any]:
    from backend.orchestration.rag.answer import answer_with_rag

    q = (question or '').strip() or 'I need calming support right now.'
    blob = f"{q} {(case.get('notes') or '')}".lower()
    escalate_human = any(k in blob for k in CRISIS_KEYWORDS)

    if escalate_human:
        return {
            'agent': 'therapy',
            'source': 'crisis-rules',
            'question': q,
            'answer': CRISIS_ANSWER,
            'sources': [
                {
                    'id': 'therapy:04_crisis_escalation:0',
                    'title': 'Crisis escalation',
                    'source': '04_crisis_escalation.md',
                    'score': 1.0,
                }
            ],
            'escalate_human': True,
            'message': CRISIS_ANSWER[:240],
            'rationale': 'Crisis first-aid — escalate human',
        }

    rag = answer_with_rag('therapy', q, case)
    answer = rag['answer']
    return {
        'agent': 'therapy',
        'source': rag['mode'],
        'question': rag['question'],
        'answer': answer,
        'sources': rag.get('sources') or [],
        'intent': rag.get('intent'),
        'escalate_human': False,
        'message': answer[:240],
        'rationale': f"RAG therapy ({rag['mode']}/{rag.get('intent')})",
    }
