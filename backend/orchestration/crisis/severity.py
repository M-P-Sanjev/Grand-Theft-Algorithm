"""Crisis Risk Assessment — additive NLP feature classifier. NO LLM."""

from __future__ import annotations

import re
from typing import Any

from backend.orchestration.crisis.emotion import detect_emotion


# Additive feature weights — never hardcoded in UI; single source of truth.
FEATURE_WEIGHTS: dict[str, int] = {
    'weapon': 40,
    'physical_assault': 35,
    'sexual_assault': 40,
    'bleeding': 35,
    'death_threat': 35,
    'locked_inside': 30,
    'repeated_assault': 25,
    'current_danger': 20,
    'threat': 20,
    'children_involved': 20,
    'pregnant': 15,
    'medical_emergency': 25,
    'suicide_risk': 40,
    'victim_alone': 10,
    'previous_reports': 10,
    'intimate_partner': 15,
    'fear_distress': 10,
    'panic': 12,
    'financial_abuse': 12,
    'stalking': 15,
    'control_behaviour': 15,
}


def _blob(case: dict[str, Any], message: str = '', history: list[dict[str, str]] | None = None) -> str:
    parts = [
        case.get('notes') or '',
        message or '',
        case.get('Current Situation') or '',
    ]
    for m in (history or [])[-16:]:
        parts.append(m.get('content') or '')
    return ' '.join(parts).lower()


def _any_re(text: str, patterns: tuple[str, ...]) -> bool:
    return any(re.search(p, text, re.I) for p in patterns)


def extract_features(text: str, case: dict[str, Any] | None = None) -> dict[str, bool]:
    """NLP phrase/pattern feature extraction."""
    case = case or {}
    freq = (case.get('frequency') or 'once').lower()
    prev = int(case.get('previous_report_count') or 0)

    weapon = _any_re(
        text,
        (
            r'\b(gun|pistol|rifle|knife|blade|sword|weapon|rod|iron|acid|hammer|'
            r'screwdriver|bottle|stick|bat|baseball bat|hockey stick|machete|'
            r'axe|razor|scissors)\b',
            r'hit me with',
            r'with a (bat|stick|rod|iron|bottle|hammer)',
        ),
    )
    physical = _any_re(
        text,
        (
            r'\b(hit|beat|beaten|slap|slapped|punch|punched|kick|kicked|strangl|'
            r'chok|assault|assaulted|threw|push|pushed|hurt me|attacked)\b',
        ),
    )
    sexual = _any_re(
        text,
        (r'\b(rape|raped|sexual assault|molest|forced (me )?sex|sexually)\b',),
    )
    bleeding = _any_re(
        text,
        (r'\b(bleed|bleeding|blood|bruise|bruised|hospital|injury|injured|wound)\b',),
    )
    death_threat = _any_re(
        text,
        (
            r'\b(kill|murder|die|death threat|finish you|won\'t let you live|'
            r'going to kill|will kill|threaten(ed)? to kill)\b',
        ),
    )
    threat = death_threat or _any_re(
        text,
        (r'\b(threat|threaten|hurt you|coming for you|finish you)\b',),
    )
    locked = _any_re(
        text,
        (
            r'\b(locked|trapped|can\'t leave|cannot leave|won\'t let me (leave|go)|'
            r'took my phone|no phone|isolated)\b',
        ),
    )
    repeated = freq in ('repeated', 'ongoing') or _any_re(
        text,
        (r'\b(again|keeps|repeated|every (day|night)|always hits|ongoing)\b',),
    )
    current_danger = _any_re(
        text,
        (
            r'\b(right now|tonight|still here|with me|he is here|she is here|'
            r'outside (the )?door|in the (room|house)|coming (for|after)|just now)\b',
        ),
    )
    children = _any_re(text, (r'\b(child|children|kid|kids|baby|son|daughter)\b',))
    pregnant = _any_re(text, (r'\b(pregnant|pregnancy)\b',))
    alone = _any_re(text, (r'\b(alone|by myself|no one (here|with me)|nobody)\b',))
    previous = prev > 0
    intimate = _any_re(
        text,
        (r'\b(husband|wife|boyfriend|girlfriend|partner|spouse|ex[- ]?(husband|wife))\b',),
    )
    fear = _any_re(
        text,
        (r'\b(scared|afraid|terrified|fear|unsafe|hiding)\b',),
    )
    panic = _any_re(text, (r'\b(panic|panicking|can\'t breathe|hyperventilat)\b',))
    medical = _any_re(
        text,
        (r'\b(hospital|ambulance|unconscious|broken bone|fracture|need (a )?doctor)\b',),
    )
    suicide = _any_re(
        text,
        (r'\b(suicid|kill myself|want to die|end it|self-harm|harm myself)\b',),
    )
    financial = _any_re(
        text,
        (r'\b(no money|took my money|salary|bank|atm|financial|won\'t give money)\b',),
    )
    stalking = _any_re(
        text,
        (r'\b(stalk|following me|outside my|waiting outside|tracking|watched me)\b',),
    )
    control = _any_re(
        text,
        (r'\b(control|won\'t let me|took my phone|check(s|ing)? my phone|monitor)\b',),
    )

    return {
        'weapon': weapon,
        'physical_assault': physical,
        'sexual_assault': sexual,
        'bleeding': bleeding,
        'death_threat': death_threat,
        'threat': threat,
        'locked_inside': locked,
        'repeated_assault': repeated,
        'current_danger': current_danger,
        'children_involved': children,
        'pregnant': pregnant,
        'victim_alone': alone,
        'previous_reports': previous,
        'intimate_partner': intimate,
        'fear_distress': fear or (physical and intimate),
        'panic': panic,
        'medical_emergency': medical,
        'suicide_risk': suicide,
        'financial_abuse': financial,
        'stalking': stalking,
        'control_behaviour': control,
    }


