from __future__ import annotations

from typing import Any

from backend.orchestration.crisis.severity import classify_severity


def assess_risk(case: dict[str, Any]) -> dict[str, Any]:
    """
    Risk triage via Crisis Severity Model (feature classifier).
    Does NOT call the main LLM.
    """
    result = classify_severity(
        case,
        message=case.get('notes') or '',
        previous_risk=case.get('risk_score'),
    )
    return {
        'agent': 'risk',
        'risk_score': result['risk_index'],
        'risk_tier': result['severity'],
        'severity': result['severity'],
        'source': 'crisis_severity_model',
        'rationale': '; '.join(result.get('reasons') or [])[:240],
        'message': result.get('message'),
        'scores': result.get('scores'),
        'confidence': result.get('confidence'),
        'reasons': result.get('reasons'),
        'flags': result.get('flags'),
        'emotion': result.get('emotion'),
        'tier_label': result.get('tier'),
    }
