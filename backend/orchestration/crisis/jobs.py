"""Async background incident pipeline — never blocks victim SEND."""

from __future__ import annotations

import logging
from typing import Any, Callable

from backend.cases import get_case, update_case, utc_now
from backend.orchestration.crisis.live import publish, publish_case
from backend.orchestration.crisis.timeline import append_timeline, append_risk_point

logger = logging.getLogger(__name__)


def _stage(
    case_id: str,
    stage: str,
    *,
    label: str,
    detail: dict[str, Any] | None = None,
) -> None:
    publish(
        {
            'type': 'pipeline_stage',
            'case_id': case_id,
            'stage': stage,
            'label': label,
            'detail': detail or {},
        }
    )


def _persist(case: dict[str, Any], **fields: Any) -> dict[str, Any] | None:
    case_id = case.get('id')
    if not case_id:
        return None
    case.update(fields)
    # Reload so concurrent guardian transcripts are not wiped by stale in-memory case
    from backend.cases import merge_guardian

    fresh = get_case(case_id)
    if fresh:
        case['guardian'] = merge_guardian(fresh.get('guardian'), case.get('guardian'))
        # Prefer fresher timeline if longer
        ft = list(fresh.get('timeline') or [])
        ct = list(case.get('timeline') or [])
        if len(ft) > len(ct):
            case['timeline'] = ft
    case['updated_at'] = utc_now()
    return update_case(case_id, **{k: v for k, v in case.items() if k != 'id'})


def _safe_job(name: str, fn: Callable[[], None]) -> None:
    try:
        fn()
    except Exception as exc:
        logger.exception('Incident job %s failed: %s', name, exc)


