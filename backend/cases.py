from __future__ import annotations

import json
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Frequency = Literal['once', 'repeated', 'ongoing']
Severity = Literal['low', 'medium', 'high', 'critical']
Routing = Literal['admin', 'ngo', 'police']
CaseStatus = Literal['open', 'closed']

DATA_DIR = Path(__file__).resolve().parent / 'data'
UPLOAD_DIR = Path(__file__).resolve().parent / 'uploads'
CASES_FILE = DATA_DIR / 'cases.json'
PASSPORT_TOKENS_FILE = DATA_DIR / 'passport_tokens.json'

# Passport session tokens — loaded from disk so uvicorn --reload does not kill Guardian POSTs
PASSPORT_TOKENS: set[str] = set()


def _load_passport_tokens() -> set[str]:
    ensure_dirs()
    if not PASSPORT_TOKENS_FILE.exists():
        return set()
    try:
        raw = json.loads(PASSPORT_TOKENS_FILE.read_text(encoding='utf-8'))
        if isinstance(raw, list):
            return {str(t) for t in raw if t}
        if isinstance(raw, dict):
            return {str(t) for t in (raw.get('tokens') or []) if t}
    except Exception:
        return set()
    return set()


def _save_passport_tokens() -> None:
    ensure_dirs()
    PASSPORT_TOKENS_FILE.write_text(
        json.dumps({'tokens': sorted(PASSPORT_TOKENS)}, indent=2),
        encoding='utf-8',
    )


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# Load durable tokens at import (after ensure_dirs is defined)
PASSPORT_TOKENS.update(_load_passport_tokens())


class PassportRequest(BaseModel):
    code: str


class CaseCreate(BaseModel):
    notes: str
    frequency: Frequency = 'once'
    severity: Severity = 'medium'
    name: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    evidence: list[dict[str, str]] = Field(default_factory=list)
    token: str
    location_meta: Optional[dict[str, Any]] = None


class EscalateRequest(BaseModel):
    target: Routing
    admin_key: str


class AdminAuth(BaseModel):
    admin_key: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def secret_passport() -> str:
    return os.getenv('SECRET_PASSPORT', 'SAFRA')


def admin_key() -> str:
    return os.getenv('ADMIN_KEY', 'admin123')


def ngo_contact() -> str:
    return os.getenv('NGO_CONTACT', 'NGO Helpline: 1800-SAFE-NGO · help@safengo.example')


def police_contact() -> str:
    return os.getenv(
        'POLICE_CONTACT',
        'Police Women Helpline: 1091 · local.station@police.example',
    )


def compute_routing(severity: Severity, frequency: Frequency) -> Routing:
    if severity in ('high', 'critical'):
        return 'police'
    if frequency in ('repeated', 'ongoing'):
        return 'ngo'
    return 'admin'


def escalation_contacts(routing: Routing) -> dict[str, str]:
    contacts = {'ngo': ngo_contact(), 'police': police_contact()}
    if routing == 'ngo':
        return {'primary': contacts['ngo'], **contacts}
    if routing == 'police':
        return {'primary': contacts['police'], **contacts}
    return contacts


def _load_cases() -> list[dict[str, Any]]:
    ensure_dirs()
    if not CASES_FILE.exists():
        return []
    try:
        return json.loads(CASES_FILE.read_text(encoding='utf-8'))
    except Exception:
        return []


def _save_cases(cases: list[dict[str, Any]]) -> None:
    ensure_dirs()
    CASES_FILE.write_text(json.dumps(cases, indent=2), encoding='utf-8')


def issue_passport_token() -> str:
    token = secrets.token_urlsafe(24)
    PASSPORT_TOKENS.add(token)
    _save_passport_tokens()
    return token


def consume_or_check_token(token: str, consume: bool = False) -> bool:
    if not token:
        return False
    # Refresh from disk in case another worker issued the token
    if token not in PASSPORT_TOKENS:
        PASSPORT_TOKENS.update(_load_passport_tokens())
    if token not in PASSPORT_TOKENS:
        return False
    if consume:
        PASSPORT_TOKENS.discard(token)
        _save_passport_tokens()
    return True


def hash_access_token(token: str) -> str:
    from backend.orchestration.privacy import hash_secure_token

    return hash_secure_token(token)


def bind_case_access_token(case_id: str, token: str) -> None:
    """Remember passport token on the case so Guardian POSTs survive server reload."""
    if not case_id or not token:
        return
    update_case(case_id, access_token_hash=hash_access_token(token))


