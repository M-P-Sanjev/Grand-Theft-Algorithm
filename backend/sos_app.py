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
    append_audio_chunk,
    append_secure_message,
    assemble_session_audio,
    bind_case_access_token,
    consume_or_check_token,
    create_incident_fast,
    find_case_by_secure_token,
    get_case,
    issue_passport_token,
    list_cases,
    read_evidence_bytes,
    reorchestrate_case,
    save_evidence_file,
    secret_passport,
    update_case,
    escalation_contacts,
    victim_token_ok,
)
from backend.orchestration.agents.legal import run_legal
from backend.orchestration.agents.therapy import run_therapy
from backend.orchestration.engine import run_orchestration
from backend.orchestration.privacy import decrypt_text, redact_case_for_list
from backend.schema import (
    AgentQuestionBody,
    ChatStreamBody,
    EscalateBody,
    GuardianActivateBody,
    GuardianAudioChunkBody,
    GuardianContactNotifyBody,
    GuardianEvidenceBody,
    GuardianEvidenceFinalizeBody,
    GuardianTranscriptBody,
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
        'http://localhost:3002',
        'http://127.0.0.1:3002',
    ],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


def _require_admin(key: str) -> None:
    if key != admin_key():
        raise HTTPException(status_code=401, detail='Unauthorized')


def _authorize_agent(body_admin: str | None, body_token: str | None) -> bool:
    """Allow either an admin key or a valid survivor passport/secure token."""
    if body_admin and body_admin == admin_key():
        return True
    if body_token and (
        consume_or_check_token(body_token, consume=False)
        or find_case_by_secure_token(body_token)
    ):
        return True
    return False


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


@app.get('/cases/{case_id}/evidence/{evidence_id}/meta')
async def get_evidence_meta(case_id: str, evidence_id: str, x_admin_key: str = Header(default='')):
    _require_admin(x_admin_key)
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    for item in case.get('evidence') or []:
        if str(item.get('id') or item.get('stored_as') or '') == evidence_id or str(
            item.get('stored_as') or ''
        ) == evidence_id:
            return {
                'id': item.get('id') or item.get('stored_as'),
                'filename': item.get('filename'),
                'sha256': item.get('sha256'),
                'bytes': item.get('bytes') or item.get('size'),
                'duration_sec': item.get('duration_sec'),
                'encrypted_at_rest': item.get('encrypted_at_rest'),
                'uploaded_at': item.get('uploaded_at'),
                'kind': item.get('kind'),
                'pending': item.get('pending'),
            }
    raise HTTPException(status_code=404, detail='Evidence not found')


@app.get('/cases/{case_id}/evidence/{evidence_id}')
async def stream_evidence(case_id: str, evidence_id: str, x_admin_key: str = Header(default='')):
    _require_admin(x_admin_key)
    from fastapi.responses import Response

    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    meta = None
    for item in case.get('evidence') or []:
        if str(item.get('id') or '') == evidence_id or str(item.get('stored_as') or '') == evidence_id:
            meta = item
            break
    if not meta:
        raise HTTPException(status_code=404, detail='Evidence not found')
    raw = read_evidence_bytes(meta)
    if raw is None:
        raise HTTPException(status_code=404, detail='Evidence file missing')
    filename = meta.get('filename') or 'evidence.webm'
    media = 'audio/webm' if filename.endswith('.webm') or 'webm' in filename else 'application/octet-stream'
    return Response(
        content=raw,
        media_type=media,
        headers={
            'Content-Disposition': f'inline; filename="{filename}"',
            'X-Evidence-SHA256': str(meta.get('sha256') or ''),
            'Cache-Control': 'no-store',
        },
    )


