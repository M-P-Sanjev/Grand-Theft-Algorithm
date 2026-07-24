from __future__ import annotations

import json
import logging
import os
import uuid
from collections import defaultdict
from typing import Any, AsyncIterator

from backend.orchestration.crisis.companion import legal_plain_reply, therapy_companion_reply
from backend.orchestration.crisis.live import publish
from backend.orchestration.crisis.memory import update_memory
from backend.orchestration.crisis.pipeline import process_victim_message
from backend.orchestration.privacy import strip_pii_for_llm

logger = logging.getLogger(__name__)

_CHAT_MEMORY: dict[str, list[dict[str, str]]] = defaultdict(list)

LEGAL_SYSTEM = """You are Safra Legal Companion — a calm guide for someone facing domestic violence in India.
You are NOT a lawyer lecture bot.
RULES:
- Never use section numbers or jargon like PWDVA, CrPC, IPC unless the user asks for the formal name.
- Say "Domestic Violence Law" instead of statute codes.
- Say "a legal order that stops the abuser from contacting or hurting you" instead of dumping "Protection Order" alone.
- Short paragraphs. Plain English. End with: What would you like help with next?
- Use retrieved context only for facts; rewrite into human language.
- Never say "As an AI".
"""

THERAPY_SYSTEM = """You are Safra Crisis Companion — an experienced, warm crisis support professional.
You are NOT ChatGPT. You do NOT dump coping lists.
RULES:
- Every reply: acknowledge feeling → validate → ONE actionable step → ONE gentle question.
- Max 4 short paragraphs. Simple English. No clinical jargon. No legal jargon.
- If they say they are scared, ask if the person is with them now — do not lecture about anxiety.
- Never say "As an AI". Never sound robotic.
"""


def session_key(case_id: str, kind: str, session_id: str) -> str:
    return f'{case_id}:{kind}:{session_id}'


def get_history(case_id: str, kind: str, session_id: str) -> list[dict[str, str]]:
    return list(_CHAT_MEMORY[session_key(case_id, kind, session_id)])


def append_history(case_id: str, kind: str, session_id: str, role: str, content: str) -> None:
    key = session_key(case_id, kind, session_id)
    _CHAT_MEMORY[key].append({'role': role, 'content': content})
    _CHAT_MEMORY[key] = _CHAT_MEMORY[key][-24:]


