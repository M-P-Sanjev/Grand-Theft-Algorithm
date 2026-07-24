from __future__ import annotations

import re
from typing import Any

from backend.orchestration.crisis.memory import next_gentle_question


def therapy_companion_reply(
    *,
    message: str,
    severity: dict[str, Any],
    safety: dict[str, Any],
    memory: dict[str, Any],
    name: str | None = None,
) -> str:
    """
    Trained crisis supporter voice.
    Acknowledge → check safety → one calming step → one question → escalate if needed.
    """
    flags = severity.get('flags') or {}
    emotion = (severity.get('emotion') or {}).get('primary') or 'distress'
    low = (message or '').lower()
    who = (name or '').split(' ')[0] if name else ''
    greet = f'{who}, ' if who else ''

    if flags.get('self_harm') or any(x in low for x in ('kill myself', 'want to die', 'suicid')):
        return (
            f"{greet}I'm really glad you told me.\n\n"
            "Your safety matters more than anything else right now.\n\n"
            "Please call 112 or 1091 now, or go to the nearest hospital.\n\n"
            "Is there someone who can stay with you while you reach help?"
        )

    if flags.get('abuser_present_now') or severity.get('tier') == 'CRITICAL':
        return (
            f"{greet}I hear you — and I am taking this seriously.\n\n"
            "First: are you able to move to another room or somewhere he cannot hear you?\n\n"
            f"{safety.get('primary_step') or 'If you can, call 112 when it is safe to speak.'}\n\n"
            "Tell me only what feels safe to share next."
        )

    if any(x in low for x in ('hit me', 'beat me', 'slapped', 'punched', 'hurt me')):
        return (
            f"{greet}I'm really sorry that happened to you.\n\n"
            "You didn't deserve that.\n\n"
            "Right now, are you physically safe?\n\n"
            "Are you somewhere he cannot reach you?"
        )

    if 'scared' in low or 'afraid' in low or emotion == 'fear':
        return (
            f"{greet}Feeling scared makes complete sense after what you've been through.\n\n"
            "Is the person you're afraid of with you right now?\n\n"
            "If you are alone for a moment, try one slow breath with me: in for four, out for six."
        )

    if re.search(r"\b(i('m| am) (okay|safe|fine))\b", low):
        return (
            f"{greet}I'm relieved to hear you feel a little safer.\n\n"
            "We'll take this slowly — nothing has to be decided all at once.\n\n"
            "Would it help to plan one small step for tonight?"
        )

    ack = {
        'sadness': "That sounds so heavy to carry.",
        'shame': "None of this is your fault.",
        'anger': "Your anger is valid — something wrong was done to you.",
        'numb': "Feeling numb after harm is more common than people admit.",
        'hope': "I'm glad a little hope is showing up.",
    }.get(emotion, "Thank you for trusting me with this.")

    step = safety.get('primary_step') or 'Take one slow breath with me: in for four, out for six.'
    q = next_gentle_question(memory, flags)

    return f"{greet}{ack}\n\n{step}\n\n{q}"


def legal_plain_reply(
    *,
    message: str,
    hits: list[dict[str, Any]],
    severity: dict[str, Any],
) -> str:
    """
    Legal guidance assistant — structured, dynamic from message + retrieval.
    Always includes: plain explanation, law, why it applies, today steps,
    documents, emergency options, nearby authority, next action.
    """
    low = (message or '').lower()
    flags = severity.get('flags') or {}
    tier = severity.get('tier') or 'MEDIUM'

    theme = _detect_legal_theme(low, hits, flags)

    # Prefer law title from retrieved RAG chunk when available
    for h in hits:
        blob = f"{h.get('title') or ''} {h.get('text') or ''}".lower()
        if 'domestic violence' in blob or 'pwdva' in blob or 'protection of women' in blob:
            theme['law'] = 'Protection of Women from Domestic Violence Act, 2005'
            break
        if 'ipc' in blob or 'bns' in blob or 'section' in blob:
            if theme.get('law') and 'Protection of Women' not in theme['law']:
                theme['law'] = h.get('title') or theme['law']

    plain = theme['plain']
    law = theme['law']
    why = theme['why']
    can_request = theme['can_request']
    today = theme['today']
    documents = theme['documents']
    emergency = theme['emergency']
    nearby = theme['nearby']
    next_action = theme['next']

    if tier == 'CRITICAL' or flags.get('abuser_present_now'):
        emergency = (
            'If you are in danger right now, call **112** before anything else. '
            'Legal papers can wait until you are safe.'
        )

    lines = [
        '**Applicable Law**',
        law,
        '',
        '**Why this matters**',
        why,
        '',
        plain,
        '',
        '**You may request**',
        *[f'• {x}' for x in can_request],
        '',
        '**Steps**',
        *[f'{i}. {s}' for i, s in enumerate(today, 1)],
        '',
        '**Documents needed**',
        documents,
        '',
        '**Emergency contacts**',
        emergency,
        '',
        f'**Nearby authority:** {nearby}',
        '',
        f'**Next action:** {next_action}',
        '',
    ]
    if hits:
        lines.append('**Sources**')
        for h in hits[:4]:
            title = h.get('title') or h.get('source') or 'Knowledge'
            lines.append(f'• {title}')
        lines.append('')
    lines.extend(
        [
            'This is legal information only and not a substitute for advice from a qualified lawyer.',
            '',
            'What would you like help with next?',
        ]
    )
    return '\n'.join(lines)


