from __future__ import annotations

from typing import Any


def plan_safety(case: dict[str, Any], severity: dict[str, Any]) -> dict[str, Any]:
    """One calm safety plan — never dump options."""
    flags = severity.get('flags') or {}
    tier = severity.get('tier') or 'MEDIUM'
    steps: list[str] = []
    emergency = False

    if flags.get('abuser_present_now') or tier == 'CRITICAL':
        emergency = True
        steps = [
            'If you can, move to any room with a door lock or go to a neighbour you trust.',
            'Call 112 only when it is safe to speak, or ask someone nearby to call for you.',
            'Keep this chat open — we are watching with you.',
        ]
        primary = 'Get to a safer spot and call 112 if you can.'
    elif flags.get('self_harm'):
        emergency = True
        steps = [
            'You matter. Please call 112 or 1091 now, or go to the nearest hospital.',
            'If someone is with you, ask them to stay.',
        ]
        primary = 'Please reach emergency help right now.'
    elif flags.get('children'):
        steps = [
            'If children are nearby, move them to the safest room you can.',
            'Pack a small bag only if leaving will not raise danger tonight.',
        ]
        primary = 'Put the children in the safest room first.'
    elif tier in ('HIGH', 'MEDIUM'):
        steps = [
            'Tell one trusted person where you are.',
            'Keep your phone charged and volume low.',
        ]
        primary = 'Share your location with one person you trust.'
    else:
        steps = [
            'Breathe with me: in for 4, hold 2, out for 6.',
            'Stay where you feel least watched for now.',
        ]
        primary = 'Take one slow breath with me.'

    return {
        'agent': 'safety_planner',
        'primary_step': primary,
        'steps': steps[:3],
        'emergency': emergency,
        'helplines': ['112', '1091'],
        'message': primary,
    }
