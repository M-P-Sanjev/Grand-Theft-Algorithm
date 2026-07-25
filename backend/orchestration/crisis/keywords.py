"""Keyword / threat phrase detection for Guardian live transcript."""

from __future__ import annotations

import re
from typing import Any

# kind -> (label, color tier, risk delta, patterns)
KEYWORD_RULES: list[dict[str, Any]] = [
    {
        'kind': 'weapon',
        'label': 'Weapon Mention',
        'severity': 'critical',
        'delta': 28,
        'patterns': [
            r'\bgun\b',
            r'\bpistol\b',
            r'\brifle\b',
            r'\bknife\b',
            r'\bbat\b',
            r'\bmachete\b',
            r'\bweapon\b',
            r'\bshotgun\b',
            r'\bstab\b',
            r'\bshoot\b',
        ],
    },
    {
        'kind': 'assault',
        'label': 'Physical Assault',
        'severity': 'critical',
        'delta': 22,
        'patterns': [
            r'\bhit\b',
            r'\bbeat\b',
            r'\bpunch\b',
            r'\bchok(?:e|ing)\b',
            r'\bstrangl',
            r'\bslap\b',
            r'\bkick\b',
            r'\bassault\b',
        ],
    },
    {
        'kind': 'bleeding',
        'label': 'Bleeding',
        'severity': 'critical',
        'delta': 24,
        'patterns': [r'\bbleed', r'\bblood\b', r'\bwound'],
    },
    {
        'kind': 'help',
        'label': 'Please Help',
        'severity': 'high',
        'delta': 16,
        'patterns': [r'\bhelp\b', r'\bsave me\b', r'\bcall (?:the )?police\b', r'\b911\b'],
    },
    {
        'kind': 'locked',
        'label': 'Locked / Trapped',
        'severity': 'high',
        'delta': 14,
        'patterns': [r'\blocked\b', r'\btrapped\b', r"\bcan't (?:get )?out\b", r"\bwon't let me\b"],
    },
    {
        'kind': 'kill',
        'label': 'Kill Threat',
        'severity': 'critical',
        'delta': 30,
        'patterns': [r'\bkill\b', r'\bmurder\b', r'\bdie\b', r'\bgoing to (?:kill|hurt)'],
    },
    {
        'kind': 'children',
        'label': 'Child Mention',
        'severity': 'high',
        'delta': 12,
        'patterns': [r'\bchild(?:ren)?\b', r'\bkids?\b', r'\bbaby\b', r'\bson\b', r'\bdaughter\b'],
    },
    {
        'kind': 'pregnant',
        'label': 'Pregnant',
        'severity': 'high',
        'delta': 12,
        'patterns': [r'\bpregnant\b', r'\bpregnancy\b'],
    },
    {
        'kind': 'suicide',
        'label': 'Suicide Risk',
        'severity': 'critical',
        'delta': 26,
        'patterns': [r'\bsuicide\b', r'\bkill myself\b', r'\bend (?:it|my life)\b'],
    },
    {
        'kind': 'crying',
        'label': 'Crying / Fear',
        'severity': 'medium',
        'delta': 6,
        'patterns': [r'\bcry(?:ing)?\b', r'\bscared\b', r'\bterrified\b', r'\bfear\b'],
    },
]


def detect_keywords(text: str, *, t_sec: float | None = None, at: str | None = None) -> list[dict[str, Any]]:
    """Return newly matched keyword events for this chunk (not cumulative)."""
    low = (text or '').lower()
    if not low.strip():
        return []
    events: list[dict[str, Any]] = []
    for rule in KEYWORD_RULES:
        for pat in rule['patterns']:
            if re.search(pat, low, re.IGNORECASE):
                events.append(
                    {
                        'kind': rule['kind'],
                        'label': rule['label'],
                        'severity': rule['severity'],
                        'delta': rule['delta'],
                        't_sec': t_sec,
                        'at': at,
                        'matched': pat,
                    }
                )
                break
    return events


def keyword_risk_bump(events: list[dict[str, Any]]) -> int:
    """Sum deltas with a soft cap so one sentence cannot explode past +45."""
    total = 0
    seen: set[str] = set()
    for ev in events:
        kind = str(ev.get('kind') or '')
        if kind in seen:
            continue
        seen.add(kind)
        total += int(ev.get('delta') or 0)
    return min(45, total)


def highlight_terms() -> list[str]:
    """Flat list of display keywords for UI highlighting."""
    return [
        'weapon',
        'knife',
        'bat',
        'gun',
        'bleeding',
        'blood',
        'locked',
        'kill',
        'help',
        'children',
        'child',
        'kids',
        'pregnant',
        'suicide',
        'scared',
        'hit',
        'punch',
    ]


def build_live_summary(
    *,
    notes: str,
    events: list[dict[str, Any]],
    risk_score: int | None,
    risk_tier: str | None,
    emotion: dict[str, Any] | None,
    recommendation: str | None,
) -> str:
    """One-paragraph rolling summary from flags + recent lines (no LLM required)."""
    kinds = {str(e.get('kind')) for e in events}
    parts: list[str] = []
    if 'assault' in kinds or re.search(r'\bhit\b|\bbeat\b', notes, re.I):
        parts.append('Victim reports physical assault.')
    if 'weapon' in kinds:
        parts.append('Weapon mentioned.')
    if 'bleeding' in kinds:
        parts.append('Possible injury or bleeding reported.')
    if 'locked' in kinds:
        parts.append('Victim may be trapped or locked in.')
    if 'children' in kinds:
        parts.append('Child(ren) mentioned on scene.')
    if 'pregnant' in kinds:
        parts.append('Pregnancy mentioned — elevated medical risk.')
    if 'suicide' in kinds or 'kill' in kinds:
        parts.append('Lethal threat language detected.')
    if 'help' in kinds:
        parts.append('Victim is explicitly asking for help.')
    primary = (emotion or {}).get('primary')
    if primary:
        parts.append(f'High {(primary)} detected.' if primary in ('fear', 'distress', 'panic') else f'Emotion: {primary}.')
    if not parts:
        parts.append('Guardian listening active — monitoring for escalation.')
    tier = (risk_tier or 'medium').upper()
    score = risk_score if risk_score is not None else '—'
    parts.append(f'Current risk {score}/100 ({tier}).')
    if recommendation:
        parts.append(recommendation.strip())
    return ' '.join(parts)