@app.get('/cases/{case_id}/status')
async def get_case_status(
    case_id: str,
    token: str = '',
    x_passport_token: str = Header(default='', alias='X-Passport-Token'),
):
    """Victim-safe status snapshot for poll fallback + Guardian overlay."""
    tok = token or x_passport_token
    if not tok or not victim_token_ok(tok, case_id):
        raise HTTPException(status_code=401, detail='Unauthorized')
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    guardian = case.get('guardian') or {}
    return {
        'case_id': case.get('id'),
        'public_id': case.get('public_id'),
        'status': case.get('status'),
        'source': case.get('source'),
        'risk_score': case.get('risk_score'),
        'risk_tier': case.get('risk_tier'),
        'severity': case.get('severity'),
        'routing': case.get('routing'),
        'pipeline': case.get('pipeline'),
        'pipeline_status': (case.get('pipeline') or {}).get('status') or case.get('pipeline_status'),
        'live_status': case.get('live_status'),
        'crisis': case.get('crisis'),
        'ai_summary': case.get('ai_summary'),
        'next_actions': case.get('next_actions'),
        'legal_brief': case.get('legal_brief'),
        'therapy_brief': case.get('therapy_brief'),
        'timeline': case.get('timeline'),
        'lat': case.get('lat'),
        'lng': case.get('lng'),
        'location': case.get('location'),
        'nearby_resources': case.get('nearby_resources'),
        'ai_recommendation': case.get('ai_recommendation'),
        'guardian': {
            'active': bool(guardian.get('active')),
            'recording': bool(guardian.get('recording')),
            'stealth': bool(guardian.get('stealth')),
            'activated_at': guardian.get('activated_at'),
            'transcript': (guardian.get('transcript') or [])[-20:],
            'detected_events': (guardian.get('detected_events') or [])[-12:],
            'live_summary': guardian.get('live_summary'),
            'recording_meta': guardian.get('recording_meta'),
            'evidence_pending': bool(guardian.get('evidence_pending')),
            'contacts_notified': bool(guardian.get('contacts_notified')),
        },
    }


@app.post('/guardian/activate')
async def guardian_activate(body: GuardianActivateBody, background_tasks: BackgroundTasks):
    if not victim_token_ok(body.token):
        raise HTTPException(status_code=401, detail='Session expired. Open Water again.')

    from backend.orchestration.crisis.live import publish, publish_case
    from backend.orchestration.crisis.jobs import run_incident_pipeline
    from backend.orchestration.crisis.timeline import append_timeline

    now = __import__('backend.cases', fromlist=['utc_now']).utc_now()
    location_meta = {
        'source': 'guardian',
        'hide_exact': True,
        'live_tracking': True,
    }
    payload = CaseCreate(
        notes='Guardian Mode activated. Emergency listening started.',
        frequency='ongoing',
        severity='critical',
        name=body.name,
        phone=body.phone,
        location=body.location,
        lat=body.lat,
        lng=body.lng,
        token=body.token,
        evidence=[],
        location_meta=location_meta,
    )
    case = create_incident_fast(payload, [])
    guardian = {
        'active': True,
        'activated_at': now,
        'stealth': bool(body.stealth),
        'recording': bool(body.recording),
        'transcript': [],
        'evidence_pending': True,
        'contacts_notified': False,
        'camera_enabled': False,
    }
    append_timeline(case, 'Guardian activated', detail='Safra wake word / activate')
    append_timeline(case, 'Recording started', detail='Encrypted evidence pending upload')
    case = update_case(
        case['id'],
        source='guardian',
        guardian=guardian,
        timeline=case.get('timeline'),
        risk_tier='analyzing',
        severity='critical',
        live_status={
            **(case.get('live_status') or {}),
            'analysing': True,
            'guardian_recording': True,
            'plain': 'Guardian Mode active — recording evidence.',
        },
    ) or case
    bind_case_access_token(case['id'], body.token)

    publish(
        {
            'type': 'guardian_activated',
            'case_id': case['id'],
            'public_id': case.get('public_id'),
            'guardian': guardian,
            'lat': case.get('lat'),
            'lng': case.get('lng'),
            'risk_tier': 'analyzing',
        }
    )
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
            'source': 'guardian',
            'guardian': guardian,
        }
    )
    publish_case(case, event_type='incident_received')

    background_tasks.add_task(run_incident_pipeline, case['id'])

    return {
        'status': 'ok',
        'case_id': case['id'],
        'public_id': case.get('public_id'),
        'guardian': guardian,
        'message': 'Guardian Mode activated.',
        'orchestration': {
            'case_id': case['id'],
            'public_id': case.get('public_id'),
            'risk_tier': 'analyzing',
            'live_status': case.get('live_status'),
        },
    }


@app.post('/guardian/{case_id}/transcript')
async def guardian_transcript(case_id: str, body: GuardianTranscriptBody):
    if not victim_token_ok(body.token, case_id):
        raise HTTPException(
            status_code=401,
            detail='Session expired — reopen Water / passport, then Activate again.',
        )
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    from backend.orchestration.crisis.guardian import apply_transcript_chunk

    updated = apply_transcript_chunk(
        case_id,
        body.text,
        final=body.final,
        t_sec=body.t_sec,
        source=body.source or 'browser',
    )
    if not updated:
        raise HTTPException(status_code=404, detail='Case not found')
    return {
        'status': 'ok',
        'risk_score': updated.get('risk_score'),
        'risk_tier': updated.get('risk_tier'),
        'crisis': updated.get('crisis'),
        'guardian': updated.get('guardian'),
    }


