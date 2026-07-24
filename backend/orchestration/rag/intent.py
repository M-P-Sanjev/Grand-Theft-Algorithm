from __future__ import annotations

import re
from typing import Literal

Intent = Literal[
    'child_harm',
    'physical_assault',
    'verbal_abuse',
    'protection_order',
    'residence',
    'fir',
    'evidence',
    'helpline',
    'grounding',
    'safety_plan',
    'shame',
    'general',
]

# Preferred knowledge filenames (without path) per intent
INTENT_SOURCES: dict[str, dict[str, list[str]]] = {
    'legal': {
        'child_harm': ['07_child_harm_reporting.md', '03_criminal_fir_cruelty.md', '05_helplines_ngo.md'],
        'physical_assault': ['03_criminal_fir_cruelty.md', '01_dv_protection_orders.md', '04_evidence_safety.md'],
        'verbal_abuse': ['08_verbal_emotional_cruelty.md', '01_dv_protection_orders.md', '05_helplines_ngo.md'],
        'protection_order': ['01_dv_protection_orders.md', '05_helplines_ngo.md'],
        'residence': ['02_residence_orders.md', '01_dv_protection_orders.md'],
        'fir': ['03_criminal_fir_cruelty.md', '05_helplines_ngo.md'],
        'evidence': ['04_evidence_safety.md', '03_criminal_fir_cruelty.md'],
        'helpline': ['05_helplines_ngo.md'],
        'general': ['01_dv_protection_orders.md', '05_helplines_ngo.md'],
    },
    'therapy': {
        'child_harm': ['05_supporting_children.md', '03_safety_planning.md', '04_crisis_escalation.md'],
        'physical_assault': ['03_safety_planning.md', '01_psychological_first_aid.md'],
        'verbal_abuse': ['07_emotional_abuse_shouting.md', '02_grounding_breathing.md', '06_boundaries_ongoing_care.md'],
        'grounding': ['02_grounding_breathing.md', '01_psychological_first_aid.md'],
        'safety_plan': ['03_safety_planning.md', '01_psychological_first_aid.md'],
        'shame': ['07_emotional_abuse_shouting.md', '06_boundaries_ongoing_care.md', '01_psychological_first_aid.md'],
        'helpline': ['04_crisis_escalation.md', '01_psychological_first_aid.md'],
        'general': ['01_psychological_first_aid.md', '02_grounding_breathing.md'],
    },
}

INTENT_REWRITE: dict[str, str] = {
    'child_harm': 'child harm violence reporting police protection children safety FIR',
    'physical_assault': 'physical assault hit beat injury FIR medical evidence protection order',
    'verbal_abuse': 'verbal abuse shouting yelling emotional cruelty humiliation DV Act',
    'protection_order': 'protection order Domestic Violence Act Magistrate Protection Officer',
    'residence': 'residence order shared household eviction DV Act',
    'fir': 'FIR police criminal complaint cruelty 498A Zero FIR',
    'evidence': 'evidence safety screenshots medical records digital proof',
    'helpline': 'helpline 1091 112 NGO Protection Officer legal aid',
    'grounding': 'grounding breathing panic overwhelm 5-4-3-2-1 calm body',
    'safety_plan': 'safety planning go-bag exits escalation leave safely',
    'shame': 'shame self-blame emotional abuse validation boundaries support',
    'general': 'domestic violence safety support protection help India',
}


def detect_intent(domain: str, question: str) -> Intent:
    q = (question or '').lower()

    if re.search(r'\b(child|kids?|son|daughter|baby|minor)\b', q) and re.search(
        r'\b(hit|beat|hurt|slap|abuse|touch|violence|harm)\b', q
    ):
        return 'child_harm'

    if domain == 'therapy':
        if re.search(r'\b(ground|breath|panic|anxious|overwhelm|flashback)\b', q):
            return 'grounding'
        if re.search(r'\b(shame|humiliat|worthless|blame myself|feel bad)\b', q):
            return 'shame'
        if re.search(r'\b(shout|yell|scream|insult|verbal|emotion)\b', q):
            return 'verbal_abuse'
        if re.search(r'\b(safety plan|leave|go.?bag|escape)\b', q):
            return 'safety_plan'
        if re.search(r'\b(hit|beat|slap|attack|hurt me)\b', q):
            return 'physical_assault'
        return 'general'

    # legal
    if re.search(r'\b(protection order|restraining)\b', q):
        return 'protection_order'
    if re.search(r'\b(residence|shared household|thrown out|evict)\b', q):
        return 'residence'
    if re.search(r'\b\bfir\b|police complaint|criminal case\b', q):
        return 'fir'
    if re.search(r'\b(evidence|screenshot|proof|photo|medical)\b', q):
        return 'evidence'
    if re.search(r'\b(helpline|1091|112|ngo|legal aid)\b', q):
        return 'helpline'
    if re.search(r'\b(shout|yell|verbal|insult|threaten to|humiliat)\b', q):
        return 'verbal_abuse'
    if re.search(r'\b(hit|beat|slap|assault|injur|bleed|weapon)\b', q):
        return 'physical_assault'
    return 'general'


def rewrite_query(domain: str, question: str, intent: Intent) -> str:
    extra = INTENT_REWRITE.get(intent, INTENT_REWRITE['general'])
    return f'{question} {extra}'.strip()


def preferred_sources(domain: str, intent: Intent) -> list[str]:
    return list(INTENT_SOURCES.get(domain, {}).get(intent, INTENT_SOURCES.get(domain, {}).get('general', [])))
