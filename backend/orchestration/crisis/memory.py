"""Kind-scoped companion memory — Crisis vs Legal stay separate."""

from __future__ import annotations

from typing import Any

# key: f"{kind}:{case_id}"
_MEMORY: dict[str, dict[str, Any]] = {}


def _key(case_id: str, kind: str = 'therapy') -> str:
    k = 'therapy' if kind in ('therapy', 'crisis') else 'legal'
    return f'{k}:{case_id}'


def get_memory(case_id: str, kind: str = 'therapy') -> dict[str, Any]:
    return dict(_MEMORY.get(_key(case_id, kind)) or {})


def update_memory(
    case_id: str,
    *,
    message: str = '',
    reply: str = '',
    emotion: dict[str, Any] | None = None,
    case: dict[str, Any] | None = None,
    kind: str = 'therapy',
    topic_key: str | None = None,
) -> dict[str, Any]:
    key = _key(case_id, kind)
    is_legal = kind == 'legal'
    default = (
        {
            'name': None,
            'topics_covered': [],
            'laws_explained': [],
            'asked': [],
            'last_topics': [],
        }
        if is_legal
        else {
            'name': None,
            'preferred_language': 'en',
            'asked': [],
            'emotional_state': None,
            'stress_level': 0.5,
            'incidents': [],
            'last_topics': [],
            'risk_history_notes': [],
        }
    )
    mem = _MEMORY.setdefault(key, default)

    if case and case.get('name') and not mem.get('name'):
        mem['name'] = case.get('name')

    if emotion and not is_legal:
        mem['emotional_state'] = emotion.get('primary')
        intensity = float(emotion.get('intensity') or 0.4)
        prev = float(mem.get('stress_level') or 0.5)
        mem['stress_level'] = round(prev * 0.6 + intensity * 0.4, 2)

    low = (message or '').lower()
    if not is_legal:
        if any(x in low for x in ('hit', 'beat', 'slap', 'punch')):
            mem['incidents'] = (mem.get('incidents') or [])[-4:] + ['physical']
        if any(x in low for x in ('shout', 'yell', 'insult', 'threat')):
            mem['incidents'] = (mem.get('incidents') or [])[-4:] + ['verbal']
        if case and case.get('risk_score') is not None:
            notes = list(mem.get('risk_history_notes') or [])
            notes.append(int(case.get('risk_score') or 0))
            mem['risk_history_notes'] = notes[-8:]

    if is_legal and topic_key:
        topics = list(mem.get('topics_covered') or [])
        if topic_key not in topics:
            topics.append(topic_key)
        mem['topics_covered'] = topics[-12:]

    # Track questions already asked in replies
    asked = list(mem.get('asked') or [])
    for marker, qkey in (
        ('are you physically safe', 'safe_now'),
        ('are you somewhere', 'safe_location'),
        ('is the person', 'abuser_present'),
        ('with you right now', 'abuser_present'),
        ('another room', 'move_room'),
        ('call 112', 'call_112'),
        ('are you alone', 'alone_now'),
        ('children', 'children'),
        ('what would help', 'what_helps'),
        ('small step', 'what_helps'),
    ):
        if marker in (reply or '').lower() and qkey not in asked:
            asked.append(qkey)
    mem['asked'] = asked[-12:]
    mem['last_topics'] = ((mem.get('last_topics') or []) + [message[:80]])[-8:]
    _MEMORY[key] = mem
    return dict(mem)


def mark_question_asked(mem: dict[str, Any], key: str) -> None:
    if not key:
        return
    asked = list(mem.get('asked') or [])
    if key not in asked:
        asked.append(key)
    mem['asked'] = asked[-12:]


def next_crisis_question(mem: dict[str, Any], flags: dict[str, Any], *, tier: str = 'MEDIUM') -> str:
    """Never repeat the same safety question twice."""
    asked = set(mem.get('asked') or [])
    if tier == 'CRITICAL':
        order = [
            ('move_room', 'Are you able to move to another room?'),
            ('call_112', 'Can you call 112 safely?'),
            ('alone_now', 'Are you alone right now?'),
            ('abuser_present', 'Is he nearby or can he hear you?'),
        ]
    elif tier == 'HIGH':
        order = [
            ('safe_now', 'Are you physically safe in this moment?'),
            ('abuser_present', 'Is the person you are afraid of with you right now?'),
            ('move_room', 'Can you get somewhere he cannot hear you?'),
            ('children', 'Is anyone else with you who might also need safety — like a child?'),
        ]
    else:
        order = [
            ('abuser_present', 'Is the person you are afraid of with you right now?'),
            ('safe_now', 'Are you physically safe in this moment?'),
            ('children', 'Is anyone else with you who might also need safety — like a child?'),
            ('what_helps', 'Would it help to plan one small step for tonight?'),
        ]

    for key, question in order:
        if flags.get('abuser_present_now') and key == 'abuser_present' and key in asked:
            continue
        if key not in asked:
            return question
    return "I'm still here with you. What feels hardest right now?"


# Backward-compatible name
next_gentle_question = next_crisis_question