def victim_token_ok(token: str, case_id: str | None = None) -> bool:
    """
    Accept live passport token, OR the passport hash bound at Guardian activate,
    OR the case secure-channel token (issued by the pipeline).
    """
    if not token:
        return False
    if consume_or_check_token(token, consume=False):
        return True
    if case_id:
        case = get_case(case_id)
        if not case:
            return False
        stored = case.get('access_token_hash') or ''
        if stored and hash_access_token(token) == stored:
            return True
        owned = find_case_by_secure_token(token)
        if owned and owned.get('id') == case_id:
            return True
        return False
    return find_case_by_secure_token(token) is not None


def _next_public_id(cases: list[dict[str, Any]]) -> str:
    """Allocate durable HVN-#### public incident ids."""
    max_n = 1000
    for c in cases:
        pid = str(c.get('public_id') or '')
        if pid.upper().startswith('HVN-'):
            tail = pid.split('-', 1)[-1]
            try:
                max_n = max(max_n, int(tail))
            except ValueError:
                continue
    return f'HVN-{max_n + 1}'


def create_incident_fast(payload: CaseCreate, evidence_meta: list[dict[str, str]]) -> dict[str, Any]:
    """
    Persist incident only — no RAG/LLM/orchestration.
    Target: return in well under 500ms.
    """
    cases = _load_cases()
    public_id = _next_public_id(cases)
    has_coords = payload.lat is not None and payload.lng is not None
    now = utc_now()
    case = {
        'id': str(uuid.uuid4()),
        'public_id': public_id,
        'notes': payload.notes.strip(),
        'frequency': payload.frequency,
        'severity': payload.severity,
        'name': (payload.name or '').strip() or 'Anonymous',
        'phone': (payload.phone or '').strip() or None,
        'location': (payload.location or '').strip() or None,
        'lat': float(payload.lat) if has_coords else None,
        'lng': float(payload.lng) if has_coords else None,
        'location_updated_at': now if has_coords else None,
        'location_privacy': payload.location_meta or {},
        'evidence': evidence_meta,
        'status': 'open',
        'routing': 'admin',  # provisional until risk job finishes
        'escalation_contacts': escalation_contacts('admin'),
        'risk_score': None,
        'risk_tier': 'analyzing',
        'pipeline_status': 'received',
        'pipeline': {
            'status': 'received',
            'stages': [{'stage': 'received', 'at': now, 'label': 'Incident received'}],
        },
        'conversation': [
            {'role': 'victim', 'content': payload.notes.strip(), 'at': now},
        ],
        'agent_plan': [],
        'agent_log': [],
        'timeline': [
            {'at': now, 'event': 'Incident received', 'detail': public_id, 'meta': {}},
        ],
        'live_status': {
            'analysing': True,
            'plain': 'We\'re analysing it now.',
        },
        'privacy': {'redacted_preview': False, 'contact_visible_to': 'admin'},
        'secure_channel': {},
        'source': 'report',
        'guardian': {},
        'created_at': now,
        'updated_at': now,
        'Name': (payload.name or '').strip() or 'Anonymous',
        'Severity of domestic violence': 'Analyzing',
        'Frequency of Incidents': payload.frequency,
        'Current Situation': payload.notes.strip(),
        'state': (payload.location or '').strip() or 'Unknown',
    }
    cases.insert(0, case)
    _save_cases(cases)
    return case


def create_case(payload: CaseCreate, evidence_meta: list[dict[str, str]]) -> dict[str, Any]:
    """Legacy sync path — prefer create_incident_fast + background jobs."""
    case = create_incident_fast(payload, evidence_meta)
    from backend.orchestration.crisis.jobs import run_incident_pipeline
    from backend.orchestration.engine import survivor_summary

    run_incident_pipeline(case['id'])
    case = get_case(case['id']) or case
    summary = survivor_summary(case)
    out = dict(case)
    out['orchestration_summary'] = summary
    if summary.get('secure_token'):
        out['secure_token'] = summary['secure_token']
    return out


def find_case_by_secure_token(token: str) -> Optional[dict[str, Any]]:
    from backend.orchestration.privacy import verify_secure_token

    for case in _load_cases():
        sc = case.get('secure_channel') or {}
        if verify_secure_token(token, sc.get('token_hash') or ''):
            return case
    return None


