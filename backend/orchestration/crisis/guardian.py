"""Guardian Mode helpers — transcript-driven re-risk + live publish."""

from __future__ import annotations

import logging
import time
from typing import Any

from backend.cases import get_case, update_case, utc_now
from backend.orchestration.crisis.keywords import (
    build_live_summary,
    detect_keywords,
    keyword_risk_bump,
)
from backend.orchestration.crisis.live import publish, publish_case
from backend.orchestration.crisis.timeline import append_timeline, append_risk_point

logger = logging.getLogger(__name__)

# Soft throttle for Gemini summary polish (case_id -> monotonic ts)
_SUMMARY_POLISH_AT: dict[str, float] = {}


def apply_transcript_chunk(
    case_id: str,
    text: str,
    *,
    final: bool = False,
    t_sec: float | None = None,
    source: str = 'browser',
) -> dict[str, Any] | None:
    """Append transcript, reclassify risk from full text, publish live events."""
    case = get_case(case_id)
    if not case:
        return None

    chunk = (text or '').strip()
    if not chunk:
        return case

    guardian = dict(case.get('guardian') or {})
    transcript = list(guardian.get('transcript') or [])
    now = utc_now()
    prev_risk = case.get('risk_score')
    line = {
        'text': chunk,
        'at': now,
        'final': final,
        't_sec': t_sec,
        'source': source,
    }
    transcript.append(line)
    guardian['transcript'] = transcript[-80:]
    guardian['active'] = True
    guardian['recording'] = True

    if not guardian.get('transcript_started'):
        guardian['transcript_started'] = True
        append_timeline(case, 'Transcript started', detail='Live captions active')

    # Keyword / threat detection on this chunk
    new_events = detect_keywords(chunk, t_sec=t_sec, at=now)
    events = list(guardian.get('detected_events') or [])
    seen_keys = {f"{e.get('kind')}|{e.get('t_sec')}|{e.get('label')}" for e in events}
    for ev in new_events:
        key = f"{ev.get('kind')}|{ev.get('t_sec')}|{ev.get('label')}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        events.append(ev)
        append_timeline(case, ev['label'], detail=f"{chunk[:120]} · t={t_sec}")
        publish(
            {
                'type': 'detected_event',
                'case_id': case_id,
                'event': ev,
                'text': chunk,
            }
        )
    guardian['detected_events'] = events[-40:]
    case['guardian'] = guardian

    # Accumulate notes for classifiers
    prior = case.get('notes') or ''
    if 'Guardian Mode activated' in prior and len(prior) < 80:
        combined = f'{prior}\n{chunk}'.strip()
    else:
        combined = f'{prior}\n{chunk}'.strip() if chunk not in prior else prior
    case['notes'] = combined[-8000:]
    case['Current Situation'] = case['notes']

    conversation = list(case.get('conversation') or [])
    conversation.append(
        {
            'role': 'victim',
            'content': chunk,
            'at': now,
            'source': 'guardian_transcript',
            't_sec': t_sec,
        }
    )
    case['conversation'] = conversation[-40:]

    append_timeline(case, 'Transcript detected', detail=chunk[:160])

    emotion: dict[str, Any] = {}
    violence: dict[str, Any] = {}
    try:
        from backend.orchestration.crisis.emotion import detect_emotion

        emotion = detect_emotion(case['notes'])
    except Exception as exc:
        logger.warning('guardian emotion failed: %s', exc)

    try:
        from backend.orchestration.crisis.severity import (
            extract_features,
            classify_severity,
            heuristic_fallback,
        )

        feats = extract_features(case['notes'].lower(), case)
        violence = {
            'weapon': bool(feats.get('weapon')) or any(e.get('kind') == 'weapon' for e in events),
            'physical_assault': bool(feats.get('physical_assault'))
            or any(e.get('kind') == 'assault' for e in events),
            'bleeding': bool(feats.get('bleeding')) or any(e.get('kind') == 'bleeding' for e in events),
            'help': 'help' in case['notes'].lower() or any(e.get('kind') == 'help' for e in events),
        }
        try:
            sev = classify_severity(case, message=case['notes'], previous_risk=case.get('risk_score'))
        except Exception:
            sev = heuristic_fallback(case, message=case['notes'])
    except Exception as exc:
        logger.warning('guardian severity failed: %s', exc)
        sev = {
            'risk_index': case.get('risk_score') or 40,
            'severity': case.get('severity') or 'medium',
            'tier': ((case.get('crisis') or {}).get('tier') or 'MEDIUM'),
            'reasons': ['Guardian transcript update'],
            'flags': {},
            'emotion': emotion,
            'recommendation': 'Stay on the line with Safra',
        }

    # Deterministic keyword bump on top of classifier
    bump = keyword_risk_bump(new_events)
    base = int(sev.get('risk_index') or case.get('risk_score') or 25)
    risk_index = min(100, base + bump)
    if risk_index >= 85:
        severity = 'critical'
        tier = 'CRITICAL'
    elif risk_index >= 65:
        severity = 'high'
        tier = 'HIGH'
    elif risk_index >= 40:
        severity = 'medium'
        tier = 'MEDIUM'
    else:
        severity = 'low'
        tier = 'LOW'
    sev['risk_index'] = risk_index
    sev['severity'] = severity
    sev['tier'] = tier
    if bump:
        reasons = list(sev.get('reasons') or [])
        reasons.append(f'Keyword threat +{bump}')
        sev['reasons'] = reasons

    if risk_index >= 70 and (case.get('routing') or '') != 'police':
        try:
            from backend.orchestration.agents.dispatch import run_dispatch

            case['routing'] = 'police'
            case['escalation_contacts'] = run_dispatch({**case, 'severity': 'critical'})[
                'escalation_contacts'
            ]
            append_timeline(case, 'Police Recommended', detail=f'Risk {risk_index}')
        except Exception:
            case['routing'] = 'police'
            append_timeline(case, 'Police Recommended', detail=f'Risk {risk_index}')

    crisis = dict(case.get('crisis') or {})
    crisis['emotion'] = emotion or crisis.get('emotion')
    crisis['violence'] = violence
    crisis.update(
        {
            'tier': sev.get('tier'),
            'reasons': sev.get('reasons'),
            'scores': sev.get('scores'),
            'confidence': sev.get('confidence') or 0.9,
            'flags': sev.get('flags'),
            'recommendation': sev.get('recommendation'),
        }
    )
    case['crisis'] = crisis
    case['risk_score'] = risk_index
    case['risk_tier'] = severity
    case['severity'] = severity
    case['ai_recommendation'] = sev.get('recommendation') or case.get('ai_recommendation')

    try:
        from backend.orchestration.agents.dispatch import run_dispatch

        dispatch = run_dispatch(case)
        case['routing'] = dispatch['routing']
        case['escalation_contacts'] = dispatch['escalation_contacts']
    except Exception:
        pass

    # Risk delta timeline
    if prev_risk is not None and abs(int(prev_risk) - risk_index) >= 2:
        append_timeline(
            case,
            f'Risk Increased · {prev_risk}→{risk_index}'
            if risk_index > int(prev_risk)
            else f'Risk updated · {prev_risk}→{risk_index}',
            detail=', '.join(sev.get('reasons') or [])[:200],
        )
    else:
        append_timeline(
            case,
            f"Risk updated · {sev.get('tier')} ({risk_index})",
            detail=', '.join(sev.get('reasons') or [])[:200],
        )

    append_risk_point(case, sev)

    summary = build_live_summary(
        notes=case['notes'],
        events=events,
        risk_score=risk_index,
        risk_tier=severity,
        emotion=emotion,
        recommendation=case.get('ai_recommendation'),
    )
    # Throttled Gemini polish
    now_m = time.monotonic()
    last_polish = _SUMMARY_POLISH_AT.get(case_id, 0)
    critical_jump = risk_index >= 85 and (prev_risk is None or int(prev_risk) < 85)
    if critical_jump or now_m - last_polish >= 8:
        try:
            from backend.orchestration.crisis.stt_gemini import polish_summary

            summary = polish_summary(summary, case['notes'])
            _SUMMARY_POLISH_AT[case_id] = now_m
        except Exception:
            pass
    guardian['live_summary'] = summary
    case['guardian'] = guardian

    live = dict(case.get('live_status') or {})
    live.update(
        {
            'analysing': False,
            'severity_detected': sev.get('tier'),
            'risk_index': risk_index,
            'plain': f'Risk {sev.get("tier")} ({risk_index}/100)',
            'guardian_recording': True,
            'live_summary': summary,
        }
    )
    case['live_status'] = live

    updated = update_case(
        case_id,
        notes=case['notes'],
        guardian=case['guardian'],
        conversation=case['conversation'],
        timeline=case.get('timeline'),
        crisis=case['crisis'],
        risk_score=case['risk_score'],
        risk_tier=case['risk_tier'],
        severity=case['severity'],
        routing=case.get('routing'),
        escalation_contacts=case.get('escalation_contacts'),
        risk_history=case.get('risk_history'),
        live_status=case['live_status'],
        ai_recommendation=case.get('ai_recommendation'),
        **{'Current Situation': case['notes']},
    )
    case = updated or case

    g = case.get('guardian') or {}
    publish(
        {
            'type': 'transcript_chunk',
            'case_id': case_id,
            'text': chunk,
            'at': now,
            't_sec': t_sec,
            'final': final,
            'source': source,
            'risk_score': risk_index,
            'risk_tier': severity,
            'guardian': {
                'active': True,
                'recording': True,
                'transcript_tail': (g.get('transcript') or [])[-12:],
                'transcript_count': len(g.get('transcript') or []),
                'detected_events': (g.get('detected_events') or [])[-12:],
                'live_summary': g.get('live_summary'),
                'evidence_pending': bool(g.get('evidence_pending')),
            },
        }
    )
    publish(
        {
            'type': 'guardian_summary',
            'case_id': case_id,
            'live_summary': summary,
            'risk_score': risk_index,
            'risk_tier': severity,
            'recommendation': case.get('ai_recommendation'),
        }
    )
    if emotion:
        publish(
            {
                'type': 'pipeline_stage',
                'case_id': case_id,
                'stage': 'emotion_detected',
                'label': f"Emotion · {(emotion.get('primary') or 'fear').title()}",
                'detail': emotion,
            }
        )
    if violence.get('weapon') or violence.get('physical_assault'):
        publish(
            {
                'type': 'pipeline_stage',
                'case_id': case_id,
                'stage': 'violence_detected',
                'label': 'Violence · Weapon Mention' if violence.get('weapon') else 'Violence detected',
                'detail': violence,
            }
        )
    # Debounce tiny risk wobbles for risk_complete noise
    if prev_risk is None or abs(int(prev_risk) - risk_index) >= 2:
        publish(
            {
                'type': 'pipeline_stage',
                'case_id': case_id,
                'stage': 'risk_complete',
                'label': f'Risk · {risk_index} {sev.get("tier")}',
                'detail': {'risk_score': risk_index, 'tier': sev.get('tier')},
                'risk_score': risk_index,
                'risk_tier': severity,
            }
        )
        publish_case(case, event_type='risk_complete')
    publish_case(case, event_type='case_update')
    return case
