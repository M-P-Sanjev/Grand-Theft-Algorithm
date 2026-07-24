"""
Lightweight FastAPI app for the Water cover SOS pipeline + crisis orchestration.
Run from repo root:
  uvicorn backend.sos_app:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from backend.cases import (
    CaseCreate,
    admin_key,
    append_secure_message,
    consume_or_check_token,
    create_incident_fast,
    find_case_by_secure_token,
    get_case,
    issue_passport_token,
    list_cases,
    reorchestrate_case,
    save_evidence_file,
    secret_passport,
    update_case,
    escalation_contacts,
)
from backend.orchestration.agents.legal import run_legal
from backend.orchestration.agents.therapy import run_therapy
from backend.orchestration.engine import run_orchestration
from backend.orchestration.privacy import decrypt_text, redact_case_for_list
from backend.schema import (
    AgentQuestionBody,
    ChatStreamBody,
    EscalateBody,
    LocationUpdateBody,
    PassportRequest,
    SecureMessageBody,
    SecureReplyBody,
)

load_dotenv()
load_dotenv('backend/.env')

logger = logging.getLogger(__name__)

app = FastAPI(title='Safra SOS API')

@app.on_event('startup')
async def _startup_rag_index():
    try:
        from backend.orchestration.rag.ingest import ensure_index
        from backend.orchestration.rag.mongo_store import seed_knowledge_to_mongo

        ensure_index(force=True)
        seed = seed_knowledge_to_mongo(force=False)
        logger.info('RAG knowledge index ready; mongo_seed=%s', seed)
    except Exception as exc:
        logger.warning('RAG index build skipped: %s', exc)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3001',
    ],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


def _require_admin(key: str) -> None:
    if key != admin_key():
        raise HTTPException(status_code=401, detail='Unauthorized')


@app.get('/health')
async def health():
    return {'ok': True, 'mode': 'sos', 'orchestration': True}


@app.post('/verify-passport')
async def verify_passport(body: PassportRequest):
    if body.code.strip() != secret_passport():
        raise HTTPException(status_code=401, detail='Invalid delivery code')
    return {'ok': True, 'token': issue_passport_token()}


@app.post('/cases')
async def create_abuse_case(
    background_tasks: BackgroundTasks,
    notes: str = Form(...),
    frequency: str = Form('once'),
    severity: str = Form('medium'),
    name: str = Form(None),
    phone: str = Form(None),
    location: str = Form(None),
    lat: str = Form(None),
    lng: str = Form(None),
    location_city: str = Form(None),
    location_district: str = Form(None),
    location_state: str = Form(None),
    location_hide_exact: str = Form('1'),
    location_accuracy_band: str = Form(None),
    location_accuracy_m: str = Form(None),
    location_source: str = Form(None),
    location_live: str = Form('0'),
    location_radius_m: str = Form(None),
    location_nearest_eta_min: str = Form(None),
    location_nearest_kind: str = Form(None),
    token: str = Form(...),
    files: list[UploadFile] = File(default=[]),
):
    if not consume_or_check_token(token, consume=False):
        raise HTTPException(status_code=401, detail='Session expired. Open Water again.')
    if frequency not in ('once', 'repeated', 'ongoing'):
        raise HTTPException(status_code=400, detail='Invalid frequency')
    if severity not in ('low', 'medium', 'high', 'critical'):
        raise HTTPException(status_code=400, detail='Invalid severity')
    if not notes.strip():
        raise HTTPException(status_code=400, detail='Notes are required')

    lat_f = None
    lng_f = None
    try:
        if lat not in (None, ''):
            lat_f = float(lat)
        if lng not in (None, ''):
            lng_f = float(lng)
    except ValueError:
        raise HTTPException(status_code=400, detail='Invalid coordinates')

    acc_m = None
    try:
        if location_accuracy_m not in (None, ''):
            acc_m = float(location_accuracy_m)
    except ValueError:
        acc_m = None

    radius_m = None
    try:
        if location_radius_m not in (None, ''):
            radius_m = float(location_radius_m)
    except ValueError:
        radius_m = None

    nearest_eta = None
    try:
        if location_nearest_eta_min not in (None, ''):
            nearest_eta = int(float(location_nearest_eta_min))
    except ValueError:
        nearest_eta = None

    location_meta = {
        'city': location_city,
        'district': location_district,
        'state': location_state,
        'hide_exact': location_hide_exact in ('1', 'true', 'True'),
        'accuracy_band': location_accuracy_band,
        'accuracy_m': acc_m,
        'source': location_source or 'none',
        'live_tracking': location_live in ('1', 'true', 'True'),
        'radius_m': radius_m,
        'label': location,
        'nearest_eta_min': nearest_eta,
        'nearest_kind': location_nearest_kind,
    }

    # Fast path: skip heavy file IO on critical path when possible — still accept small uploads
    evidence_meta = []
    upload_list = files if isinstance(files, list) else ([files] if files else [])
    pending_files: list[tuple[str, bytes]] = []
    for upload in upload_list:
        if not getattr(upload, 'filename', None):
            continue
        content = await upload.read()
        if not content:
            continue
        pending_files.append((upload.filename, content))

    payload = CaseCreate(
        notes=notes,
        frequency=frequency,  # type: ignore[arg-type]
        severity=severity,  # type: ignore[arg-type]
        name=name,
        phone=phone,
        location=location,
        lat=lat_f,
        lng=lng_f,
        token=token,
        evidence=[],
        location_meta=location_meta,
    )
    case = create_incident_fast(payload, evidence_meta)

    from backend.orchestration.crisis.live import publish, publish_case
    from backend.orchestration.crisis.jobs import run_incident_pipeline

    publish(
        {
            'type': 'incident_received',
            'case_id': case['id'],
            'public_id': case.get('public_id'),
            'name': case.get('name'),
            'location': case.get('location'),
            'lat': case.get('lat'),
            'lng': case.get('lng'),
            'created_at': case.get('created_at'),
            'risk_tier': 'analyzing',
            'pipeline_status': 'received',
            'status': 'open',
        }
    )
    publish_case(case, event_type='incident_received')

    def _bg(case_id: str, files_blob: list[tuple[str, bytes]]) -> None:
        if files_blob:
            meta = []
            for fname, content in files_blob:
                meta.append(save_evidence_file(fname, content))
            if meta:
                update_case(case_id, evidence=meta)
        run_incident_pipeline(case_id)

    background_tasks.add_task(_bg, case['id'], pending_files)

    return {
        'status': 'ok',
        'case_id': case['id'],
        'public_id': case.get('public_id'),
        'case': {
            'id': case['id'],
            'public_id': case.get('public_id'),
            'created_at': case.get('created_at'),
            'status': 'open',
            'pipeline_status': 'received',
            'risk_tier': 'analyzing',
            'location': case.get('location'),
            'lat': case.get('lat'),
            'lng': case.get('lng'),
        },
        'message': 'Your request has been received.',
        'pipeline': {'status': 'received'},
        'orchestration': {
            'case_id': case['id'],
            'public_id': case.get('public_id'),
            'risk_tier': 'analyzing',
            'live_status': case.get('live_status'),
            'pipeline': case.get('pipeline'),
        },
    }


@app.get('/cases')
async def get_cases(
    x_admin_key: str = Header(default=''),
    redacted: bool = True,
):
    _require_admin(x_admin_key)
    cases = list_cases()
    if redacted:
        return {'cases': [redact_case_for_list(c) for c in cases]}
    return {'cases': cases}


@app.get('/cases/stream')
async def stream_cases(admin_key_q: str = ''):
    """SSE feed for admin — cases + live crisis events."""
    _require_admin(admin_key_q)

    from backend.orchestration.crisis.live import encode, subscribe, unsubscribe

    async def event_gen():
        q = subscribe()
        last = ''
        try:
            # Initial snapshot
            payload = {'type': 'cases', 'cases': [redact_case_for_list(c) for c in list_cases()]}
            last = json.dumps(payload)
            yield f'event: cases\ndata: {last}\n\n'
            while True:
                # Drain live hub quickly
                try:
                    while True:
                        ev = q.get_nowait()
                        yield f'event: live\ndata: {encode(ev)}\n\n'
                except asyncio.QueueEmpty:
                    pass

                payload = {
                    'type': 'cases',
                    'cases': [redact_case_for_list(c) for c in list_cases()],
                }
                blob = json.dumps(payload)
                if blob != last:
                    yield f'event: cases\ndata: {blob}\n\n'
                    last = blob
                else:
                    yield f': ping\n\n'
                await asyncio.sleep(1.5)
        finally:
            unsubscribe(q)

    return StreamingResponse(
        event_gen(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


@app.websocket('/ws/live')
async def ws_live(websocket: WebSocket):
    """WebSocket live command center (filter by case_id query when set)."""
    await websocket.accept()
    from backend.orchestration.crisis.live import encode, set_presence, subscribe, unsubscribe

    case_id = websocket.query_params.get('case_id') or ''
    role = websocket.query_params.get('role') or 'admin'
    if case_id:
        set_presence(case_id, role, True)

    q = subscribe()
    try:
        await websocket.send_text(
            encode({'type': 'hello', 'case_id': case_id or None, 'role': role})
        )
        while True:
            try:
                ev = await asyncio.wait_for(q.get(), timeout=15.0)
            except asyncio.TimeoutError:
                await websocket.send_text(encode({'type': 'ping'}))
                continue
            if case_id and ev.get('case_id') and ev.get('case_id') != case_id:
                continue
            await websocket.send_text(encode(ev))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if case_id:
            set_presence(case_id, role, False)
        unsubscribe(q)


@app.post('/cases/{case_id}/location')
async def update_case_location(case_id: str, body: LocationUpdateBody):
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    if not _authorize_agent(body.admin_key, body.token):
        raise HTTPException(status_code=401, detail='Unauthorized')

    privacy = dict(case.get('location_privacy') or {})
    privacy['live_tracking'] = bool(body.live)
    privacy['accuracy_m'] = body.accuracy
    privacy['last_live_at'] = __import__('backend.cases', fromlist=['utc_now']).utc_now()

    updated = update_case(
        case_id,
        lat=body.lat,
        lng=body.lng,
        location_updated_at=privacy['last_live_at'],
        location_privacy=privacy,
    )
    try:
        from backend.orchestration.crisis.live import publish_case
        from backend.orchestration.crisis.timeline import append_timeline

        if updated:
            append_timeline(
                updated,
                'Live location update' if body.live else 'Location updated',
                detail=f'accuracy={body.accuracy}',
            )
            update_case(case_id, timeline=updated.get('timeline'))
            publish_case(updated, event_type='case_update')
    except Exception:
        pass
    return {'status': 'ok', 'case': get_case(case_id)}


@app.get('/cases/{case_id}')
async def get_case_detail(case_id: str, x_admin_key: str = Header(default='')):
    _require_admin(x_admin_key)
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    return case


@app.get('/cases/{case_id}/agents')
async def get_case_agents(case_id: str, x_admin_key: str = Header(default='')):
    _require_admin(x_admin_key)
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    return {
        'case_id': case_id,
        'agent_plan': case.get('agent_plan') or [],
        'agent_log': case.get('agent_log') or [],
        'risk_score': case.get('risk_score'),
        'risk_tier': case.get('risk_tier'),
        'orchestration': case.get('orchestration'),
    }


@app.post('/cases/{case_id}/agents/legal')
async def ask_legal(case_id: str, body: AgentQuestionBody):
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    # Admin key OR survivor passport/secure token
    ok = False
    if body.admin_key and body.admin_key == admin_key():
        ok = True
    elif body.token and (
        consume_or_check_token(body.token, consume=False)
        or find_case_by_secure_token(body.token)
    ):
        ok = True
    if not ok:
        raise HTTPException(status_code=401, detail='Unauthorized')

    result = run_legal(case, body.question)
    log = list(case.get('agent_log') or [])
    from backend.cases import utc_now

    log.append(
        {
            'at': utc_now(),
            'agent': 'legal',
            'message': result.get('message', ''),
            'source': result.get('source'),
            'meta': {'question': body.question},
        }
    )
    update_case(case_id, agent_log=log[-100:], legal_brief={
        'answer': result['answer'],
        'source': result['source'],
        'at': utc_now(),
    })
    return result


@app.post('/cases/{case_id}/agents/therapy')
async def ask_therapy(case_id: str, body: AgentQuestionBody):
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    ok = False
    if body.admin_key and body.admin_key == admin_key():
        ok = True
    elif body.token and (
        consume_or_check_token(body.token, consume=False)
        or find_case_by_secure_token(body.token)
    ):
        ok = True
    if not ok:
        raise HTTPException(status_code=401, detail='Unauthorized')

    result = run_therapy(case, body.question)
    from backend.cases import utc_now

    log = list(case.get('agent_log') or [])
    log.append(
        {
            'at': utc_now(),
            'agent': 'therapy',
            'message': result.get('message', ''),
            'source': result.get('source'),
            'meta': {
                'question': body.question,
                'escalate_human': result.get('escalate_human'),
            },
        }
    )
    update_case(
        case_id,
        agent_log=log[-100:],
        therapy_brief={
            'answer': result['answer'],
            'source': result['source'],
            'escalate_human': result.get('escalate_human', False),
            'at': utc_now(),
        },
    )
    return result


def _authorize_agent(body_admin: str | None, body_token: str | None) -> bool:
    if body_admin and body_admin == admin_key():
        return True
    if body_token and (
        consume_or_check_token(body_token, consume=False)
        or find_case_by_secure_token(body_token)
    ):
        return True
    return False


@app.post('/cases/{case_id}/agents/{kind}/stream')
async def stream_agent(case_id: str, kind: str, body: ChatStreamBody):
    if kind not in ('legal', 'therapy'):
        raise HTTPException(status_code=404, detail='Unknown agent')
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    if not _authorize_agent(body.admin_key, body.token):
        raise HTTPException(status_code=401, detail='Unauthorized')

    from backend.orchestration.rag.chat_stream import new_session_id, stream_agent_reply

    session_id = (body.session_id or '').strip() or new_session_id()

    async def event_gen():
        yield f'event: session\ndata: {json.dumps({"session_id": session_id})}\n\n'
        async for block in stream_agent_reply(
            kind=kind,
            question=body.question,
            case=case,
            session_id=session_id,
        ):
            yield block
        # Persist crisis fields mutated during the stream
        update_case(
            case_id,
            risk_score=case.get('risk_score'),
            risk_tier=case.get('risk_tier'),
            severity=case.get('severity'),
            crisis=case.get('crisis'),
            safety_plan=case.get('safety_plan'),
            ai_summary=case.get('ai_summary'),
            next_actions=case.get('next_actions'),
            live_status=case.get('live_status'),
            pipeline_live=case.get('pipeline_live'),
            timeline=case.get('timeline'),
            risk_history=case.get('risk_history'),
            last_ai_action=case.get('last_ai_action'),
            last_activity_at=case.get('last_activity_at'),
            crisis_history=case.get('crisis_history'),
            resources_found=case.get('resources_found'),
            updated_at=case.get('updated_at'),
        )

    return StreamingResponse(
        event_gen(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


@app.get('/cases/{case_id}/agents/{kind}/history')
async def agent_history(
    case_id: str,
    kind: str,
    session_id: str = '',
    x_admin_key: str = Header(default=''),
    token: str = '',
):
    if kind not in ('legal', 'therapy'):
        raise HTTPException(status_code=404, detail='Unknown agent')
    if not get_case(case_id):
        raise HTTPException(status_code=404, detail='Case not found')
    if not _authorize_agent(x_admin_key or None, token or None):
        raise HTTPException(status_code=401, detail='Unauthorized')
    from backend.orchestration.rag.chat_stream import get_history

    return {
        'session_id': session_id,
        'messages': get_history(case_id, kind, session_id) if session_id else [],
    }


@app.post('/rag/reindex')
async def rag_reindex(body: dict):
    if body.get('admin_key') != admin_key():
        raise HTTPException(status_code=401, detail='Unauthorized')
    from backend.orchestration.rag.ingest import ensure_index
    from backend.orchestration.rag.mongo_store import seed_knowledge_to_mongo

    local = ensure_index(force=True)
    mongo = seed_knowledge_to_mongo(force=True)
    return {'local_chunks': len(local.get('chunks') or []), 'mongo': mongo}


@app.post('/cases/{case_id}/secure-message')
async def send_secure_message(case_id: str, body: SecureMessageBody):
    _require_admin(body.admin_key)
    if not body.message.strip():
        raise HTTPException(status_code=400, detail='Message required')
    case = append_secure_message(case_id, body.message, sender='admin')
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    return {'status': 'ok', 'message_count': len((case.get('secure_channel') or {}).get('messages') or [])}


@app.get('/secure/{token}')
async def open_secure_channel(token: str):
    case = find_case_by_secure_token(token)
    if not case:
        raise HTTPException(status_code=404, detail='Channel not found')
    sc = case.get('secure_channel') or {}
    messages = []
    for m in sc.get('messages') or []:
        messages.append(
            {
                'id': m.get('id'),
                'sender': m.get('sender'),
                'body': decrypt_text(m.get('body_encrypted') or ''),
                'at': m.get('at'),
            }
        )
    return {
        'case_id': case.get('id'),
        'routing': case.get('routing'),
        'risk_tier': case.get('risk_tier'),
        'legal_tip': (case.get('legal_brief') or {}).get('answer'),
        'therapy_tip': (case.get('therapy_brief') or {}).get('answer'),
        'messages': messages,
    }


@app.post('/secure/{token}/reply')
async def secure_reply(token: str, body: SecureReplyBody):
    case = find_case_by_secure_token(token)
    if not case:
        raise HTTPException(status_code=404, detail='Channel not found')
    if not body.message.strip():
        raise HTTPException(status_code=400, detail='Message required')
    updated = append_secure_message(case['id'], body.message, sender='survivor')
    return {'status': 'ok', 'case_id': updated and updated.get('id')}


@app.post('/orchestrate/{case_id}')
async def reorchestrate(case_id: str, body: dict):
    if body.get('admin_key') != admin_key():
        raise HTTPException(status_code=401, detail='Unauthorized')
    case = reorchestrate_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    return {'status': 'ok', 'case': case}


@app.post('/cases/{case_id}/escalate')
async def escalate_case(case_id: str, body: EscalateBody):
    if body.admin_key != admin_key():
        raise HTTPException(status_code=401, detail='Unauthorized')
    case = update_case(
        case_id,
        routing=body.target,
        escalation_contacts=escalation_contacts(body.target),
        status='open',
    )
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    # Re-run notify + log
    case = run_orchestration(case, trigger='escalate')
    persist = {k: v for k, v in case.items() if not k.startswith('_')}
    case = update_case(case_id, **{k: v for k, v in persist.items() if k != 'id'})
    return {'status': 'escalated', 'case': case}


@app.post('/cases/{case_id}/close')
async def close_case(case_id: str, body: dict):
    if body.get('admin_key') != admin_key():
        raise HTTPException(status_code=401, detail='Unauthorized')
    case = update_case(case_id, status='closed')
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    return {'status': 'closed', 'case': case}


@app.get('/get-admin-posts')
async def get_admin_posts():
    from backend.cases import to_admin_dashboard_doc

    return [to_admin_dashboard_doc(c) for c in list_cases()]
