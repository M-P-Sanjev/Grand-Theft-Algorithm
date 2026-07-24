"""
Lightweight FastAPI app for the Water cover SOS pipeline.
Run from repo root:
  uvicorn backend.sos_app:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend.cases import (
    CaseCreate,
    admin_key,
    consume_or_check_token,
    create_case,
    get_case,
    issue_passport_token,
    list_cases,
    save_evidence_file,
    secret_passport,
    update_case,
    escalation_contacts,
)
from backend.schema import EscalateBody, PassportRequest

load_dotenv()
load_dotenv('backend/.env')

logger = logging.getLogger(__name__)

app = FastAPI(title='Safra SOS API')
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


@app.get('/health')
async def health():
    return {'ok': True, 'mode': 'sos'}


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
    return {
        'status': 'ok',
        'case': case,
        'message': 'Order received',
        'routing': case['routing'],
    }


@app.get('/cases')
async def get_cases(x_admin_key: str = Header(default='')):
    if x_admin_key != admin_key():
        raise HTTPException(status_code=401, detail='Unauthorized')
    return {'cases': list_cases()}


@app.get('/cases/{case_id}')
async def get_case_detail(case_id: str, x_admin_key: str = Header(default='')):
    if x_admin_key != admin_key():
        raise HTTPException(status_code=401, detail='Unauthorized')
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail='Case not found')
    return case


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