def _detect_legal_theme(
    low: str,
    hits: list[dict[str, Any]],
    flags: dict[str, Any],
) -> dict[str, Any]:
    blob = ' '.join((h.get('text') or '') + ' ' + (h.get('title') or '') for h in hits).lower()

    phone_control = any(
        x in low for x in ('took my phone', 'no phone', 'phone', "won't let me call")
    )
    threats = any(x in low for x in ('threat', 'threaten', 'kill', 'hurt'))
    wants_fir = any(x in low for x in ('fir', 'police', 'complaint', 'report'))
    wants_shelter = any(x in low for x in ('leave', 'shelter', 'stay', 'home', 'residence'))
    children = flags.get('children') or any(x in low for x in ('child', 'kid', 'baby'))
    physical = any(
        x in low
        for x in ('hit', 'beat', 'slap', 'punch', 'assault', 'bat', 'weapon', 'bleed', 'kick')
    )

    if physical:
        return {
            'plain': (
                'Physical assault by a spouse or partner is covered under domestic violence law. '
                'You can seek protection, medical help, and police assistance.'
            ),
            'law': 'Protection of Women from Domestic Violence Act, 2005',
            'why': (
                'Physical assault by a spouse is covered under this Act. '
                'The law recognises violence in the home and gives you rights to protection and support.'
            ),
            'can_request': [
                'Protection Order',
                'Residence Order',
                'Police assistance',
                'Medical help',
            ],
            'today': [
                'If unsafe, call 112 immediately.',
                'Seek medical care and ask for a written report of injuries.',
                'Preserve photos of injuries and any weapon used (only if safe).',
                'Contact 1091 or the nearest women help desk.',
            ],
            'documents': 'Photos, medical report, witnesses, police complaint if available',
            'emergency': '112 (emergency) · 1091 (women helpline)',
            'nearby': 'Nearest police station / women help desk · Emergency 112',
            'next': 'Get medical documentation and call 1091 or police when it is safe.',
        }

    if phone_control or threats or 'control' in low:
        return {
            'plain': (
                'You have legal protection if someone controls your phone, traps you, '
                'or threatens you — even when there is no fresh injury today.'
            ),
            'law': 'Protection of Women from Domestic Violence Act',
            'why': (
                'Controlling your phone and threatening you can count as emotional and '
                'verbal abuse under domestic violence law — the law is meant to stop that control.'
            ),
            'can_request': [
                'Protection Order (stop contact and harm)',
                'Residence Order (stay safely in the home or get alternative shelter support)',
                'Police assistance / women help desk support',
            ],
            'today': [
                'Contact someone you trust if it is safe to do so.',
                'Preserve evidence — screenshots, call logs, messages (only if safe).',
                'Visit the nearest police station or women\'s help centre, or call 1091.',
            ],
            'documents': 'ID, any messages or call records, medical notes if any, witness names',
            'emergency': 'Call 112 if you are unsafe right now; call 1091 for women-focused help.',
            'nearby': 'Nearest police women help desk / Protection Officer (confirm locally) · Helpline 1091',
            'next': 'If safe, save evidence and speak to 1091 or a women\'s help desk today.',
        }

    if wants_fir:
        return {
            'plain': (
                'You can ask the police to write down what happened as an official complaint '
                'so there is a record.'
            ),
            'law': 'Criminal procedure for reporting domestic violence / cognizable offences',
            'why': (
                'A written police complaint creates an official trail. You can ask for a copy '
                'for yourself.'
            ),
            'can_request': [
                'Written complaint / FIR where applicable',
                'Women help desk assistance at the station',
                'Immediate police protection if you are in danger',
            ],
            'today': [
                'Go to the nearest police station (or call 112 if urgent).',
                'Ask for the duty officer or women help desk.',
                'Say you want your complaint written and a copy for yourself.',
            ],
            'documents': 'ID, photos of injuries, messages, medical papers, witness names',
            'emergency': 'If you cannot go alone, call 112 or 1091 and ask for help getting there.',
            'nearby': 'Nearest police station · Women helpline 1091 · Emergency 112',
            'next': 'Decide whether you can reach a station safely today, or need 112 escort help.',
        }

    if wants_shelter or 'home' in low:
        return {
            'plain': (
                'You may have the right to stay safely in your home, or to get help finding '
                'a safe place to stay.'
            ),
            'law': 'Protection of Women from Domestic Violence Act (residence / shelter protections)',
            'why': (
                'Domestic violence law can support a Residence Order and access to shelter '
                'so you are not forced onto the street.'
            ),
            'can_request': [
                'Residence Order',
                'Shelter / safe accommodation support',
                'Protection Order',
            ],
            'today': [
                'Call 1091 or an NGO helpline for shelter options near you.',
                'Tell a trusted person where you are.',
                'If unsafe tonight, prioritise emergency shelter over paperwork.',
            ],
            'documents': 'ID, any prior complaints, children\'s documents if travelling with them',
            'emergency': '112 for immediate danger · 1091 for shelter / women support',
            'nearby': 'Local Protection Officer / women\'s shelter desk (confirm city) · 1091',
            'next': 'Ask 1091 for the nearest safe shelter contact for tonight.',
        }

    if children:
        return {
            'plain': (
                'When children are involved, the law pays special attention to their safety '
                'as well as yours.'
            ),
            'law': 'Protection of Women from Domestic Violence Act (and child safety protections)',
            'why': (
                'Abuse around children can support stronger protection and urgent help from '
                'police and child welfare services.'
            ),
            'can_request': [
                'Protection Order covering you and the children',
                'Police assistance',
                'Support from child welfare / women help centres',
            ],
            'today': [
                'Move children to the safest room you can if danger is near.',
                'Call 1091 or 112 if anyone is at immediate risk.',
                'Keep a small bag ready only if leaving will not raise danger.',
            ],
            'documents': 'ID, children\'s ID if available, photos/messages, medical notes',
            'emergency': '112 if children are in danger now',
            'nearby': 'Police women help desk · Child helpline 1098 · Women helpline 1091',
            'next': 'Tell me if the children are safe in this moment — we will take the next step from there.',
        }

    # Default / rights overview — still structured; RAG blob can colour "why"
    rag_hint = ''
    if 'protection' in blob:
        rag_hint = ' Retrieved guidance also points toward protection-order pathways.'

    return {
        'plain': (
            'You have rights under India\'s Domestic Violence Law to ask for safety, '
            'a place to stay, and support with basic needs.'
        ),
        'law': 'Protection of Women from Domestic Violence Act',
        'why': (
            'The law covers physical, emotional, verbal, sexual, and economic abuse — '
            f'not only injuries that leave marks.{rag_hint}'
        ),
        'can_request': [
            'Protection Order',
            'Residence Order',
            'Monetary relief / support where eligible',
            'Police or Protection Officer help',
        ],
        'today': [
            'Call 112 if you are in danger.',
            'Call 1091 for women-focused guidance.',
            'Write down what happened in your own words while it is fresh.',
        ],
        'documents': 'ID, any evidence you already have, names of people who know what happened',
        'emergency': '112 · 1091',
        'nearby': 'Nearest police women help desk / Magistrate Court Protection Officer (local)',
        'next': 'Choose one path for today: safety call, evidence save, or legal desk visit.',
    }
