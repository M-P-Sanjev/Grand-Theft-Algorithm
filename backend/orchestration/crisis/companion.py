"""Specialized Crisis Companion + Legal Companion agents.

Two distinct professionals — not a shared generic chatbot voice.
"""

from __future__ import annotations

import re
from typing import Any

from backend.orchestration.crisis.memory import next_crisis_question, mark_question_asked


CRISIS_IDENTITY = """You are an experienced crisis support companion.
You are NOT a psychologist. You are NOT a doctor. You are NOT an AI assistant.
You are a calm human-like crisis support volunteer.
Primary goal: reduce panic, help clear thinking, assess immediate danger, guide one step at a time.
Never overwhelm. Always ask one question at a time.
Warm, calm, patient, supportive, natural. Never robotic.
Never say "As an AI", "I cannot", or "I am unable".
Say "I'm here with you", "We'll go one step at a time", "Let's focus on keeping you safe."
"""

LEGAL_IDENTITY = """You are an Indian legal guidance assistant specializing in domestic violence law.
Never pretend to be a lawyer. Never invent statutes.
Every answer must be grounded in retrieved legal documents (PWDVA, IPC/BNS, CrPC/BNSS, BSA, NALSA, guidelines).
Plain English only. Short structured answers. No jargon dumps.
"""


def crisis_companion_reply(
    *,
    message: str,
    severity: dict[str, Any],
    safety: dict[str, Any],
    memory: dict[str, Any],
    name: str | None = None,
    history: list[dict[str, str]] | None = None,
) -> str:
    """Crisis support volunteer voice — danger-tier aware, one question at a time."""
    flags = severity.get('flags') or {}
    tier = (severity.get('tier') or 'MEDIUM').upper()
    emotion = (severity.get('emotion') or {}).get('primary') or 'distress'
    low = (message or '').lower()
    who = (name or '').split(' ')[0] if name and name != 'Anonymous' else ''
    greet = f'{who}, ' if who else ''

    # Self-harm — immediate life safety
    if flags.get('self_harm') or any(
        x in low for x in ('kill myself', 'want to die', 'suicid', 'end my life')
    ):
        mark_question_asked(memory, 'stay_with_someone')
        return (
            f"{greet}I'm really glad you told me. I'm here with you.\n\n"
            "Your safety matters more than anything else right now.\n\n"
            "Please call 112 or 1091 now, or go to the nearest hospital.\n\n"
            "Is there someone who can stay with you while you reach help?"
        )

    # CRITICAL — emergency mode, short questions only
    if tier == 'CRITICAL' or flags.get('abuser_present_now') or flags.get('weapon'):
        q = next_crisis_question(memory, flags, tier='CRITICAL')
        mark_question_asked(memory, _question_key(q))
        return (
            f"{greet}I'm here with you. Let's focus on keeping you safe.\n\n"
            f"{safety.get('primary_step') or 'If you can, move somewhere he cannot hear you.'}\n\n"
            f"{q}"
        )

    # HIGH — safety first, no long explanations
    if tier == 'HIGH' or any(
        x in low for x in ('hit me', 'beat me', 'slapped', 'punched', 'hurt me', 'bleeding', 'weapon', 'knife', 'bat')
    ):
        q = next_crisis_question(memory, flags, tier='HIGH')
        mark_question_asked(memory, _question_key(q))
        return (
            f"{greet}I'm really sorry that happened. You didn't deserve that.\n\n"
            "We'll go one step at a time.\n\n"
            f"{q}"
        )

    # LOW / MEDIUM — emotional support + one coping step + one question
    ack = {
        'sadness': "That sounds so heavy to carry.",
        'shame': "None of this is your fault.",
        'anger': "Your anger is valid — something wrong was done to you.",
        'numb': "Feeling numb after harm is more common than people admit.",
        'fear': "Feeling scared makes complete sense after what you've been through.",
        'hope': "I'm glad a little hope is showing up.",
    }.get(emotion, "Thank you for trusting me with this.")

    if re.search(r"\b(i('m| am) (okay|safe|fine))\b", low):
        q = next_crisis_question(memory, flags, tier='LOW')
        mark_question_asked(memory, _question_key(q))
        return (
            f"{greet}I'm relieved to hear you feel a little safer.\n\n"
            "We'll take this slowly — nothing has to be decided all at once.\n\n"
            f"{q}"
        )

    step = _coping_step(tier, emotion, safety)
    q = next_crisis_question(memory, flags, tier=tier)
    mark_question_asked(memory, _question_key(q))
    return f"{greet}{ack}\n\n{step}\n\n{q}"


