from __future__ import annotations

from typing import Any

from backend.cases import utc_now
from backend.orchestration.agents.dispatch import run_dispatch
from backend.orchestration.agents.legal import run_legal
from backend.orchestration.agents.notify import run_notify
from backend.orchestration.agents.risk import assess_risk
from backend.orchestration.agents.therapy import run_therapy
from backend.orchestration.crisis.live import publish_case
from backend.orchestration.crisis.pipeline import run_crisis_pipeline
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
    """Crisis pipeline → risk → legal → therapy → dispatch → notify → live board."""
    plan: list[dict[str, Any]] = []

    run_crisis_pipeline(case, trigger=trigger)
    plan.append(
        {
            'step': 0,
            'agent': 'crisis_pipeline',
            'action': 'analyse',
            'rationale': (case.get('ai_summary') or {}).get('headline'),
        }
    )

    risk = assess_risk(case)
    case['risk_score'] = risk['risk_score']
    case['risk_tier'] = risk['risk_tier']
    if risk.get('severity'):
        case['severity'] = risk['severity']
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
    from backend.orchestration.crisis.companion import legal_plain_reply

    hits = list(legal.get('sources') or [])
    plain_legal = legal_plain_reply(
        message=case.get('notes') or 'What are my rights?',
        hits=hits,
        severity={
            'tier': (case.get('crisis') or {}).get('tier') or 'MEDIUM',
            'flags': (case.get('crisis') or {}).get('flags') or {},
        },
    )
    case['legal_brief'] = {
        'answer': plain_legal,
        'sources': hits,
        'source': legal.get('source') or 'rag',
        'at': utc_now(),
    }
    _log_event(case, {**legal, 'answer': plain_legal})
    plan.append(
        {
            'step': 2,
            'agent': 'legal',
            'action': 'brief',
            'rationale': 'Plain-language rights with RAG sources',
        }
    )

    therapy = run_therapy(case)
    from backend.orchestration.crisis.companion import therapy_companion_reply
    from backend.orchestration.crisis.memory import get_memory
    from backend.orchestration.crisis.safety import plan_safety

    sev_pack = {
        'tier': (case.get('crisis') or {}).get('tier') or 'MEDIUM',
        'flags': (case.get('crisis') or {}).get('flags') or {},
        'emotion': (case.get('crisis') or {}).get('emotion') or {},
    }
    safety = case.get('safety_plan') or plan_safety(case, sev_pack)
    plain_therapy = therapy_companion_reply(
        message=case.get('notes') or 'I need support',
        severity=sev_pack,
        safety=safety,
        memory=get_memory(case.get('id') or ''),
        name=case.get('name'),
    )
    case['therapy_brief'] = {
        'answer': plain_therapy,
        'source': 'crisis-companion',
        'escalate_human': sev_pack['tier'] in ('HIGH', 'CRITICAL'),
        'at': utc_now(),
    }
    _log_event(case, {**therapy, 'answer': plain_therapy, 'source': 'crisis-companion'})
    plan.append(
        {
            'step': 3,
            'agent': 'therapy',
            'action': 'support',
            'rationale': 'Companion support',
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
    publish_case(case, event_type='ngo_assigned' if dispatch['routing'] == 'ngo' else 'dispatch')
    from backend.orchestration.crisis.timeline import append_timeline

    if dispatch['routing'] == 'ngo':
        append_timeline(case, 'NGO assigned', detail=str((dispatch.get('escalation_contacts') or {}).get('ngo') or 'NGO route'))
    elif dispatch['routing'] == 'police':
        append_timeline(case, 'Police escalation recommended', detail='High-priority routing')

    notify = run_notify(case)
    case['notify_status'] = notify['status']
    _log_event(case, {**notify, 'message': notify['message']})
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
    if dispatch['routing'] == 'police':
        publish_case(case, event_type='police_notified')

    live = dict(case.get('live_status') or {})
    live.update(
        {
            'analysing': False,
            'police_notified': case.get('routing') == 'police' or notify.get('status') == 'sent',
            'ngo_assigned': case.get('routing') in ('ngo', 'police'),
            'safe_house_found': (case.get('risk_tier') == 'critical'),
        }
    )
    case['live_status'] = live

    sc = dict(case.get('secure_channel') or {})
    plaintext_token = None
    if not sc.get('token_hash'):
        plaintext_token, token_hash = issue_secure_token()
        sc['token_hash'] = token_hash
        sc['messages'] = sc.get('messages') or []
        sc['created_at'] = utc_now()
    case['secure_channel'] = sc

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

    if plaintext_token:
        case['_secure_token_plaintext'] = plaintext_token

    publish_case(case, event_type='case_update')
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
        'ai_summary': case.get('ai_summary'),
        'next_actions': case.get('next_actions'),
        'live_status': case.get('live_status'),
        'pipeline': case.get('pipeline'),
        'crisis': case.get('crisis'),
        'safety_plan': case.get('safety_plan'),
        'timeline': case.get('timeline'),
        'risk_history': case.get('risk_history'),
    }