@app.post('/guardian/{case_id}/audio-chunk')
async def guardian_audio_chunk(case_id: str, body: GuardianAudioChunkBody):
    if not victim_token_ok(body.token, case_id):
        raise HTTPException(status_code=401, detail='Unauthorized')
    if not get_case(case_id):
        raise HTTPException(status_code=404, detail='Case not found')
    import base64

    try:
        raw = base64.b64decode(body.content_b64)
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid audio chunk')

    append_audio_chunk(case_id, body.seq, raw)
    transcript = ''
    force = body.force_stt or body.stt in ('browser_failed', 'pending', 'unsupported')
    if force and len(raw) > 800:
        from backend.orchestration.crisis.stt_gemini import transcribe_audio_bytes
        from backend.orchestration.crisis.guardian import apply_transcript_chunk

        transcript = transcribe_audio_bytes(raw, mime=body.mime or 'audio/webm')
        if transcript:
            apply_transcript_chunk(
                case_id,
                transcript,
                final=True,
                t_sec=body.t_sec,
                source='gemini',
            )
    return {'status': 'ok', 'seq': body.seq, 'transcript': transcript}


@app.post('/guardian/{case_id}/evidence/finalize')
async def guardian_evidence_finalize(case_id: str, body: GuardianEvidenceFinalizeBody):
    if not victim_token_ok(body.token, case_id):
        raise HTTPException(status_code=401, detail='Unauthorized')
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')

    import base64

    from backend.orchestration.crisis.live import publish, publish_case
    from backend.orchestration.crisis.timeline import append_timeline

    raw = b''
    if body.content_b64:
        try:
            raw = base64.b64decode(body.content_b64)
        except Exception:
            raise HTTPException(status_code=400, detail='Invalid evidence payload')
    if not raw:
        raw = assemble_session_audio(case_id) or b''
    if not raw:
        raise HTTPException(status_code=400, detail='No audio to finalize')

    meta = save_evidence_file(
        body.filename or 'guardian-audio.webm',
        raw,
        encrypt=True,
        duration_sec=body.duration_sec,
        kind='audio',
    )
    meta['pending'] = False if body.live_snapshot else (not body.confirm_upload)
    meta['live_snapshot'] = bool(body.live_snapshot)
    evidence = list(case.get('evidence') or [])
    if body.live_snapshot:
        # Replace previous live snapshot so admin always has newest playable file
        evidence = [e for e in evidence if not e.get('live_snapshot')]
        evidence.append(meta)
    else:
        evidence = [e for e in evidence if not e.get('live_snapshot')]
        evidence.append(meta)

    guardian = dict(case.get('guardian') or {})
    guardian['evidence_pending'] = bool(meta.get('pending'))
    # Live snapshots keep recording=true; final save stops recording flag
    if body.live_snapshot:
        guardian['recording'] = True
    else:
        guardian['recording'] = False
    guardian['recording_meta'] = {
        'evidence_id': meta.get('id'),
        'sha256': meta.get('sha256'),
        'bytes': meta.get('bytes'),
        'duration_sec': meta.get('duration_sec'),
        'encrypted_at_rest': meta.get('encrypted_at_rest'),
        'uploaded_at': meta.get('uploaded_at'),
        'live_snapshot': bool(body.live_snapshot),
    }
    if not body.live_snapshot:
        append_timeline(case, 'Evidence Saved', detail=meta.get('sha256', '')[:16])
    elif not any(
        (t.get('event') or '') == 'Evidence uploading' for t in (case.get('timeline') or [])[-5:]
    ):
        append_timeline(case, 'Evidence uploading', detail=f'{meta.get("bytes")} bytes live')

    updated = update_case(
        case_id,
        evidence=evidence,
        guardian=guardian,
        timeline=case.get('timeline'),
    )
    publish(
        {
            'type': 'guardian_evidence',
            'case_id': case_id,
            'pending': meta.get('pending'),
            'live_snapshot': bool(body.live_snapshot),
            'evidence': {
                'id': meta.get('id'),
                'sha256': meta.get('sha256'),
                'bytes': meta.get('bytes'),
                'duration_sec': meta.get('duration_sec'),
                'filename': meta.get('filename'),
                'live_snapshot': bool(body.live_snapshot),
            },
        }
    )
    if updated:
        publish_case(updated, event_type='case_update')
    return {'status': 'ok', 'evidence': meta, 'pending': meta.get('pending')}