# Backward-compatible alias
therapy_companion_reply = crisis_companion_reply


def legal_companion_reply(
    *,
    message: str,
    hits: list[dict[str, Any]],
    severity: dict[str, Any],
    memory: dict[str, Any] | None = None,
) -> str:
    """
    Legal aid officer voice — structured plain English grounded in retrieval.
    Format: short answer → why law applies → today → documents → emergency → sources.
    """
    low = (message or '').lower()
    flags = severity.get('flags') or {}
    tier = severity.get('tier') or 'MEDIUM'
    theme = _detect_legal_theme(low, hits, flags)
    mem = memory or {}

    # Prefer law title from retrieved RAG
    for h in hits:
        blob = f"{h.get('title') or ''} {h.get('text') or ''}".lower()
        if 'domestic violence' in blob or 'pwdva' in blob or 'protection of women' in blob:
            theme['law'] = 'Protection of Women from Domestic Violence Act, 2005'
            if '18' in blob or 'protection order' in blob:
                theme['section'] = 'Section 18 — Protection Order'
            break
        if any(k in blob for k in ('ipc', 'bns', 'bnss', 'crpc', 'bsa', 'nalsa')):
            if h.get('title'):
                theme['law'] = h.get('title') or theme['law']

    # Ground "why" with a short retrieved snippet when present
    rag_why = _rag_snippet(hits)
    if rag_why and len(theme.get('why') or '') < 200:
        theme['why'] = f"{theme['why']} {rag_why}".strip()

    # Avoid repeating the same law lecture if already covered
    topics = set(mem.get('topics_covered') or [])
    short = theme['short']
    if theme.get('topic_key') in topics:
        short = f"Yes — and as we covered, {theme['short'].lstrip('Yes. ').lstrip('Yes — ')}"

    if tier == 'CRITICAL' or flags.get('abuser_present_now'):
        theme['emergency'] = (
            'If you are in danger right now, call **112** before anything else. '
            'Legal papers can wait until you are safe.'
        )

    section_line = theme.get('section') or ''
    lines = [
        short,
        '',
        '**Why this law applies**',
        theme['why'],
        '',
        '**What you can do today**',
        *[f'• {x}' for x in theme['today']],
        '',
        '**Documents to keep**',
        theme['documents'],
        '',
        '**Emergency option**',
        theme['emergency'],
        '',
        '**Relevant law**',
        theme['law'] + (f'\n{section_line}' if section_line else ''),
        '',
    ]
    if hits:
        lines.append('**Sources**')
        for h in hits[:4]:
            title = h.get('title') or h.get('source') or 'Legal knowledge'
            lines.append(f'• {title}')
        lines.append('')
    lines.extend(
        [
            'This is general legal information — not a substitute for advice from a qualified lawyer.',
            '',
            'What would you like help with next?',
        ]
    )
    return '\n'.join(lines)


# Alias for older imports
legal_plain_reply = legal_companion_reply