def score_features(features: dict[str, bool]) -> tuple[int, list[str], dict[str, int]]:
    points: dict[str, int] = {}
    reasons: list[str] = []
    total = 0
    labels = {
        'weapon': 'Weapon mentioned',
        'physical_assault': 'Physical assault',
        'sexual_assault': 'Sexual assault indicated',
        'bleeding': 'Bleeding / injury reported',
        'death_threat': 'Death threat detected',
        'threat': 'Threat language detected',
        'locked_inside': 'Victim locked in / trapped',
        'repeated_assault': 'Repeated violence pattern',
        'current_danger': 'Current danger / abuser nearby',
        'children_involved': 'Children involved',
        'pregnant': 'Pregnancy reported',
        'victim_alone': 'Victim alone',
        'previous_reports': 'Previous reports on file',
        'intimate_partner': 'Intimate partner violence',
        'fear_distress': 'Fear detected',
        'panic': 'Panic signals',
        'medical_emergency': 'Medical emergency signals',
        'suicide_risk': 'Suicide / self-harm risk',
        'financial_abuse': 'Financial abuse signals',
        'stalking': 'Stalking signals',
        'control_behaviour': 'Control behaviour',
    }
    for key, weight in FEATURE_WEIGHTS.items():
        if features.get(key):
            points[key] = weight
            total += weight
            reasons.append(labels.get(key, key))
    total = min(100, total)
    return total, reasons, points


def heuristic_fallback(case: dict[str, Any], *, message: str = '') -> dict[str, Any]:
    """Lightweight fallback if primary classifier throws."""
    text = _blob(case, message)
    score = 20
    reasons = ['Heuristic fallback scoring']
    if any(w in text for w in ('hit', 'beat', 'assault', 'weapon', 'bat', 'knife', 'gun')):
        score = 80
        reasons = ['Violence / weapon signals (fallback)', 'Recommend urgent review']
    if any(w in text for w in ('kill', 'bleed', 'rape')):
        score = 92
        reasons = ['Critical danger signals (fallback)', 'Recommend police']
    tier, severity = _tier(score)
    return {
        'agent': 'risk_assessment_engine',
        'source': 'heuristic_fallback',
        'risk_index': score,
        'risk_score': score,
        'tier': tier,
        'severity': severity,
        'confidence': 0.55,
        'scores': {'fallback': score},
        'reasons': reasons,
        'emotion': detect_emotion(message or (case.get('notes') or '')),
        'trend': 'stable',
        'delta': 0,
        'flags': {
            'abuser_present_now': 'here' in text or 'right now' in text,
            'calming_signal': False,
            'self_harm': 'suicid' in text,
            'weapon': any(w in text for w in ('bat', 'gun', 'knife', 'weapon')),
            'children': 'child' in text,
            'financial_abuse': False,
            'stalking': False,
            'has_gps': case.get('lat') is not None,
        },
        'message': f'Risk {tier} ({score}/100 · fallback)',
    }


def _tier(score: int) -> tuple[str, str]:
    if score >= 75:
        return 'CRITICAL', 'critical'
    if score >= 50:
        return 'HIGH', 'high'
    if score >= 25:
        return 'MEDIUM', 'medium'
    return 'LOW', 'low'


