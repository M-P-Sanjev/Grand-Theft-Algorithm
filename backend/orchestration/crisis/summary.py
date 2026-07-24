from __future__ import annotations

from typing import Any


def recommend_next_actions(case: dict[str, Any], severity: dict[str, Any]) -> list[dict[str, Any]]:
    """AI Next Action Engine — ordered recommendations for admin / victim."""
    tier = severity.get('tier') or 'MEDIUM'
    flags = severity.get('flags') or {}
    actions: list[dict[str, Any]] = []

    if flags.get('abuser_present_now') or tier == 'CRITICAL':
        actions.append(
            {
                'id': 'call_police',
                'label': 'Call police now',
                'plain': 'Ask emergency services to check on the victim immediately.',
                'priority': 1,
            }
        )
        actions.append(
            {
                'id': 'emergency_shelter',
                'label': 'Find emergency shelter',
                'plain': 'Connect to a nearby safe place for tonight.',
                'priority': 2,
            }
        )

    if flags.get('self_harm'):
        actions.append(
            {
                'id': 'medical_help',
                'label': 'Medical / crisis help',
                'plain': 'Connect to emergency medical or mental-health crisis support.',
                'priority': 1,
            }
        )

    if tier in ('HIGH', 'CRITICAL') or flags.get('children'):
        actions.append(
            {
                'id': 'refer_ngo',
                'label': 'Assign NGO helper',
                'plain': 'A trained support person can stay with the victim.',
                'priority': 2,
            }
        )

    actions.append(
        {
            'id': 'legal_guidance',
            'label': 'Legal rights in plain words',
            'plain': 'Explain how to ask the court to keep the abuser away.',
            'priority': 3,
        }
    )
    actions.append(
        {
            'id': 'therapy',
            'label': 'Calm support chat',
            'plain': 'Stay with the victim emotionally, one small step at a time.',
            'priority': 3,
        }
    )
    actions.append(
        {
            'id': 'safety_planning',
            'label': 'Safety planning',
            'plain': 'Build a simple plan for tonight and tomorrow.',
            'priority': 4,
        }
    )

    # de-dupe by id preserving order
    seen = set()
    out = []
    for a in sorted(actions, key=lambda x: x['priority']):
        if a['id'] in seen:
            continue
        seen.add(a['id'])
        out.append(a)
    return out[:6]


def build_case_summary(case: dict[str, Any], severity: dict[str, Any]) -> dict[str, Any]:
    """Plain-English AI case summary for admin / judge display."""
    notes = (case.get('notes') or '').strip()
    freq = case.get('frequency') or 'once'
    emotion = (severity.get('emotion') or {}).get('primary') or 'distress'
    flags = severity.get('flags') or {}

    profile_bits = []
    if freq in ('repeated', 'ongoing'):
        profile_bits.append('Repeated domestic abuse')
    else:
        profile_bits.append('Reported domestic abuse')
    if 'yesterday' in notes.lower() or 'last night' in notes.lower():
        profile_bits.append('Recent assault')
    if flags.get('children'):
        profile_bits.append('Children may be present')
    if emotion in ('fear', 'sadness', 'shame'):
        profile_bits.append(f'High emotional distress ({emotion})')

    risk = severity.get('risk_index') or case.get('risk_score') or 0
    actions = recommend_next_actions(case, severity)
    contacts = case.get('escalation_contacts') or {}

    return {
        'headline': f"Risk {severity.get('tier', 'MEDIUM')} · {risk}/100",
        'victim_profile': profile_bits,
        'risk_index': risk,
        'tier': severity.get('tier'),
        'confidence': severity.get('confidence'),
        'reasons': severity.get('reasons') or [],
        'scores': severity.get('scores') or {},
        'recommended': [a['plain'] for a in actions[:4]],
        'next_actions': actions,
        'assigned': {
            'ngo': contacts.get('ngo') or case.get('routing'),
            'police': contacts.get('police') if case.get('routing') == 'police' else None,
            'routing': case.get('routing'),
            'notify_status': case.get('notify_status'),
        },
        'plain_status': _plain_status(case, severity),
    }


def _plain_status(case: dict[str, Any], severity: dict[str, Any]) -> str:
    tier = severity.get('tier') or 'MEDIUM'
    routing = case.get('routing') or 'admin'
    if tier == 'CRITICAL':
        return 'Urgent help is being prepared. Stay with us.'
    if routing == 'police':
        return 'Police route is open for this case.'
    if routing == 'ngo':
        return 'A support organisation is being connected.'
    return 'Your case is open and being watched.'