def append_secure_message(
    case_id: str, body: str, *, sender: str = 'admin'
) -> Optional[dict[str, Any]]:
    from backend.orchestration.privacy import encrypt_text

    cases = _load_cases()
    for i, case in enumerate(cases):
        if case.get('id') != case_id:
            continue
        sc = dict(case.get('secure_channel') or {})
        messages = list(sc.get('messages') or [])
        messages.append(
            {
                'id': str(uuid.uuid4()),
                'sender': sender,
                'body_encrypted': encrypt_text(body.strip()),
                'at': utc_now(),
            }
        )
        sc['messages'] = messages
        case['secure_channel'] = sc
        case['updated_at'] = utc_now()
        cases[i] = case
        _save_cases(cases)
        return case
    return None


def reorchestrate_case(case_id: str) -> Optional[dict[str, Any]]:
    from backend.orchestration.engine import run_orchestration

    case = get_case(case_id)
    if not case:
        return None
    case = run_orchestration(case, trigger='reorchestrate')
    persist = {k: v for k, v in case.items() if not k.startswith('_')}
    return update_case(case_id, **{k: v for k, v in persist.items() if k != 'id'})


def list_cases() -> list[dict[str, Any]]:
    return _load_cases()


def get_case(case_id: str) -> Optional[dict[str, Any]]:
    for case in _load_cases():
        if case.get('id') == case_id:
            return case
    return None


def merge_guardian(existing: dict[str, Any] | None, incoming: dict[str, Any] | None) -> dict[str, Any]:
    """Merge guardian blobs without wiping live transcript lines."""
    prev = dict(existing or {})
    nxt = dict(incoming or {})
    if not nxt:
        return prev
    if not prev:
        out = dict(nxt)
        lines = list(out.get('transcript') or [])
        out['transcript'] = lines[-80:]
        return out

    prev_lines = list(prev.get('transcript') or [])
    next_lines = list(nxt.get('transcript') or [])
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for line in prev_lines + next_lines:
        if not isinstance(line, dict):
            continue
        text = str(line.get('text') or '').strip()
        if not text:
            continue
        key = f"{line.get('at') or ''}|{text}"
        if key in seen:
            continue
        seen.add(key)
        merged.append(line)
    out = {**prev, **nxt}
    out['transcript'] = merged[-80:]
    out['active'] = bool(prev.get('active') or nxt.get('active'))
    out['recording'] = bool(prev.get('recording') or nxt.get('recording'))
    # Merge detected events (union by kind|t_sec|label)
    prev_ev = list(prev.get('detected_events') or [])
    next_ev = list(nxt.get('detected_events') or [])
    ev_seen: set[str] = set()
    ev_merged: list[dict[str, Any]] = []
    for ev in prev_ev + next_ev:
        if not isinstance(ev, dict):
            continue
        key = f"{ev.get('kind')}|{ev.get('t_sec')}|{ev.get('label')}"
        if key in ev_seen:
            continue
        ev_seen.add(key)
        ev_merged.append(ev)
    if ev_merged:
        out['detected_events'] = ev_merged[-40:]
    # Prefer non-empty live_summary
    if not (nxt.get('live_summary') or '').strip() and (prev.get('live_summary') or '').strip():
        out['live_summary'] = prev.get('live_summary')
    # Never clear evidence_pending / contacts_notified to False if newer says True
    if prev.get('evidence_pending') and 'evidence_pending' not in nxt:
        out['evidence_pending'] = True
    if prev.get('contacts_notified') or nxt.get('contacts_notified'):
        out['contacts_notified'] = bool(prev.get('contacts_notified') or nxt.get('contacts_notified'))
    return out


def update_case(case_id: str, **fields: Any) -> Optional[dict[str, Any]]:
    cases = _load_cases()
    for i, case in enumerate(cases):
        if case.get('id') == case_id:
            if 'guardian' in fields:
                fields = {
                    **fields,
                    'guardian': merge_guardian(case.get('guardian'), fields.get('guardian')),
                }
            case.update(fields)
            case['updated_at'] = utc_now()
            cases[i] = case
            _save_cases(cases)
            return case
    return None


