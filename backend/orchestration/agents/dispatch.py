from __future__ import annotations

from typing import Any, Literal

Routing = Literal['admin', 'ngo', 'police']


def run_dispatch(case: dict[str, Any]) -> dict[str, Any]:
    """Map risk tier / severity / frequency → routing + contacts."""
    from backend.cases import escalation_contacts

    tier = case.get('risk_tier') or case.get('severity') or 'medium'
    severity = case.get('severity') or 'medium'
    frequency = case.get('frequency') or 'once'

    routing: Routing
    if tier in ('critical', 'high') or severity in ('critical', 'high'):
        routing = 'police'
        rationale = 'High/critical risk → Police'
    elif frequency in ('repeated', 'ongoing') or tier == 'medium' and frequency != 'once':
        # Keep README semantics: repeated/ongoing (non-critical) → NGO
        if severity in ('critical', 'high') or tier in ('critical', 'high'):
            routing = 'police'
            rationale = 'Severity overrides → Police'
        else:
            routing = 'ngo'
            rationale = 'Repeated/ongoing pattern → NGO'
    else:
        routing = 'admin'
        rationale = 'Standard desk follow-up'

    # Prefer explicit frequency rule when not high/critical
    if severity not in ('high', 'critical') and tier not in ('high', 'critical'):
        if frequency in ('repeated', 'ongoing'):
            routing = 'ngo'
            rationale = 'Repeated/ongoing (non-critical) → NGO'

    contacts = escalation_contacts(routing)
    return {
        'agent': 'dispatch',
        'routing': routing,
        'escalation_contacts': contacts,
        'rationale': rationale,
        'message': f'Dispatch → {routing}: {rationale}',
        'source': 'rules',
    }
