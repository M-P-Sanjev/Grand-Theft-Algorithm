from __future__ import annotations

from typing import Any, Callable, Optional

from backend.cases import utc_now
from backend.orchestration.crisis.emotion import detect_emotion
from backend.orchestration.crisis.live import publish, publish_case
from backend.orchestration.crisis.memory import get_memory, update_memory
from backend.orchestration.crisis.safety import plan_safety
from backend.orchestration.crisis.severity import classify_severity
from backend.orchestration.crisis.summary import build_case_summary, recommend_next_actions
from backend.orchestration.crisis.timeline import append_risk_point, append_timeline
from backend.orchestration.rag.mongo_store import vector_search


PipelineHook = Optional[Callable[[dict[str, Any]], None]]


def _emit(case_id: str, stage: str, detail: dict[str, Any], hook: PipelineHook = None) -> dict[str, Any]:
    event = {
        'type': 'pipeline_stage',
        'case_id': case_id,
        'stage': stage,
        'detail': detail,
        'at': utc_now(),
    }
    publish(event)
    if hook:
        hook(event)
    return event


def run_crisis_pipeline(case: dict[str, Any], *, trigger: str = 'create') -> dict[str, Any]:
    """
    Full intake pipeline for a new/updated case:
    note → emotion → severity → safety → legal RAG → therapy RAG → summary → live.
    """
    case_id = case.get('id') or 'unknown'
    notes = case.get('notes') or ''
    stages: list[dict[str, Any]] = []

    def hook(ev: dict[str, Any]) -> None:
        stages.append({'stage': ev['stage'], 'at': ev['at'], 'detail': ev.get('detail')})

    _emit(case_id, 'incoming_note', {'preview': notes[:160]}, hook)
    append_timeline(case, 'Victim created case', detail=(notes or '')[:120])

    emotion = detect_emotion(notes)
    _emit(case_id, 'emotion_detected', emotion, hook)
    append_timeline(
        case,
        'Emotion detected',
        detail=f"{emotion.get('primary')} ({int(float(emotion.get('intensity') or 0) * 100)}%)",
        meta=emotion,
    )

    prev = case.get('risk_score')
    severity = classify_severity(case, message=notes, emotion=emotion, previous_risk=prev)
    case['risk_score'] = severity['risk_index']
    case['risk_tier'] = severity['severity']
    case['severity'] = severity['severity']
    case['Severity of domestic violence'] = (
        'Very High' if severity['severity'] == 'critical' else severity['severity'].title()
    )
    case['crisis'] = {
        'scores': severity['scores'],
        'reasons': severity['reasons'],
        'confidence': severity['confidence'],
        'tier': severity['tier'],
        'flags': severity['flags'],
        'emotion': emotion,
        'trend': severity.get('trend'),
        'delta': severity.get('delta'),
    }
    append_risk_point(case, severity)
    _emit(case_id, 'severity_prediction', severity, hook)
    append_timeline(
        case,
        'Initial AI assessment completed',
        detail=f"Risk {severity['risk_index']} {severity['tier']} · {int(severity['confidence']*100)}% confidence",
        meta={'reasons': severity['reasons'][:4]},
    )
    append_timeline(
        case,
        f"Risk Score {severity['risk_index']} {severity['tier']}",
        detail='; '.join(severity['reasons'][:3]),
    )

    safety = plan_safety(case, severity)
    case['safety_plan'] = safety
    _emit(case_id, 'safety_plan', safety, hook)

    legal_hits = vector_search('legal', notes or 'domestic violence protection', top_k=3)
    therapy_hits = vector_search('therapy', notes or 'fear safety support', top_k=3)
    case['resources_found'] = {
        'legal': [
            {
                'title': h.get('title'),
                'plain': _plain_law_title(h),
                'source': h.get('source'),
            }
            for h in legal_hits
        ],
        'therapy': [{'title': h.get('title'), 'source': h.get('source')} for h in therapy_hits],
    }
    _emit(
        case_id,
        'laws_retrieved',
        {'count': len(legal_hits), 'items': case['resources_found']['legal']},
        hook,
    )
    _emit(
        case_id,
        'resources_found',
        {'count': len(therapy_hits), 'items': case['resources_found']['therapy']},
        hook,
    )

    summary = build_case_summary(case, severity)
    case['ai_summary'] = summary
    case['next_actions'] = summary.get('next_actions') or recommend_next_actions(case, severity)
    _emit(case_id, 'ai_summary', summary, hook)

    # Status board for victim live view
    case['live_status'] = {
        'analysing': False,
        'severity_detected': severity['tier'],
        'risk_index': severity['risk_index'],
        'resources_found': True,
        'police_notified': case.get('routing') == 'police',
        'ngo_assigned': case.get('routing') in ('ngo', 'police'),
        'lawyer_assigned': False,
        'safe_house_found': severity['tier'] == 'CRITICAL',
        'plain': summary.get('plain_status'),
    }

    case['pipeline'] = {
        'trigger': trigger,
        'stages': stages,
        'completed_at': utc_now(),
    }
    case['updated_at'] = utc_now()
    publish_case(case, event_type='case_update')
    _emit(case_id, 'dashboard_updated', {'ok': True}, hook)
    return case


