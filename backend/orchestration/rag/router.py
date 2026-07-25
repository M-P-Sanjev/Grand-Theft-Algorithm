"""Smart routing between Crisis Companion and Legal Companion."""

from __future__ import annotations

from typing import Any, Literal

RoutePrimary = Literal['therapy', 'legal', 'both']


def route_message(message: str) -> dict[str, Any]:
    """
    Route by content:
    - emotions / fear / safety → therapy
    - law / FIR / rights / protection → legal
    - both → collaborate
    """
    low = (message or '').lower().strip()
    if not low:
        return {'primary': 'therapy', 'therapy': 0.5, 'legal': 0.2, 'reason': 'empty'}

    therapy_hits = 0
    legal_hits = 0

    therapy_cues = (
        'scared', 'afraid', 'alone', 'anxious', 'panic', 'cry', 'crying', 'sad',
        'feel', 'feeling', 'help me', 'i am okay', "i'm okay", 'overwhelmed',
        'breathe', 'safe now', 'with me', 'listen',
    )
    legal_cues = (
        'law', 'legal', 'rights', 'fir', 'police', 'complaint', 'court', 'lawyer',
        'protection', 'order', 'pwdva', 'section', 'documents', 'evidence',
        'stop him', 'keep him away', 'restraining', 'coming home', 'residence',
        'shelter', 'helpline', 'file',
    )
    violence_cues = (
        'hit', 'beat', 'slap', 'punch', 'hurt', 'threat', 'weapon', 'knife', 'bat', 'bleed',
    )

    for c in therapy_cues:
        if c in low:
            therapy_hits += 1
    for c in legal_cues:
        if c in low:
            legal_hits += 2
    for c in violence_cues:
        if c in low:
            therapy_hits += 1
            legal_hits += 1

    # Explicit mixed patterns
    mixed = (
        (any(v in low for v in violence_cues) and any(l in low for l in ('can i', 'how do i', 'what can', 'stop him', 'rights', 'police', 'order')))
        or ('hit' in low and ('stop' in low or 'home' in low or 'protection' in low))
    )

    if mixed or (therapy_hits >= 1 and legal_hits >= 2):
        primary: RoutePrimary = 'both'
    elif legal_hits > therapy_hits:
        primary = 'legal'
    else:
        primary = 'therapy'

    total = max(therapy_hits + legal_hits, 1)
    return {
        'primary': primary,
        'therapy': round(therapy_hits / total, 2),
        'legal': round(legal_hits / total, 2),
        'reason': 'mixed' if primary == 'both' else primary,
    }