def classify_severity(
    case: dict[str, Any],
    *,
    message: str = '',
    history: list[dict[str, str]] | None = None,
    emotion: dict[str, Any] | None = None,
    previous_risk: float | None = None,
) -> dict[str, Any]:
    """
    Additive 0–100 NLP feature classifier.
    Example: \"My husband hit me with a bat.\" → weapon+assault+IPV → CRITICAL.
    """
    try:
        text = _blob(case, message, history)
        emotion = emotion or detect_emotion(message or (case.get('notes') or ''))
        features = extract_features(text, case)
        risk_i, reasons, points = score_features(features)

        # Soft floor: assault + weapon must never be LOW
        if features.get('physical_assault') and features.get('weapon'):
            risk_i = max(risk_i, 90)
            if 'Immediate danger' not in reasons:
                reasons.append('Immediate danger')
            if 'Recommend police' not in reasons:
                reasons.append('Recommend police')

        if features.get('sexual_assault') or features.get('death_threat'):
            risk_i = max(risk_i, 85)

        risk_i = min(100, risk_i)

        # Smooth vs previous — rise faster than fall
        if previous_risk is not None:
            prev = float(previous_risk)
            if risk_i < prev:
                risk_i = int(round(prev * 0.72 + risk_i * 0.28))
            else:
                risk_i = int(round(prev * 0.2 + risk_i * 0.8))

        tier, severity = _tier(risk_i)
        has_gps = case.get('lat') is not None and case.get('lng') is not None

        trend = 'stable'
        delta = 0
        if previous_risk is not None:
            delta = risk_i - int(previous_risk)
            if delta >= 4:
                trend = 'increasing'
            elif delta <= -4:
                trend = 'decreasing'

        signal_count = sum(1 for v in features.values() if v)
        confidence = min(0.99, 0.6 + 0.05 * min(signal_count, 7))

        # Dimension bars 0–100 for realtime UI (not raw feature weights)
        dimensions = _dimension_scores(features, emotion, risk_i)

        recommend = 'Monitor and support'
        if tier == 'CRITICAL':
            recommend = 'Immediate Police Escalation'
        elif tier == 'HIGH':
            recommend = 'Priority NGO + police readiness'
        elif tier == 'MEDIUM':
            recommend = 'NGO follow-up within the hour'

        return {
            'agent': 'risk_assessment_engine',
            'source': 'nlp_additive_classifier',
            'risk_index': risk_i,
            'risk_score': risk_i,
            'tier': tier,
            'severity': severity,
            'confidence': round(confidence, 2),
            'scores': dimensions,
            'feature_points': points,
            'features': features,
            'reasons': reasons[:10],
            'recommendation': recommend,
            'emotion': emotion,
            'trend': trend,
            'delta': delta,
            'flags': {
                'abuser_present_now': bool(features.get('current_danger')),
                'calming_signal': bool(
                    re.search(r"\b(i('m| am) (okay|safe|fine)( now)?)\b", text)
                ),
                'self_harm': bool(features.get('suicide_risk')),
                'weapon': bool(features.get('weapon')),
                'children': bool(features.get('children_involved') or features.get('pregnant')),
                'financial_abuse': bool(features.get('financial_abuse')),
                'stalking': bool(features.get('stalking')),
                'has_gps': has_gps,
            },
            'message': f'Risk {tier} ({risk_i}/100 · {int(confidence * 100)}% confidence)',
        }
    except Exception:
        return heuristic_fallback(case, message=message)


def _dimension_scores(
    features: dict[str, bool],
    emotion: dict[str, Any],
    overall: int,
) -> dict[str, int]:
    """Map features → animated risk breakdown bars."""
    physical = 8
    if features.get('physical_assault'):
        physical += 55
    if features.get('weapon'):
        physical += 30
    if features.get('bleeding') or features.get('medical_emergency'):
        physical += 20
    physical = min(100, physical)

    emotional = int(float(emotion.get('intensity') or 0.3) * 55)
    if features.get('fear_distress') or features.get('panic'):
        emotional += 35
    if emotion.get('primary') in ('fear', 'shame', 'sadness'):
        emotional += 15
    emotional = min(100, emotional)

    threat = 5
    if features.get('death_threat'):
        threat += 55
    if features.get('threat'):
        threat += 30
    if features.get('weapon'):
        threat += 20
    if features.get('current_danger'):
        threat += 15
    threat = min(100, threat)

    child = 5
    if features.get('children_involved'):
        child += 55
    if features.get('pregnant'):
        child += 35
    child = min(100, child)

    isolation = 5
    if features.get('locked_inside'):
        isolation += 50
    if features.get('victim_alone'):
        isolation += 25
    if features.get('control_behaviour'):
        isolation += 25
    isolation = min(100, isolation)

    medical = 5
    if features.get('bleeding'):
        medical += 50
    if features.get('medical_emergency'):
        medical += 45
    medical = min(100, medical)

    self_harm = 5
    if features.get('suicide_risk'):
        self_harm += 80
    self_harm = min(100, self_harm)

    return {
        'physical_safety': physical,
        'emotional_distress': emotional,
        'threat_escalation': threat,
        'child_safety': child,
        'isolation': isolation,
        'medical_risk': medical,
        'self_harm_concern': self_harm,
        'weapon_risk': 90 if features.get('weapon') else 5,
        'stalking': 75 if features.get('stalking') else 5,
        'financial_abuse': 70 if features.get('financial_abuse') else 5,
        'urgency': min(100, 40 + (25 if features.get('current_danger') else 0) + overall // 5),
        'overall': overall,
    }
