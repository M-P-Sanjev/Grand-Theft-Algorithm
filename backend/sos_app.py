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
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from backend.cases import (
    CaseCreate,
    admin_key,
    append_secure_message,
    consume_or_check_token,
    create_case,
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
    EscalateBody,
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

        ensure_index(force=True)
        logger.info('RAG knowledge index ready')
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
    notes: str = Form(...),
    frequency: str = Form('once'),
    severity: str = Form('medium'),
    name: str = Form(None),
    phone: str = Form(None),
    location: str = Form(None),
    lat: str = Form(None),
    lng: str = Form(None),
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

    evidence_meta = []
    upload_list = files if isinstance(files, list) else ([files] if files else [])
    for upload in upload_list:
        if not getattr(upload, 'filename', None):
            continue
        content = await upload.read()
        if not content:
            continue
        evidence_meta.append(save_evidence_file(upload.filename, content))

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
        evidence=evidence_meta,
    )
    case = create_case(payload, evidence_meta)
    summary = case.pop('orchestration_summary', None) or {}
    secure_token = case.pop('secure_token', None) or summary.get('secure_token')
    return {
        'status': 'ok',
        'case': case,
        'message': 'Order received',
        'routing': case['routing'],
        'orchestration': summary,
        'secure_token': secure_token,
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
    """SSE feed for admin. EventSource cannot set headers → use ?admin_key_q=."""
    _require_admin(admin_key_q)

    async def event_gen():
        last = ''
        while True:
            payload = {
                'cases': [redact_case_for_list(c) for c in list_cases()],
            }
            blob = json.dumps(payload)
            if blob != last:
                yield f'data: {blob}\n\n'
                last = blob
            else:
                yield f': ping\n\n'
            await asyncio.sleep(3)

    return StreamingResponse(
        event_gen(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


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
