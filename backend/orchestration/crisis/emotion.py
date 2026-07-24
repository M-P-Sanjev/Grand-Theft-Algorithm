from __future__ import annotations

import re
from typing import Any


# Lightweight lexicon emotion detector (no LLM).
_EMOTION_LEXICON: dict[str, tuple[str, ...]] = {
    'fear': (
        'scared', 'afraid', 'terrified', 'fear', 'panic', 'frightened',
        'worried', 'unsafe', 'danger', 'hiding',
    ),
    'sadness': (
        'sad', 'cry', 'crying', 'hopeless', 'alone', 'empty', 'depressed',
        'hurt inside', 'broken',
    ),
    'anger': (
        'angry', 'furious', 'hate', 'rage', 'mad at',
    ),
    'shame': (
        'ashamed', 'embarrassed', 'humiliated', 'worthless', 'my fault',
    ),
    'numb': (
        'numb', 'empty', 'nothing', 'can\'t feel', 'detached',
    ),
    'hope': (
        'hope', 'better', 'safe now', 'okay now', 'relieved', 'helping',
    ),
}


def detect_emotion(text: str, *, prior: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return primary emotion + intensities. Deterministic, no LLM."""
    t = (text or '').lower()
    scores: dict[str, float] = {k: 0.0 for k in _EMOTION_LEXICON}
    matched: dict[str, list[str]] = {k: [] for k in _EMOTION_LEXICON}

    for emotion, words in _EMOTION_LEXICON.items():
        for w in words:
            if w in t:
                scores[emotion] += 1.0
                matched[emotion].append(w)

    # Intensifiers
    if re.search(r"\b(very|so|really|extremely|can't)\b", t):
        for k in scores:
            if scores[k] > 0:
                scores[k] *= 1.25

    if prior and prior.get('primary') == 'fear' and scores.get('hope', 0) == 0:
        scores['fear'] = max(scores['fear'], 0.5)

    primary = max(scores, key=scores.get) if any(scores.values()) else 'distress'
    intensity = min(1.0, scores.get(primary, 0) / 3.0) if primary in scores else 0.35
    if primary == 'distress':
        intensity = 0.4

    return {
        'primary': primary,
        'intensity': round(intensity, 2),
        'scores': {k: round(v, 2) for k, v in scores.items() if v > 0},
        'matched': {k: v for k, v in matched.items() if v},
        'source': 'lexicon',
    }
