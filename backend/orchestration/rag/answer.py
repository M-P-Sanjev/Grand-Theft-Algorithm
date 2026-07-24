from __future__ import annotations

import os
import re
from typing import Any

from backend.orchestration.privacy import strip_pii_for_llm
from backend.orchestration.rag.intent import detect_intent
from backend.orchestration.rag.retrieve import retrieve

LEGAL_SYSTEM = (
    'You are a cautious Indian legal-information assistant for domestic violence survivors. '
    'Use ONLY the retrieved knowledge snippets plus the question. '
    'Give practical, real-world steps tailored to THIS question. '
    'This is general information, not formal legal advice. Keep under 180 words.'
)

THERAPY_SYSTEM = (
    'You are a trauma-informed psychological first-aid assistant. '
    'Answer THIS specific message with warmth and concrete steps. '
    'Use retrieved knowledge. No diagnosis. Under 160 words. '
    'Urge 112 / 1091 if danger or self-harm appears.'
)


def _gemini_generate(system: str, prompt: str) -> str | None:
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        return None
    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(os.getenv('GEMINI_CHAT_MODEL', 'gemini-2.0-flash'))
        text = model.generate_content(f'{system}\n\n{prompt}').text or ''
        return text.strip() or None
    except Exception:
        return None


def _clean_chunk(text: str) -> str:
    text = (text or '').strip()
    lines = []
    for line in text.split('\n'):
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        if s.startswith('- '):
            lines.append(s[2:].strip())
        else:
            lines.append(s)
    return ' '.join(lines)


def _pick_sentences(text: str, limit: int = 2) -> str:
    cleaned = _clean_chunk(text)
    parts = re.split(r'(?<=[.!?])\s+', cleaned)
    parts = [p.strip() for p in parts if len(p.strip()) > 25]
    return ' '.join(parts[:limit])


