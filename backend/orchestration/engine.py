from __future__ import annotations

from typing import Any

from backend.cases import utc_now
from backend.orchestration.agents.dispatch import run_dispatch
from backend.orchestration.agents.legal import run_legal
from backend.orchestration.agents.notify import run_notify
from backend.orchestration.agents.risk import assess_risk
from backend.orchestration.agents.therapy import run_therapy
from backend.orchestration.privacy import encrypt_text, issue_secure_token


def _log_event(case: dict[str, Any], event: dict[str, Any]) -> None:
    log = list(case.get('agent_log') or [])
    log.append(
        {
            'at': utc_now(),
            'agent': event.get('agent'),
            'message': event.get('message') or event.get('rationale') or '',
            'source': event.get('source'),
            'meta': {
                k: v
                for k, v in event.items()
                if k
                not in (
                    'agent',
                    'message',
                    'rationale',
                    'source',
                    'answer',
                    'pack',
                    'attempts',
                )
            },
        }
    )
    case['agent_log'] = log[-100:]


def run_orchestration(case: dict[str, Any], *, trigger: str = 'create') -> dict[str, Any]:
    """Run risk → legal tip → therapy tip → dispatch → notify and mutate case."""
    plan: list[dict[str, Any]] = []

    risk = assess_risk(case)
    case['risk_score'] = risk['risk_score']
    case['risk_tier'] = risk['risk_tier']
    if risk.get('severity'):
        case['severity'] = risk['severity']
        # Keep legacy admin field in sync
        sev = risk['severity']
        case['Severity of domestic violence'] = (
            'Very High' if sev == 'critical' else sev.replace('_', ' ').title()
        )
    _log_event(case, risk)
    plan.append(
        {
            'step': 1,
            'agent': 'risk',
            'action': 'assess',
            'rationale': risk.get('rationale'),
        }
    )

    legal = run_legal(case)
    case['legal_brief'] = {
        'answer': legal['answer'],
        'source': legal['source'],
        'at': utc_now(),
    }
    _log_event(case, legal)
    plan.append(
        {
            'step': 2,
            'agent': 'legal',
            'action': 'brief',
            'rationale': legal.get('rationale'),
        }
    )

    therapy = run_therapy(case)
    case['therapy_brief'] = {
        'answer': therapy['answer'],
        'source': therapy['source'],
        'escalate_human': therapy.get('escalate_human', False),
        'at': utc_now(),
    }
    _log_event(case, therapy)
    plan.append(
        {
            'step': 3,
            'agent': 'therapy',
            'action': 'support',
            'rationale': therapy.get('rationale'),
        }
    )

    dispatch = run_dispatch(case)
    case['routing'] = dispatch['routing']
    case['escalation_contacts'] = dispatch['escalation_contacts']
    _log_event(case, dispatch)
    plan.append(
        {
            'step': 4,
            'agent': 'dispatch',
            'action': f"route:{dispatch['routing']}",
            'rationale': dispatch.get('rationale'),
        }
    )

    notify = run_notify(case)
    case['notify_status'] = notify['status']
    _log_event(case, {**notify, 'message': notify['message']})
    # Keep attempt detail in last log entry meta
    if case['agent_log']:
        case['agent_log'][-1]['meta'] = {
            **(case['agent_log'][-1].get('meta') or {}),
            'attempts': notify.get('attempts'),
        }
    plan.append(
        {
            'step': 5,
            'agent': 'notify',
            'action': notify['status'],
            'rationale': notify.get('rationale'),
        }
    )

    # Secure channel bootstrap (once)
    sc = dict(case.get('secure_channel') or {})
    plaintext_token = None
    if not sc.get('token_hash'):
        plaintext_token, token_hash = issue_secure_token()
        sc['token_hash'] = token_hash
        sc['messages'] = sc.get('messages') or []
        sc['created_at'] = utc_now()
    case['secure_channel'] = sc

    # Encrypt phone at rest if present (store cipher alongside clear for admin decrypt path)
    phone = case.get('phone')
    if phone and not str(phone).startswith(('fernet:', 'b64:')):
        case['phone_encrypted'] = encrypt_text(phone)

    case['privacy'] = {
        'redacted_preview': False,
        'contact_visible_to': 'admin',
        'phone_encrypted': bool(case.get('phone_encrypted')),
    }
    case['agent_plan'] = plan
    case['orchestration'] = {
        'trigger': trigger,
        'completed_at': utc_now(),
        'risk_score': case.get('risk_score'),
        'risk_tier': case.get('risk_tier'),
        'routing': case.get('routing'),
    }
    case['updated_at'] = utc_now()

    # Attach one-time token only in memory for API response (not persisted as plaintext)
    if plaintext_token:
        case['_secure_token_plaintext'] = plaintext_token

    return case


def survivor_summary(case: dict[str, Any]) -> dict[str, Any]:
    token = case.pop('_secure_token_plaintext', None)
    return {
        'case_id': case.get('id'),
        'risk_score': case.get('risk_score'),
        'risk_tier': case.get('risk_tier'),
        'routing': case.get('routing'),
        'legal_tip': (case.get('legal_brief') or {}).get('answer'),
        'therapy_tip': (case.get('therapy_brief') or {}).get('answer'),
        'notify_status': case.get('notify_status'),
        'secure_token': token,
        'agent_plan': case.get('agent_plan'),
    }