def save_evidence_file(
    filename: str,
    content: bytes,
    *,
    encrypt: bool = True,
    duration_sec: float | None = None,
    kind: str = 'audio',
) -> dict[str, Any]:
    """Persist evidence bytes; optionally Fernet-wrap at rest; return rich metadata."""
    import hashlib

    ensure_dirs()
    digest = hashlib.sha256(content).hexdigest()
    safe_name = f'{uuid.uuid4().hex}_{Path(filename).name}'
    path = UPLOAD_DIR / safe_name
    encrypted_at_rest = False
    stored = content
    if encrypt:
        try:
            from backend.orchestration.privacy import _fernet

            f = _fernet()
            if f is not None:
                stored = f.encrypt(content)
                encrypted_at_rest = True
                if not safe_name.endswith('.enc'):
                    safe_name = f'{safe_name}.enc'
                    path = UPLOAD_DIR / safe_name
        except Exception:
            encrypted_at_rest = False
            stored = content
    path.write_bytes(stored)
    return {
        'id': uuid.uuid4().hex,
        'filename': Path(filename).name,
        'stored_as': safe_name,
        'path': str(path),
        'sha256': digest,
        'bytes': len(content),
        'size': len(content),
        'duration_sec': duration_sec,
        'encrypted_at_rest': encrypted_at_rest,
        'kind': kind,
        'uploaded_at': utc_now(),
        'pending': False,
    }


def read_evidence_bytes(meta: dict[str, Any]) -> bytes | None:
    """Load evidence from disk; decrypt Fernet wrapper when needed."""
    stored_as = meta.get('stored_as') or ''
    path_str = meta.get('path') or ''
    path = Path(path_str) if path_str else (UPLOAD_DIR / stored_as if stored_as else None)
    if not path or not path.exists():
        return None
    raw = path.read_bytes()
    if meta.get('encrypted_at_rest'):
        try:
            from backend.orchestration.privacy import _fernet

            f = _fernet()
            if f is not None:
                return f.decrypt(raw)
        except Exception:
            return None
    return raw


def append_audio_chunk(case_id: str, seq: int, content: bytes) -> Path:
    """Append/write chunk into a staging file for this case session."""
    ensure_dirs()
    staging = UPLOAD_DIR / f'guardian_session_{case_id}.webm.part'
    # WebM timeslices from MediaRecorder are not trivial to concatenate as raw bytes
    # for all browsers; we still append for finalize assembly of blob parts from client.
    # Prefer client finalize with full blob; staging keeps latest chunk for Gemini STT.
    chunk_path = UPLOAD_DIR / f'guardian_chunk_{case_id}_{seq}.webm'
    chunk_path.write_bytes(content)
    # Track session index
    idx_path = UPLOAD_DIR / f'guardian_session_{case_id}.idx'
    prev = []
    if idx_path.exists():
        try:
            prev = json.loads(idx_path.read_text(encoding='utf-8'))
        except Exception:
            prev = []
    prev.append({'seq': seq, 'file': chunk_path.name, 'bytes': len(content)})
    idx_path.write_text(json.dumps(prev[-200:]), encoding='utf-8')
    # Also rewrite staging with last chunk (usable for STT)
    staging.write_bytes(content)
    return chunk_path


def assemble_session_audio(case_id: str) -> bytes | None:
    """Concatenate staged chunks in seq order (best-effort WebM parts)."""
    idx_path = UPLOAD_DIR / f'guardian_session_{case_id}.idx'
    if not idx_path.exists():
        return None
    try:
        items = json.loads(idx_path.read_text(encoding='utf-8'))
    except Exception:
        return None
    parts: list[bytes] = []
    for item in sorted(items, key=lambda x: int(x.get('seq') or 0)):
        p = UPLOAD_DIR / str(item.get('file') or '')
        if p.exists():
            parts.append(p.read_bytes())
    if not parts:
        return None
    return b''.join(parts)


def to_admin_dashboard_doc(case: dict[str, Any]) -> dict[str, Any]:
    """Document shape expected by the web admin RealtimeList."""
    severity_map = {
        'low': 'Low',
        'medium': 'Medium',
        'high': 'High',
        'critical': 'Very High',
    }
    return {
        'Name': case.get('name') or case.get('Name') or 'Anonymous',
        'state': case.get('location') or case.get('state') or 'Unknown',
        'Severity of domestic violence': severity_map.get(
            case.get('severity', 'medium'), 'Medium'
        ),
        'Frequency of Incidents': case.get('frequency'),
        'Current Situation': case.get('notes'),
        'Phone Number': case.get('phone'),
        'status': case.get('status', 'open'),
        'routing': case.get('routing'),
        'case_id': case.get('id'),
        'escalation_contacts': case.get('escalation_contacts'),
        'created_at': case.get('created_at'),
        'lat': case.get('lat'),
        'lng': case.get('lng'),
        'location_updated_at': case.get('location_updated_at'),
    }