def _synthesize_local(
    domain: str,
    question: str,
    intent: str,
    hits: list[dict[str, Any]],
) -> str:
    q = question.strip()
    top = hits[0] if hits else None
    second = hits[1] if len(hits) > 1 else None
    fact1 = _pick_sentences(top['text'], 2) if top else ''
    fact2 = _pick_sentences(second['text'], 1) if second else ''

    if domain == 'legal':
        disclaimer = 'General information only — not a substitute for a lawyer.'
        if intent == 'child_harm':
            body = (
                f'You said someone harmed a child (“{q}”). Treat this as urgent. '
                f'Call **112** or women helpline **1091** now and ask for the women’s cell / PCR. '
                f'If the child is injured, seek medical care and request an MLC record. '
                f'You can file an FIR for assault/cruelty and also seek DV Act protection through a '
                f'Protection Officer or NGO — both can run together. '
                f'{fact1} '
                f'{fact2} '
                f'Next step: get to a safe place with the child, then call 112/1091 and ask an NGO '
                f'to accompany you for reporting.'
            )
        elif intent == 'physical_assault':
            body = (
                f'For physical violence like you described (“{q}”), prioritize safety and medical care. '
                f'Call **112** / **1091** if the abuser is nearby or injuries are serious. '
                f'You may lodge an FIR (Zero FIR is allowed at any station) and separately seek a '
                f'protection order under the DV Act via a Magistrate or Protection Officer. '
                f'{fact1} '
                f'{fact2} '
                f'Next step: document injuries safely, then contact police or an NGO desk today.'
            )
        elif intent == 'verbal_abuse':
            body = (
                f'Verbal abuse and threats (“{q}”) can still support civil protection under the DV Act, '
                f'and serious harassment/cruelty may also have criminal pathways. '
                f'{fact1} '
                f'{fact2} '
                f'Keep dated notes or recordings only if it is safe. '
                f'Next step: call **1091** or an NGO and ask about a protection order / counselling referral.'
            )
        elif intent == 'protection_order':
            body = (
                f'To seek a protection order: approach a Magistrate, Protection Officer, or DV service-provider NGO. '
                f'You do not always need an FIR first. '
                f'{fact1} '
                f'{fact2} '
                f'Next step: call **1091** and ask for the Protection Officer in your district.'
            )
        elif intent == 'fir':
            body = (
                f'An FIR starts a criminal investigation. You can file at the local station or use Zero FIR elsewhere. '
                f'{fact1} '
                f'{fact2} '
                f'Next step: if police refuse, ask to meet a senior officer or approach a Magistrate with NGO support.'
            )
        elif intent == 'evidence':
            body = (
                f'Safety first when collecting proof. Prefer copies the abuser cannot easily find. '
                f'{fact1} '
                f'{fact2} '
                f'Next step: store photos/messages with a trusted person or lawyer, then call **1091**.'
            )
        elif intent == 'residence':
            body = (
                f'Residence orders can help if you are being locked out or pushed from a shared household. '
                f'{fact1} '
                f'{fact2} '
                f'Next step: contact a Protection Officer / NGO before confronting the abuser about the home.'
            )
        else:
            body = (
                f'Regarding “{q}”: under India’s DV Act you can seek protection, residence, and related relief '
                f'through a Magistrate or Protection Officer; criminal options like FIR may also apply. '
                f'{fact1} '
                f'{fact2} '
                f'Next step: if unsafe now call **112** / **1091**; otherwise contact an NGO for filing help.'
            )
        return f'{disclaimer}\n\n{body.strip()}'

    # therapy
    disclaimer = 'Supportive first-aid — not a substitute for licensed care.'
    if intent == 'verbal_abuse' or intent == 'shame':
        body = (
            f'What you feel after being shouted at or humiliated (“{q}”) is a normal response to emotional abuse — '
            f'not proof you deserved it. '
            f'{fact1} '
            f'Try this now: feet on the floor, slow breath in for 4 / out for 6, three times. '
            f'Name one safe person or helpline you can reach. '
            f'{fact2} '
            f'Next step: if you are unsafe, call **112** / **1091**; otherwise do one grounding round and one trusted contact.'
        )
    elif intent == 'grounding':
        body = (
            f'For overwhelm (“{q}”), use 5-4-3-2-1 grounding: name 5 things you see, 4 you can touch, '
            f'3 you hear, 2 you smell, 1 you taste. '
            f'{fact1} '
            f'{fact2} '
            f'Next step: repeat breathing once more, then message someone safe or call **1091** if fear rises.'
        )
    elif intent == 'child_harm':
        body = (
            f'Hearing that a child was hurt is terrifying. Your job right now is safety, not perfection. '
            f'Move the child to a safer place if you can, then call **112** / **1091**. '
            f'{fact1} '
            f'{fact2} '
            f'Next step: emergency call first; then ask for medical care and a support person for the child.'
        )
    elif intent == 'safety_plan':
        body = (
            f'A simple safety plan helps when things escalate. '
            f'{fact1} '
            f'{fact2} '
            f'Next step: memorize **112** / **1091**, identify one exit, and tell one trusted person a code word.'
        )
    else:
        body = (
            f'I hear you (“{q}”). Start with safety and one calming step. '
            f'{fact1} '
            f'{fact2} '
            f'Next step: if in danger call **112** / **1091**; otherwise drink water, breathe slowly, and reach one trusted contact.'
        )
    return f'{disclaimer}\n\n{body.strip()}'


def answer_with_rag(
    domain: str,
    question: str,
    case: dict[str, Any] | None = None,
    top_k: int = 4,
) -> dict[str, Any]:
    case = case or {}
    q = (question or '').strip() or (
        'What immediate legal protections exist?'
        if domain == 'legal'
        else 'I need calming support right now.'
    )
    intent = detect_intent(domain, q)
    hits = retrieve(domain, q, top_k=top_k, intent=intent)

    context_bits = []
    for h in hits[:3]:
        context_bits.append(f"[{h.get('id')}] {h.get('title')}\n{h.get('text')}")
    retrieved = '\n\n---\n\n'.join(context_bits) or '(no chunks)'
    case_ctx = strip_pii_for_llm(case) if case else ''

    prompt = (
        f'Intent: {intent}\n'
        f'Retrieved knowledge:\n{retrieved}\n\n'
        f'Anonymized case context: {case_ctx}\n\n'
        f'User question: {q}\n\n'
        'Write a direct answer for THIS question only. Do not paste raw documents.'
    )
    system = LEGAL_SYSTEM if domain == 'legal' else THERAPY_SYSTEM
    gem = _gemini_generate(system, prompt)
    if gem:
        answer = gem
        mode = 'rag+gemini'
    else:
        answer = _synthesize_local(domain, q, intent, hits)
        mode = 'rag+local'

    sources = [
        {
            'id': h.get('id'),
            'title': h.get('title'),
            'source': h.get('source'),
            'score': round(float(h.get('score') or 0), 4),
        }
        for h in hits
    ]
    return {
        'answer': answer,
        'sources': sources,
        'mode': mode,
        'intent': intent,
        'question': q,
    }
