"""Streaming specialized Crisis + Legal companions."""

from __future__ import annotations

import json
import logging
import os
import uuid
from collections import defaultdict
from typing import Any, AsyncIterator

from backend.orchestration.crisis.companion import (
    CRISIS_IDENTITY,
    LEGAL_IDENTITY,
    collaborate_reply,
    crisis_companion_reply,
    legal_companion_reply,
)
from backend.orchestration.crisis.live import publish
from backend.orchestration.crisis.memory import get_memory, update_memory
from backend.orchestration.crisis.pipeline import process_victim_message
from backend.orchestration.privacy import strip_pii_for_llm
from backend.orchestration.rag.router import route_message

logger = logging.getLogger(__name__)

_CHAT_MEMORY: dict[str, list[dict[str, str]]] = defaultdict(list)

# Single source of truth — specialized agent identities
LEGAL_SYSTEM = LEGAL_IDENTITY + """
RESPONSE FORMAT (always):
1. Short answer
2. Why this law applies
3. What the victim can do today
4. Documents to keep
5. Emergency option
6. Sources
Use retrieved context only for facts. Plain English. No jargon dumps.
Never say "As an AI".
"""

THERAPY_SYSTEM = CRISIS_IDENTITY + """
Every reply: acknowledge → validate → ONE step → ONE question.
If CRITICAL: emergency questions only (move room / call 112 / alone?).
Max 4 short paragraphs. No clinical jargon. No legal jargon.
Never say "As an AI". Never sound robotic.
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

    route = route_message(q)
    yield _sse(
        'route',
        {
            'primary': route['primary'],
            'therapy': route.get('therapy'),
            'legal': route.get('legal'),
            'panel': kind,
            'suggest_switch': (
                (kind == 'therapy' and route['primary'] == 'legal')
                or (kind == 'legal' and route['primary'] == 'therapy')
            ),
            'collaborate': route['primary'] == 'both',
        },
    )

    result = process_victim_message(case, kind=kind, message=q, history=history)
    severity = result['severity']
    safety = result['safety']
    hits = result['hits']
    emotion = result['emotion']
    summary = result['summary']

    crisis_mem = get_memory(case_id, 'therapy')
    legal_mem = get_memory(case_id, 'legal')

    yield _sse(
        'pipeline',
        {
            'stages': [
                {'id': 'incoming_note', 'label': 'Message received'},
                {'id': 'emotion_detected', 'label': f"Emotion: {emotion.get('primary')}"},
                {
                    'id': 'severity_prediction',
                    'label': f"Risk {severity.get('risk_index')} {severity.get('tier')}",
                },
                {
                    'id': 'laws_retrieved' if kind == 'legal' else 'resources_found',
                    'label': 'Legal knowledge' if kind == 'legal' else 'Care guidelines',
                },
                {
                    'id': 'response_generation',
                    'label': (
                        'Crisis companion responding'
                        if kind == 'therapy'
                        else 'Legal companion responding'
                    ),
                },
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
            'agent': 'crisis' if kind == 'therapy' else 'legal',
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
            'sources': sources if kind == 'legal' or route['primary'] == 'both' else [],
            'confidence': severity.get('confidence'),
            'low_confidence': False,
            'mode': 'specialized-agent',
            'agent': 'crisis' if kind == 'therapy' else 'legal',
            'risk_index': severity.get('risk_index'),
            'tier': severity.get('tier'),
        },
    )

    # --- Specialized generation ---
    use_collab = route['primary'] == 'both' and kind in ('therapy', 'legal')
    if use_collab:
        # Fetch legal hits if therapy panel triggered collab
        legal_hits = hits
        if kind == 'therapy':
            try:
                from backend.orchestration.rag.mongo_store import vector_search

                legal_hits = vector_search('legal', q, top_k=4) or hits
            except Exception:
                legal_hits = hits
        base = collaborate_reply(
            message=q,
            severity=severity,
            safety=safety,
            hits=legal_hits,
            crisis_memory=crisis_mem,
            legal_memory=legal_mem,
            name=case.get('name'),
        )
    elif kind == 'therapy':
        base = crisis_companion_reply(
            message=q,
            severity=severity,
            safety=safety,
            memory=crisis_mem,
            name=case.get('name'),
            history=history,
        )
    else:
        base = legal_companion_reply(
            message=q,
            hits=hits,
            severity=severity,
            memory=legal_mem,
        )

    reply = base
    # Soft polish with agent-specific system prompt (never for CRITICAL crisis)
    if os.getenv('GEMINI_API_KEY') and not (
        kind == 'therapy' and severity.get('tier') == 'CRITICAL'
    ):
        polished = _maybe_polish(kind, base, q, case, hits if kind == 'legal' else [])
        if polished:
            reply = polished

    append_history(case_id, kind, session_id, 'user', q)
    yield _sse('status', {'phase': 'streaming'})
    for token in _chunk_tokens(reply):
        yield _sse('token', {'t': token})

    append_history(case_id, kind, session_id, 'assistant', reply)
    update_memory(
        case_id,
        message=q,
        reply=reply,
        emotion=emotion,
        case=case,
        kind=kind,
    )
    if use_collab:
        update_memory(case_id, message=q, reply=reply, emotion=emotion, case=case, kind='legal')
        update_memory(case_id, message=q, reply=reply, emotion=emotion, case=case, kind='therapy')

    publish({'type': 'typing', 'case_id': case_id, 'role': 'ai', 'active': False})
    publish({'type': 'typing', 'case_id': case_id, 'role': 'victim', 'active': False})
    yield _sse(
        'done',
        {
            'ok': True,
            'risk_index': severity.get('risk_index'),
            'tier': severity.get('tier'),
            'live_status': case.get('live_status'),
            'agent': 'crisis' if kind == 'therapy' else 'legal',
            'route': route['primary'],
        },
    )


def _plain_ref(h: dict[str, Any]) -> str:
    title = (h.get('title') or h.get('law_ref') or 'Legal source').strip()
    return title[:80]


def _maybe_polish(
    kind: str,
    base: str,
    question: str,
    case: dict[str, Any],
    hits: list[dict[str, Any]],
) -> str | None:
    try:
        import google.generativeai as genai

        genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
        system = THERAPY_SYSTEM if kind == 'therapy' else LEGAL_SYSTEM
        model = genai.GenerativeModel(
            os.getenv('GEMINI_CHAT_MODEL', 'gemini-2.0-flash'),
            system_instruction=system,
        )
        rag_block = ''
        if hits:
            rag_block = 'Retrieved law snippets:\n' + '\n'.join(
                f"- {(h.get('title') or '')}: {(h.get('text') or '')[:280]}" for h in hits[:3]
            )
        if kind == 'therapy':
            prompt = (
                'Rewrite the DRAFT to sound like a calm crisis support volunteer. '
                'Keep the SAME meaning. One step. One question. Max 90 words. '
                'No "As an AI". No lists of 5 tips.\n\n'
                f'Victim said: {question}\nDRAFT:\n{base}\n\n'
                f'Context: {strip_pii_for_llm(case)}\nRewritten:'
            )
        else:
            prompt = (
                'Rewrite the DRAFT as a plain-English legal aid officer. '
                'Keep structure: short answer, why law applies, today steps, documents, emergency, sources. '
                'Ground facts in retrieved snippets. No invented section numbers. Max 220 words.\n\n'
                f'Question: {question}\n{rag_block}\n\nDRAFT:\n{base}\n\nRewritten:'
            )
        text = (model.generate_content(prompt).text or '').strip()
        if not text or len(text) > 1400:
            return None
        if text.lower().startswith('as an ai') or 'as an ai' in text.lower()[:40]:
            return None
        return text
    except Exception as exc:
        logger.warning('Polish skipped: %s', exc)
        return None


def _chunk_tokens(text: str, size: int = 8) -> list[str]:
    if not text:
        return []
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