def collaborate_reply(
    *,
    message: str,
    severity: dict[str, Any],
    safety: dict[str, Any],
    hits: list[dict[str, Any]],
    crisis_memory: dict[str, Any],
    legal_memory: dict[str, Any],
    name: str | None = None,
) -> str:
    """Mixed emotion + legal question: crisis acknowledgement then legal block."""
    crisis = crisis_companion_reply(
        message=message,
        severity=severity,
        safety=safety,
        memory=crisis_memory,
        name=name,
    )
    # Keep crisis part short for collaboration
    crisis_short = '\n\n'.join(crisis.split('\n\n')[:2])
    legal = legal_companion_reply(
        message=message,
        hits=hits,
        severity=severity,
        memory=legal_memory,
    )
    return (
        f"{crisis_short}\n\n"
        "---\n\n"
        "**On the legal side**\n\n"
        f"{legal}"
    )


def _coping_step(tier: str, emotion: str, safety: dict[str, Any]) -> str:
    if tier in ('HIGH', 'CRITICAL'):
        return safety.get('primary_step') or 'If you can, move to a safer space and keep your phone close.'
    if emotion == 'fear':
        return 'If you are alone for a moment, try one slow breath with me: in for four, out for six.'
    return safety.get('primary_step') or "We'll go one step at a time — nothing has to be solved in this message."


def _question_key(q: str) -> str:
    low = q.lower()
    if 'another room' in low or 'move' in low:
        return 'move_room'
    if '112' in low or 'call' in low:
        return 'call_112'
    if 'alone' in low:
        return 'alone_now'
    if 'with you' in low or 'hear you' in low:
        return 'abuser_present'
    if 'physically safe' in low or 'safe in this' in low:
        return 'safe_now'
    if 'child' in low:
        return 'children'
    if 'tonight' in low or 'small step' in low:
        return 'what_helps'
    return 'open'


def _rag_snippet(hits: list[dict[str, Any]]) -> str:
    if not hits:
        return ''
    text = (hits[0].get('text') or '').strip()
    if not text:
        return ''
    # One short sentence from retrieval
    parts = re.split(r'(?<=[.!?])\s+', text)
    for p in parts:
        if 40 < len(p) < 180:
            return p.strip()
    return text[:160].rsplit(' ', 1)[0] + '…' if len(text) > 160 else text