def process_victim_message(
    case: dict[str, Any],
    *,
    kind: str,
    message: str,
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Per-message pipeline used by therapy/legal chat."""
    case_id = case.get('id') or 'unknown'
    stages: list[dict[str, Any]] = []

    def hook(ev: dict[str, Any]) -> None:
        stages.append(ev)

    _emit(case_id, 'incoming_note', {'kind': kind, 'preview': message[:120]}, hook)
    append_timeline(
        case,
        'New victim message',
        detail=f'{kind}: {(message or "")[:100]}',
        meta={'kind': kind},
    )

    emotion = detect_emotion(message, prior=(case.get('crisis') or {}).get('emotion'))
    _emit(case_id, 'emotion_detected', emotion, hook)
    append_timeline(
        case,
        'Emotion changed',
        detail=str(emotion.get('primary') or 'distress'),
        meta=emotion,
    )

    severity = classify_severity(
        case,
        message=message,
        history=history,
        emotion=emotion,
        previous_risk=case.get('risk_score'),
    )
    case['risk_score'] = severity['risk_index']
    case['risk_tier'] = severity['severity']
    rank = {'low': 0, 'medium': 1, 'high': 2, 'critical': 3}
    if rank.get(severity['severity'], 0) > rank.get(str(case.get('severity') or 'medium'), 1):
        case['severity'] = severity['severity']
    case['crisis'] = {
        'scores': severity['scores'],
        'reasons': severity['reasons'],
        'confidence': severity['confidence'],
        'tier': severity['tier'],
        'flags': severity['flags'],
        'emotion': emotion,
        'trend': severity.get('trend'),
        'delta': severity.get('delta'),
    }
    append_risk_point(case, severity)
    _emit(case_id, 'severity_prediction', severity, hook)
    append_timeline(
        case,
        'Risk score recalculated',
        detail=f"{severity['risk_index']} {severity['tier']} ({severity.get('trend')})",
        meta={'reasons': severity['reasons'][:4], 'scores': severity['scores']},
    )

    safety = plan_safety(case, severity)
    case['safety_plan'] = safety
    _emit(case_id, 'safety_plan', safety, hook)

    domain = 'legal' if kind == 'legal' else 'therapy'
    hits = vector_search(domain, message, top_k=4)
    _emit(
        case_id,
        'laws_retrieved' if kind == 'legal' else 'resources_found',
        {'count': len(hits)},
        hook,
    )
    append_timeline(
        case,
        'Legal guidance generated' if kind == 'legal' else 'Therapy session update',
        detail=f'{len(hits)} sources retrieved',
    )

    summary = build_case_summary(case, severity)
    case['ai_summary'] = summary
    case['next_actions'] = summary.get('next_actions')
    case['live_status'] = {
        **(case.get('live_status') or {}),
        'analysing': False,
        'severity_detected': severity['tier'],
        'risk_index': severity['risk_index'],
        'resources_found': bool(hits),
        'plain': summary.get('plain_status'),
    }
    case['last_ai_action'] = (
        'Legal guidance generated' if kind == 'legal' else 'Therapy companion responded'
    )
    case['last_activity_at'] = utc_now()

    mem = update_memory(case_id, message=message, emotion=emotion, case=case)
    history_list = list(case.get('crisis_history') or [])
    history_list.append({'at': utc_now(), 'kind': kind, 'risk': severity['risk_index']})
    case['crisis_history'] = history_list[-20:]
    case['pipeline_live'] = {'stages': [{'stage': s['stage'], 'at': s['at']} for s in stages]}
    case['updated_at'] = utc_now()
    publish_case(case, event_type='case_update')
    _emit(case_id, 'dashboard_updated', {'ok': True, 'risk': severity['risk_index']}, hook)
    publish({'type': 'typing', 'case_id': case_id, 'role': 'ai', 'active': False})

    return {
        'emotion': emotion,
        'severity': severity,
        'safety': safety,
        'hits': hits,
        'summary': summary,
        'memory': mem,
        'stages': stages,
    }


def _plain_law_title(h: dict[str, Any]) -> str:
    title = (h.get('title') or h.get('section') or 'Legal protection').strip()
    low = title.lower()
    if 'protection' in low or '18' in low:
        return 'A legal order that can stop the abuser from contacting or hurting you'
    if 'fir' in low:
        return 'How to report the crime to the police'
    if 'pwdva' in low or 'domestic violence' in low:
        return 'Domestic Violence Law protections'
    return title[:120]