@app.post('/guardian/{case_id}/evidence')
async def guardian_evidence(case_id: str, body: GuardianEvidenceBody):
    if not victim_token_ok(body.token, case_id):
        raise HTTPException(status_code=401, detail='Unauthorized')
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')

    import base64

    from backend.orchestration.crisis.live import publish, publish_case
    from backend.orchestration.crisis.timeline import append_timeline

    try:
        raw = base64.b64decode(body.content_b64)
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid evidence payload')

    # Prefer playable server-side storage (ignore client AES flag for responder copy)
    meta = save_evidence_file(
        body.filename,
        raw,
        encrypt=True,
        duration_sec=body.duration_sec,
        kind=body.kind or 'audio',
    )
    meta['pending'] = not body.confirm_upload
    evidence = list(case.get('evidence') or [])
    evidence.append(meta)

    guardian = dict(case.get('guardian') or {})
    risk_tier = (case.get('risk_tier') or '').lower()
    auto = risk_tier == 'critical' and body.confirm_upload is False and guardian.get('auto_send_critical')
    if body.confirm_upload or auto:
        guardian['evidence_pending'] = False
        meta['pending'] = False
        append_timeline(case, 'Evidence Saved', detail=meta.get('sha256', '')[:16])
    else:
        guardian['evidence_pending'] = True
        append_timeline(case, 'Evidence captured (pending confirm)', detail=meta.get('filename'))

    guardian['recording_meta'] = {
        'evidence_id': meta.get('id'),
        'sha256': meta.get('sha256'),
        'bytes': meta.get('bytes'),
        'duration_sec': meta.get('duration_sec'),
        'encrypted_at_rest': meta.get('encrypted_at_rest'),
        'uploaded_at': meta.get('uploaded_at'),
    }

    updated = update_case(case_id, evidence=evidence, guardian=guardian, timeline=case.get('timeline'))
    publish(
        {
            'type': 'guardian_evidence',
            'case_id': case_id,
            'pending': meta.get('pending'),
            'filename': meta.get('filename'),
            'evidence': {
                'id': meta.get('id'),
                'sha256': meta.get('sha256'),
                'bytes': meta.get('bytes'),
                'duration_sec': meta.get('duration_sec'),
            },
        }
    )
    if updated:
        publish_case(updated, event_type='case_update')
    return {'status': 'ok', 'evidence': meta, 'pending': meta.get('pending')}


@app.post('/guardian/{case_id}/contact-notify')
async def guardian_contact_notify(case_id: str, body: GuardianContactNotifyBody):
    if not victim_token_ok(body.token, case_id):
        raise HTTPException(status_code=401, detail='Unauthorized')
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')

    from backend.orchestration.crisis.live import publish, publish_case
    from backend.orchestration.crisis.timeline import append_timeline

    msg = body.message or (
        'Safra Guardian emergency alert. Approximate location shared. Please check on me.'
    )
    detail = f"{body.contact_name or 'Trusted contact'} · {body.contact_phone or 'queued'}"
    append_timeline(case, 'Trusted contact notified', detail=detail)
    guardian = dict(case.get('guardian') or {})
    guardian['contacts_notified'] = True
    notify_log = list(case.get('guardian_contact_log') or [])
    notify_log.append(
        {
            'at': __import__('backend.cases', fromlist=['utc_now']).utc_now(),
            'name': body.contact_name,
            'phone': body.contact_phone,
            'message': msg,
            'lat': case.get('lat'),
            'lng': case.get('lng'),
            'status': 'queued',
        }
    )
    updated = update_case(
        case_id,
        guardian=guardian,
        timeline=case.get('timeline'),
        guardian_contact_log=notify_log,
        notify_status='queued',
    )
    publish(
        {
            'type': 'guardian_contact',
            'case_id': case_id,
            'contact_name': body.contact_name,
            'status': 'queued',
        }
    )
    if updated:
        publish_case(updated, event_type='case_update')
    return {'status': 'ok', 'queued': True, 'message': msg}


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