def _detect_legal_theme(
    low: str,
    hits: list[dict[str, Any]],
    flags: dict[str, Any],
) -> dict[str, Any]:
    blob = ' '.join((h.get('text') or '') + ' ' + (h.get('title') or '') for h in hits).lower()

    phone_control = any(x in low for x in ('took my phone', 'no phone', "won't let me call"))
    threats = any(x in low for x in ('threat', 'threaten', 'kill', 'hurt'))
    wants_fir = any(x in low for x in ('fir', 'police', 'complaint', 'report'))
    wants_order = any(
        x in low for x in ('stop him', 'keep him away', 'protection', 'restraining', 'coming home', 'come home')
    )
    wants_shelter = any(x in low for x in ('leave', 'shelter', 'stay', 'residence'))
    children = flags.get('children') or any(x in low for x in ('child', 'kid', 'baby'))
    physical = any(
        x in low for x in ('hit', 'beat', 'slap', 'punch', 'assault', 'bat', 'weapon', 'bleed', 'kick')
    )

    if physical or wants_order:
        return {
            'topic_key': 'physical_pwdva',
            'short': (
                'Yes. Physical violence by a spouse or partner is protected under '
                'the Protection of Women from Domestic Violence Act.'
            ),
            'law': 'Protection of Women from Domestic Violence Act, 2005',
            'section': 'Section 18 — Protection Order' if wants_order else '',
            'why': (
                'Physical assault in the home is recognised as domestic violence. '
                'You can ask for an order that stops the abuser from contacting or hurting you.'
            ),
            'today': [
                'Keep photographs of injuries if it is safe',
                'Visit a hospital if injured and ask for a written report',
                'File a police complaint if you choose',
                'Ask for a Protection Order that can keep him from coming near you',
            ],
            'documents': 'Photos, medical report, messages, witness names, ID',
            'emergency': '112 (emergency) · 1091 (women helpline)',
        }

    if phone_control or threats:
        return {
            'topic_key': 'control_threats',
            'short': (
                'Yes. Controlling your phone or threatening you can count as domestic violence '
                'under Indian law — even without a fresh injury today.'
            ),
            'law': 'Protection of Women from Domestic Violence Act',
            'section': '',
            'why': (
                'Emotional and verbal abuse, including threats and control, are covered. '
                'The law is meant to stop that control.'
            ),
            'today': [
                'Contact someone you trust if it is safe',
                'Save screenshots or call logs only if safe',
                'Call 1091 or visit a women help desk',
            ],
            'documents': 'ID, messages or call records, medical notes if any',
            'emergency': 'Call 112 if unsafe right now; call 1091 for women-focused help.',
        }

    if wants_fir:
        return {
            'topic_key': 'police_complaint',
            'short': (
                'Yes. You can ask the police to write down what happened as an official complaint '
                'so there is a record.'
            ),
            'law': 'Criminal procedure for reporting domestic violence',
            'section': '',
            'why': 'A written complaint creates an official trail. You can ask for a copy for yourself.',
            'today': [
                'Go to the nearest police station (or call 112 if urgent)',
                'Ask for the duty officer or women help desk',
                'Say you want your complaint written and a copy for yourself',
            ],
            'documents': 'ID, photos, messages, medical papers, witness names',
            'emergency': 'If you cannot go alone, call 112 or 1091 and ask for help getting there.',
        }

    if wants_shelter or 'home' in low:
        return {
            'topic_key': 'residence',
            'short': (
                'Yes. You may have the right to stay safely in your home, '
                'or to get help finding a safe place to stay.'
            ),
            'law': 'Protection of Women from Domestic Violence Act (residence / shelter)',
            'section': '',
            'why': (
                'Domestic violence law can support a Residence Order and access to shelter '
                'so you are not forced onto the street.'
            ),
            'today': [
                'Call 1091 for shelter options near you',
                'Tell a trusted person where you are',
                'If unsafe tonight, prioritise emergency shelter over paperwork',
            ],
            'documents': "ID, any prior complaints, children's documents if travelling with them",
            'emergency': '112 for immediate danger · 1091 for shelter support',
        }

    if children:
        return {
            'topic_key': 'children',
            'short': (
                'Yes. When children are involved, the law pays special attention '
                'to their safety as well as yours.'
            ),
            'law': 'Protection of Women from Domestic Violence Act (and child safety protections)',
            'section': '',
            'why': (
                'Abuse around children can support stronger protection and urgent help '
                'from police and child welfare services.'
            ),
            'today': [
                'Move children to the safest room you can if danger is near',
                'Call 1091 or 112 if anyone is at immediate risk',
                'Keep a small bag ready only if leaving will not raise danger',
            ],
            'documents': "ID, children's ID if available, photos/messages, medical notes",
            'emergency': '112 if children are in danger now · Child helpline 1098',
        }

    rag_hint = ''
    if 'protection' in blob:
        rag_hint = ' Retrieved guidance also points toward protection-order pathways.'

    return {
        'topic_key': 'rights_overview',
        'short': (
            'Yes. You have rights under India’s Domestic Violence Law to ask for safety, '
            'a place to stay, and support with basic needs.'
        ),
        'law': 'Protection of Women from Domestic Violence Act',
        'section': '',
        'why': (
            'The law covers physical, emotional, verbal, sexual, and economic abuse — '
            f'not only injuries that leave marks.{rag_hint}'
        ),
        'today': [
            'Call 112 if you are in danger',
            'Call 1091 for women-focused guidance',
            'Write down what happened in your own words while it is fresh',
        ],
        'documents': 'ID, any evidence you already have, names of people who know what happened',
        'emergency': '112 · 1091',
    }