async def stream_agent_reply(
    *,
    kind: str,
    question: str,
    case: dict[str, Any],
    session_id: str,
) -> AsyncIterator[str]:
    case_id = case.get('id') or 'unknown'
    q = (question or '').strip()
    if not q:
        yield _sse('error', {'message': 'Empty message'})
        return

    publish({'type': 'typing', 'case_id': case_id, 'role': 'victim', 'active': True})
    publish({'type': 'typing', 'case_id': case_id, 'role': 'ai', 'active': True})

    history = get_history(case_id, kind, session_id)
    yield _sse('status', {'phase': 'listening'})

    # Full crisis pipeline (emotion → severity → safety → RAG) — severity is NOT an LLM
    result = process_victim_message(case, kind=kind, message=q, history=history)
    severity = result['severity']
    safety = result['safety']
    hits = result['hits']
    emotion = result['emotion']
    memory = result['memory']
    summary = result['summary']

    yield _sse(
        'pipeline',
        {
            'stages': [
                {'id': 'incoming_note', 'label': 'User message received'},
                {'id': 'emotion_detected', 'label': f"Emotion: {emotion.get('primary')}"},
                {
                    'id': 'severity_prediction',
                    'label': f"Risk {severity.get('risk_index')} {severity.get('tier')}",
                },
                {
                    'id': 'laws_retrieved' if kind == 'legal' else 'resources_found',
                    'label': 'Knowledge retrieved' if hits else 'Care guidelines',
                },
                {'id': 'response_generation', 'label': 'Response generating'},
                {'id': 'risk_updated', 'label': 'Risk updated'},
                {'id': 'dashboard_updated', 'label': 'Dashboard sync'},
            ],
            'risk_index': severity.get('risk_index'),
            'tier': severity.get('tier'),
            'confidence': severity.get('confidence'),
            'reasons': severity.get('reasons'),
            'scores': severity.get('scores'),
            'trend': severity.get('trend'),
            'delta': severity.get('delta'),
            'emotion': emotion,
            'risk_history': case.get('risk_history'),
            'timeline': (case.get('timeline') or [])[-8:],
            'next_actions': summary.get('next_actions'),
            'ai_summary': {
                'headline': summary.get('headline'),
                'victim_profile': summary.get('victim_profile'),
                'plain_status': summary.get('plain_status'),
            },
        },
    )

    sources = [
        {
            'law_ref': _plain_ref(h),
            'section': h.get('section'),
            'title': h.get('title'),
            'source': h.get('source'),
            'confidence': h.get('confidence'),
            'score': h.get('score'),
            'snippet': (h.get('text') or '')[:180],
        }
        for h in hits
    ]

    yield _sse(
        'meta',
        {
            'sources': sources if kind == 'legal' else [],
            'confidence': severity.get('confidence'),
            'low_confidence': False,
            'mode': 'crisis-pipeline',
            'risk_index': severity.get('risk_index'),
            'tier': severity.get('tier'),
        },
    )

    # Companion replies are rule-crafted for voice; optional LLM soft rewrite under strict caps
    if kind == 'therapy':
        base = therapy_companion_reply(
            message=q,
            severity=severity,
            safety=safety,
            memory=memory,
            name=case.get('name'),
        )
    else:
        base = legal_plain_reply(message=q, hits=hits, severity=severity)

    reply = base
    api_key = os.getenv('GEMINI_API_KEY')
    if api_key and kind == 'therapy' and severity.get('tier') not in ('CRITICAL',):
        # Optional tone polish only — keep short; fall back to base on any failure
        polished = _maybe_polish(kind, base, q, case)
        if polished:
            reply = polished

    append_history(case_id, kind, session_id, 'user', q)
    yield _sse('status', {'phase': 'streaming'})
    for token in _chunk_tokens(reply):
        yield _sse('token', {'t': token})

    append_history(case_id, kind, session_id, 'assistant', reply)
    update_memory(case_id, message=q, reply=reply, emotion=emotion, case=case)

    # Persist mutable case fields if caller saved reference
    publish({'type': 'typing', 'case_id': case_id, 'role': 'ai', 'active': False})
    publish({'type': 'typing', 'case_id': case_id, 'role': 'victim', 'active': False})
    yield _sse(
        'done',
        {
            'ok': True,
            'risk_index': severity.get('risk_index'),
            'tier': severity.get('tier'),
            'live_status': case.get('live_status'),
        },
    )


def _plain_ref(h: dict[str, Any]) -> str:
    title = (h.get('title') or h.get('law_ref') or 'Support info').strip()
    low = title.lower()
    if 'pwdva' in low:
        return 'Domestic Violence Law'
    if 'section' in low and '18' in low:
        return 'Court order to stop harm'
    return title[:80]


def _maybe_polish(kind: str, base: str, question: str, case: dict[str, Any]) -> str | None:
    try:
        import google.generativeai as genai

        genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
        model = genai.GenerativeModel(
            os.getenv('GEMINI_CHAT_MODEL', 'gemini-2.0-flash'),
            system_instruction=THERAPY_SYSTEM if kind == 'therapy' else LEGAL_SYSTEM,
        )
        prompt = (
            'Rewrite the DRAFT reply to sound warmer and more human. '
            'Keep the SAME meaning and structure (acknowledge, validate, one step, one question). '
            'Max 80 words. No lists of 5 tips. No "As an AI".\n\n'
            f'Victim said: {question}\n'
            f'DRAFT:\n{base}\n\n'
            f'Case context: {strip_pii_for_llm(case)}\n'
            'Rewritten reply:'
        )
        text = (model.generate_content(prompt).text or '').strip()
        if not text or len(text) > 600:
            return None
        # Reject dumps
        if text.count('\n') > 10 or text.lower().startswith('as an ai'):
            return None
        return text
    except Exception as exc:
        logger.warning('Polish skipped: %s', exc)
        return None


def _chunk_tokens(text: str, size: int = 8) -> list[str]:
    if not text:
        return []
    # Stream by short phrases for companion feel
    parts = text.replace('\n\n', '\n').split('\n')
    out: list[str] = []
    for i, p in enumerate(parts):
        chunk = p.strip()
        if not chunk:
            out.append('\n\n')
            continue
        words = chunk.split(' ')
        buf: list[str] = []
        for w in words:
            buf.append(w)
            if len(buf) >= 4:
                out.append(' '.join(buf) + ' ')
                buf = []
        if buf:
            out.append(' '.join(buf))
        if i < len(parts) - 1:
            out.append('\n\n')
    return out or [text]


def _sse(event: str, data: dict[str, Any]) -> str:
    return f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'


def new_session_id() -> str:
    return uuid.uuid4().hex[:16]