def run_incident_pipeline(case_id: str) -> None:
    """
    Independent jobs after fast incident create.
    Each job is isolated — failure must not block the victim or sibling jobs.
    """
    case = get_case(case_id)
    if not case:
        return

    notes = case.get('notes') or ''
    pipeline_stages: list[dict[str, Any]] = list((case.get('pipeline') or {}).get('stages') or [])

    def mark(stage: str, label: str) -> None:
        pipeline_stages.append({'stage': stage, 'at': utc_now(), 'label': label})
        case['pipeline'] = {'status': 'running', 'stages': pipeline_stages[-20:]}
        _stage(case_id, stage, label=label)

    # --- Job 1: Emotion ---
    def job_emotion() -> None:
        from backend.orchestration.crisis.emotion import detect_emotion

        mark('analyzing', 'Analyzing your situation…')
        emotion = detect_emotion(notes)
        crisis = dict(case.get('crisis') or {})
        crisis['emotion'] = emotion
        case['crisis'] = crisis
        append_timeline(case, 'Emotion detected', detail=str(emotion.get('primary') or ''))
        _persist(case, crisis=case['crisis'], timeline=case.get('timeline'), pipeline=case['pipeline'])
        _stage(case_id, 'emotion_detected', label='Analysing emotions…', detail=emotion)
        publish_case(case, event_type='case_update')

    # --- Job 1b: Violence detection ---
    def job_violence() -> None:
        from backend.orchestration.crisis.severity import extract_features

        mark('violence', 'Assessing danger…')
        feats = extract_features(notes.lower(), case)
        violence = {
            'weapon': bool(feats.get('weapon')),
            'physical_assault': bool(feats.get('physical_assault')),
            'sexual_assault': bool(feats.get('sexual_assault')),
            'death_threat': bool(feats.get('death_threat')),
            'bleeding': bool(feats.get('bleeding')),
        }
        flags_hit = [k for k, v in violence.items() if v]
        detail = ', '.join(flags_hit) if flags_hit else 'No weapon/assault tokens yet'
        crisis = dict(case.get('crisis') or {})
        crisis['violence'] = violence
        case['crisis'] = crisis
        append_timeline(
            case,
            'Violence classifier',
            detail=('Weapon detected' if violence['weapon'] else detail),
        )
        _persist(case, crisis=case['crisis'], timeline=case.get('timeline'), pipeline=case['pipeline'])
        _stage(
            case_id,
            'violence_detected',
            label='Assessing danger…',
            detail=violence,
        )
        publish_case(case, event_type='case_update')

    # --- Job 2: Risk ---
    def job_risk() -> None:
        from backend.orchestration.crisis.severity import classify_severity, heuristic_fallback
        from backend.orchestration.agents.dispatch import run_dispatch

        mark('risk_assessing', 'Assessing danger…')
        try:
            sev = classify_severity(case, message=notes, previous_risk=case.get('risk_score'))
        except Exception:
            sev = heuristic_fallback(case, message=notes)

        case['risk_score'] = sev['risk_index']
        case['risk_tier'] = sev['severity']
        case['severity'] = sev['severity']
        case['ai_recommendation'] = sev.get('recommendation') or 'Review case'
        case['Severity of domestic violence'] = (
            'Very High' if sev['severity'] == 'critical' else sev['severity'].replace('_', ' ').title()
        )
        crisis = dict(case.get('crisis') or {})
        crisis.update(
            {
                'tier': sev['tier'],
                'reasons': sev.get('reasons'),
                'scores': sev.get('scores'),
                'confidence': sev.get('confidence'),
                'flags': sev.get('flags'),
                'emotion': sev.get('emotion') or crisis.get('emotion'),
                'trend': sev.get('trend'),
                'delta': sev.get('delta'),
                'recommendation': sev.get('recommendation'),
            }
        )
        case['crisis'] = crisis
        append_risk_point(case, sev)
        append_timeline(
            case,
            f"Risk {sev['tier']} ({sev['risk_index']})",
            detail='; '.join(sev.get('reasons') or [])[:200],
        )

        dispatch = run_dispatch(case)
        case['routing'] = dispatch['routing']
        case['escalation_contacts'] = dispatch['escalation_contacts']
        if dispatch['routing'] == 'police':
            append_timeline(case, 'Police recommended', detail=case['ai_recommendation'])
        elif dispatch['routing'] == 'ngo':
            append_timeline(case, 'NGO assigned', detail='Support route')

        live = dict(case.get('live_status') or {})
        live.update(
            {
                'analysing': False,
                'severity_detected': sev['tier'],
                'risk_index': sev['risk_index'],
                'plain': f"Risk {sev['tier']} ({sev['risk_index']}/100)",
            }
        )
        case['live_status'] = live

        _persist(
            case,
            risk_score=case['risk_score'],
            risk_tier=case['risk_tier'],
            severity=case['severity'],
            crisis=case['crisis'],
            routing=case['routing'],
            escalation_contacts=case['escalation_contacts'],
            timeline=case.get('timeline'),
            risk_history=case.get('risk_history'),
            live_status=case['live_status'],
            pipeline=case['pipeline'],
            ai_recommendation=case['ai_recommendation'],
            **{
                'Severity of domestic violence': case['Severity of domestic violence'],
            },
        )
        _stage(
            case_id,
            'risk_complete',
            label=f"Risk prediction · {sev['risk_index']} {sev['tier']}",
            detail={'risk_score': sev['risk_index'], 'tier': sev['tier'], 'routing': case['routing']},
        )
        publish_case(case, event_type='risk_complete')
        publish_case(case, event_type='case_update')

    # --- Job 3: Legal RAG ---
    def job_legal() -> None:
        from backend.orchestration.agents.legal import run_legal
        from backend.orchestration.crisis.companion import legal_plain_reply
        from backend.orchestration.rag.mongo_store import vector_search

        mark('legal_rag', 'Finding legal protections…')
        hits: list[dict[str, Any]] = []
        try:
            hits = vector_search('legal', notes or 'domestic violence protection', top_k=4)
        except Exception as exc:
            logger.warning('Legal vector_search failed: %s', exc)

        legal_result: dict[str, Any] = {}
        try:
            legal_result = run_legal(case)
            if legal_result.get('sources'):
                hits = hits or list(legal_result.get('sources') or [])
        except Exception as exc:
            logger.warning('run_legal failed: %s', exc)

        sev_pack = {
            'tier': (case.get('crisis') or {}).get('tier') or 'MEDIUM',
            'flags': (case.get('crisis') or {}).get('flags') or {},
        }
        plain = legal_plain_reply(message=notes or 'What are my rights?', hits=hits, severity=sev_pack)
        sources = legal_result.get('sources') or [
            {'title': h.get('title'), 'source': h.get('source'), 'text': (h.get('text') or '')[:400]}
            for h in hits
        ]
        case['legal_brief'] = {
            'answer': plain,
            'sources': sources,
            'source': legal_result.get('source') or 'rag',
            'at': utc_now(),
        }
        append_timeline(case, 'Legal brief ready', detail=f'{len(sources)} sources')
        _persist(case, legal_brief=case['legal_brief'], timeline=case.get('timeline'), pipeline=case['pipeline'])
        _stage(case_id, 'legal_ready', label='Legal retrieval complete', detail={'sources': len(sources)})
        publish_case(case, event_type='legal_ready')
        publish_case(case, event_type='case_update')

    # --- Job 4: Therapy ---
    def job_therapy() -> None:
        from backend.orchestration.agents.therapy import run_therapy
        from backend.orchestration.crisis.companion import therapy_companion_reply
        from backend.orchestration.crisis.memory import get_memory

        mark('therapy_rag', 'Preparing emotional support…')
        try:
            run_therapy(case)
        except Exception as exc:
            logger.warning('run_therapy failed: %s', exc)

        sev_pack = {
            'tier': (case.get('crisis') or {}).get('tier') or 'MEDIUM',
            'flags': (case.get('crisis') or {}).get('flags') or {},
            'emotion': (case.get('crisis') or {}).get('emotion') or {},
        }
        try:
            from backend.orchestration.crisis.safety import plan_safety as _ps

            safety = case.get('safety_plan') or _ps(case, sev_pack)
        except Exception:
            safety = case.get('safety_plan') or {
                'primary_step': 'If you can, move to a safer space and call 112.',
            }

        case['safety_plan'] = safety
        plain = therapy_companion_reply(
            message=notes or 'I need support',
            severity=sev_pack,
            safety=safety,
            memory=get_memory(case_id, 'therapy'),
            name=case.get('name'),
        )
        case['therapy_brief'] = {
            'answer': plain,
            'source': 'crisis-companion',
            'escalate_human': sev_pack['tier'] in ('HIGH', 'CRITICAL'),
            'at': utc_now(),
        }
        append_timeline(case, 'Therapy support ready')
        _persist(
            case,
            therapy_brief=case['therapy_brief'],
            safety_plan=case['safety_plan'],
            timeline=case.get('timeline'),
            pipeline=case['pipeline'],
        )
        _stage(case_id, 'therapy_ready', label='Preparing emotional support… done')
        publish_case(case, event_type='therapy_ready')
        publish_case(case, event_type='case_update')

    # --- Job 5b: Nearby resources ---
    def job_resources() -> None:
        mark('resources', 'Finding nearby help…')
        lat, lng = case.get('lat'), case.get('lng')
        nearby: list[dict[str, Any]] = []
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            try:
                # Lightweight distance estimates vs known helpline anchors (no hardcoded city).
                # Real OSM hits are client-side; server stores routing contacts + ETA hints.
                contacts = case.get('escalation_contacts') or {}
                nearby = [
                    {
                        'kind': 'police',
                        'name': 'Women\'s Police / Helpline',
                        'detail': contacts.get('police') or '112 / 1091',
                        'eta_min': (case.get('location_privacy') or {}).get('nearest_eta_min') or 12,
                    },
                    {
                        'kind': 'ngo',
                        'name': 'Nearest NGO support',
                        'detail': contacts.get('ngo') or 'NGO helpline',
                        'eta_min': 25,
                    },
                ]
            except Exception:
                nearby = []
        case['nearby_resources'] = nearby
        live = dict(case.get('live_status') or {})
        live['resources_found'] = True
        case['live_status'] = live
        append_timeline(case, 'Nearby resources checked', detail=f'{len(nearby)} contacts')
        _persist(
            case,
            nearby_resources=nearby,
            live_status=live,
            timeline=case.get('timeline'),
            pipeline=case['pipeline'],
        )
        _stage(case_id, 'resources', label='Finding nearby help…', detail={'count': len(nearby)})
        publish_case(case, event_type='case_update')

    # --- Job 5: Nearby resources / dashboard sync ---
    def job_dashboard() -> None:
        mark('dashboard_sync', 'Dashboard updated')
        live = dict(case.get('live_status') or {})
        live.update(
            {
                'resources_found': True,
                'analysing': False,
                'police_notified': case.get('routing') == 'police',
                'ngo_assigned': case.get('routing') in ('ngo', 'police'),
            }
        )
        case['live_status'] = live
        from backend.orchestration.crisis.summary import build_case_summary

        try:
            sev_for_sum = {
                'tier': (case.get('crisis') or {}).get('tier') or 'MEDIUM',
                'risk_index': case.get('risk_score') or 0,
                'flags': (case.get('crisis') or {}).get('flags') or {},
                'reasons': (case.get('crisis') or {}).get('reasons') or [],
                'emotion': (case.get('crisis') or {}).get('emotion') or {},
                'confidence': (case.get('crisis') or {}).get('confidence'),
                'scores': (case.get('crisis') or {}).get('scores') or {},
            }
            from backend.orchestration.crisis.summary import recommend_next_actions

            summary = build_case_summary(case, sev_for_sum)
            case['ai_summary'] = summary
            case['next_actions'] = summary.get('next_actions') or recommend_next_actions(
                case, sev_for_sum
            )
        except Exception:
            case['ai_summary'] = {
                'headline': 'We are with you',
                'plain_status': 'Your report is being handled.',
            }

        # Secure channel token
        from backend.orchestration.privacy import encrypt_text, issue_secure_token

        sc = dict(case.get('secure_channel') or {})
        plaintext_token = None
        if not sc.get('token_hash'):
            plaintext_token, token_hash = issue_secure_token()
            sc['token_hash'] = token_hash
            sc['messages'] = []
            sc['created_at'] = utc_now()
            case['_secure_token_plaintext'] = plaintext_token
        case['secure_channel'] = sc
        phone = case.get('phone')
        if phone and not str(phone).startswith(('fernet:', 'b64:')):
            case['phone_encrypted'] = encrypt_text(phone)

        case['pipeline'] = {'status': 'synced', 'stages': pipeline_stages[-20:]}
        _persist(
            case,
            live_status=case['live_status'],
            ai_summary=case.get('ai_summary'),
            next_actions=case.get('next_actions'),
            secure_channel=case['secure_channel'],
            phone_encrypted=case.get('phone_encrypted'),
            pipeline=case['pipeline'],
            timeline=case.get('timeline'),
        )
        # Stash token for one WS event only
        if plaintext_token:
            publish(
                {
                    'type': 'secure_token',
                    'case_id': case_id,
                    'secure_token': plaintext_token,
                }
            )
        _stage(case_id, 'dashboard_sync', label='Dashboard updated')
        publish_case(case, event_type='dashboard_sync')
        publish_case(case, event_type='case_update')

    # --- Job 6: Admin notify ---
    def job_notify() -> None:
        from backend.orchestration.agents.notify import run_notify

        mark('notify', 'Notifying response desk…')
        try:
            notify = run_notify(case)
            case['notify_status'] = notify.get('status')
            append_timeline(case, 'Admin notified', detail=str(notify.get('status') or ''))
            _persist(case, notify_status=case['notify_status'], timeline=case.get('timeline'))
            if case.get('routing') == 'police':
                publish_case(case, event_type='police_notified')
        except Exception as exc:
            logger.warning('notify failed: %s', exc)
            case['notify_status'] = 'queued'
            _persist(case, notify_status='queued')
        _stage(case_id, 'admin_notified', label='Responder notified')
        publish_case(case, event_type='admin_notified')
        publish_case(case, event_type='case_update')

    # --- Job 7: Map update ---
    def job_map() -> None:
        if case.get('lat') is None or case.get('lng') is None:
            _stage(case_id, 'map_update', label='Location optional — no pin yet')
            return
        mark('map', 'Updating live map…')
        append_timeline(case, 'Map pin published')
        _persist(case, timeline=case.get('timeline'))
        _stage(
            case_id,
            'map_update',
            label='Map updated',
            detail={'lat': case.get('lat'), 'lng': case.get('lng')},
        )
        publish_case(case, event_type='map_update')
        publish_case(case, event_type='case_update')

    # Run jobs sequentially but isolated
    _safe_job('emotion', job_emotion)
    fresh = get_case(case_id)
    if fresh:
        case.update(fresh)

    _safe_job('violence', job_violence)
    fresh = get_case(case_id)
    if fresh:
        case.update(fresh)

    _safe_job('risk', job_risk)
    fresh = get_case(case_id)
    if fresh:
        case.update(fresh)

    _safe_job('legal', job_legal)
    fresh = get_case(case_id)
    if fresh:
        case.update(fresh)

    _safe_job('therapy', job_therapy)
    fresh = get_case(case_id)
    if fresh:
        case.update(fresh)

    _safe_job('resources', job_resources)
    fresh = get_case(case_id)
    if fresh:
        case.update(fresh)

    _safe_job('dashboard', job_dashboard)
    fresh = get_case(case_id)
    if fresh:
        case.update(fresh)

    _safe_job('notify', job_notify)
    fresh = get_case(case_id)
    if fresh:
        case.update(fresh)

    _safe_job('map', job_map)

    # Final
    case = get_case(case_id) or case
    stages = list((case.get('pipeline') or {}).get('stages') or pipeline_stages)
    stages.append({'stage': 'complete', 'at': utc_now(), 'label': 'Risk assessment complete.'})
    update_case(
        case_id,
        pipeline={'status': 'complete', 'stages': stages[-24:]},
        last_ai_action='pipeline_complete',
        last_activity_at=utc_now(),
    )
    _stage(case_id, 'complete', label='Risk assessment complete.')
    final = get_case(case_id)
    if final:
        publish_case(final, event_type='case_update')
