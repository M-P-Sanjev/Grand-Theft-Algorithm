from __future__ import annotations

from typing import Any

# case_id -> therapy memory
_MEMORY: dict[str, dict[str, Any]] = {}


def get_memory(case_id: str) -> dict[str, Any]:
    return dict(_MEMORY.get(case_id) or {})


def update_memory(
    case_id: str,
    *,
    message: str = '',
    reply: str = '',
    emotion: dict[str, Any] | None = None,
    case: dict[str, Any] | None = None,
) -> dict[str, Any]:
    mem = _MEMORY.setdefault(
        case_id,
        {
            'name': None,
            'preferred_language': 'en',
            'asked': [],
            'emotional_state': None,
            'stress_level': 0.5,
            'incidents': [],
            'last_topics': [],
        },
    )
    if case and case.get('name') and not mem.get('name'):
        mem['name'] = case.get('name')

    if emotion:
        mem['emotional_state'] = emotion.get('primary')
        intensity = float(emotion.get('intensity') or 0.4)
        prev = float(mem.get('stress_level') or 0.5)
        mem['stress_level'] = round(prev * 0.6 + intensity * 0.4, 2)

    low = (message or '').lower()
    if 'hit' in low or 'beat' in low or 'slap' in low:
        mem['incidents'] = (mem.get('incidents') or [])[-4:] + ['physical']
    if 'shout' in low or 'yell' in low or 'insult' in low:
        mem['incidents'] = (mem.get('incidents') or [])[-4:] + ['verbal']

    # Track questions already asked in replies (simple heuristics)
    asked = list(mem.get('asked') or [])
    for marker, key in (
        ('are you physically safe', 'safe_now'),
        ('are you somewhere', 'safe_location'),
        ('is the person', 'abuser_present'),
        ('with you right now', 'abuser_present'),
        ('children', 'children'),
        ('what would help', 'what_helps'),
    ):
        if marker in (reply or '').lower() and key not in asked:
            asked.append(key)
    mem['asked'] = asked[-12:]
    mem['last_topics'] = ((mem.get('last_topics') or []) + [message[:80]])[-8:]
    _MEMORY[case_id] = mem
    return dict(mem)


def next_gentle_question(mem: dict[str, Any], flags: dict[str, Any]) -> str:
    asked = set(mem.get('asked') or [])
    if flags.get('abuser_present_now') and 'safe_now' not in asked:
        return 'Can you get to another room or somewhere he cannot hear you?'
    if 'abuser_present' not in asked:
        return 'Is the person you are afraid of with you right now?'
    if 'safe_now' not in asked:
        return 'Are you physically safe in this moment?'
    if 'children' not in asked:
        return 'Is anyone else with you who might also need safety — like a child?'
    if 'what_helps' not in asked:
        return 'What would help most right now — staying on this chat, a helpline, or a safe place?'
    return 'I am still here with you. What feels hardest right now?'
