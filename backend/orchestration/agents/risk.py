from __future__ import annotations

import os
import re
from typing import Any

CRITICAL_KEYWORDS = (
    'weapon',
    'gun',
    'knife',
    'strangl',
    'chok',
    'kill',
    'suicid',
    'threaten to kill',
    'bleeding',
    'hospital',
    'rape',
    'sexual assault',
)
HIGH_KEYWORDS = (
    'hit',
    'beat',
    'bruise',
    'afraid',
    'locked',
    'threat',
    'child',
    'pregnant',
    'stalk',
)


def _gemini_refine(context: str) -> tuple[int | None, str | None]:
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        return None, None
    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = (
            'You are a crisis risk triage helper. Given anonymized case context, '
            'reply with ONLY two lines:\n'
            'SCORE:<0-100 integer>\n'
            'REASON:<one short sentence>\n\n'
            f'Context: {context}'
        )
        text = model.generate_content(prompt).text or ''
        score_m = re.search(r'SCORE:\s*(\d{1,3})', text, re.I)
        reason_m = re.search(r'REASON:\s*(.+)', text, re.I)
        score = int(score_m.group(1)) if score_m else None
        if score is not None:
            score = max(0, min(100, score))
        reason = reason_m.group(1).strip() if reason_m else None
        return score, reason
    except Exception:
        return None, None


def assess_risk(case: dict[str, Any]) -> dict[str, Any]:
    severity = case.get('severity') or 'medium'
    frequency = case.get('frequency') or 'once'
    notes = (case.get('notes') or '').lower()

    base = {'low': 25, 'medium': 45, 'high': 70, 'critical': 90}.get(severity, 45)
    if frequency == 'repeated':
        base += 10
    elif frequency == 'ongoing':
        base += 18
    if case.get('lat') is not None and case.get('lng') is not None:
        base += 4
    if case.get('evidence'):
        base += 5

    matched = []
    for kw in CRITICAL_KEYWORDS:
        if kw in notes:
            base = max(base, 92)
            matched.append(kw)
            break
    if not matched:
        for kw in HIGH_KEYWORDS:
            if kw in notes:
                base = min(100, base + 12)
                matched.append(kw)
                break

    score = max(0, min(100, base))
    source = 'rules'
    rationale = (
        f'Base from severity={severity}, frequency={frequency}'
        + (f'; keyword={matched[0]}' if matched else '')
    )

    from backend.orchestration.privacy import strip_pii_for_llm

    gem_score, gem_reason = _gemini_refine(strip_pii_for_llm(case))
    if gem_score is not None:
        # Blend toward model, keep floor from rules for safety
        score = max(score, int(round(0.4 * score + 0.6 * gem_score)))
        score = max(0, min(100, score))
        source = 'rules+gemini'
        if gem_reason:
            rationale = gem_reason

    if score >= 85:
        tier = 'critical'
    elif score >= 70:
        tier = 'high'
    elif score >= 45:
        tier = 'medium'
    else:
        tier = 'low'

    # Align reported severity upward if triage is higher
    severity_rank = {'low': 0, 'medium': 1, 'high': 2, 'critical': 3}
    tier_rank = severity_rank[tier]
    cur_rank = severity_rank.get(severity, 1)
    new_severity = severity
    if tier_rank > cur_rank:
        new_severity = tier  # type: ignore[assignment]

    return {
        'agent': 'risk',
        'risk_score': score,
        'risk_tier': tier,
        'severity': new_severity,
        'source': source,
        'rationale': rationale,
        'message': f'Risk {tier} ({score}/100) — {rationale}',
    }
