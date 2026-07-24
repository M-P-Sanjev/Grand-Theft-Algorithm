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

# Short-lived passport session tokens (demo; in-memory)
PASSPORT_TOKENS: set[str] = set()


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


class EscalateRequest(BaseModel):
    target: Routing
    admin_key: str


class AdminAuth(BaseModel):
    admin_key: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def secret_passport() -> str:
    return os.getenv('SECRET_PASSPORT', 'SAFEWATER')


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


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


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
    return token


def consume_or_check_token(token: str, consume: bool = False) -> bool:
    if token not in PASSPORT_TOKENS:
        return False
    if consume:
        PASSPORT_TOKENS.discard(token)
    return True


def create_case(payload: CaseCreate, evidence_meta: list[dict[str, str]]) -> dict[str, Any]:
    routing = compute_routing(payload.severity, payload.frequency)
    has_coords = payload.lat is not None and payload.lng is not None
    case = {
        'id': str(uuid.uuid4()),
        'notes': payload.notes.strip(),
        'frequency': payload.frequency,
        'severity': payload.severity,
        'name': (payload.name or '').strip() or 'Anonymous',
        'phone': (payload.phone or '').strip() or None,
        'location': (payload.location or '').strip() or None,
        'lat': float(payload.lat) if has_coords else None,
        'lng': float(payload.lng) if has_coords else None,
        'location_updated_at': utc_now() if has_coords else None,
        'evidence': evidence_meta,
        'status': 'open',
        'routing': routing,
        'escalation_contacts': escalation_contacts(routing),
        'created_at': utc_now(),
        'updated_at': utc_now(),
        # Shape compatible with older admin dashboard fields
        'Name': (payload.name or '').strip() or 'Anonymous',
        'Severity of domestic violence': payload.severity.replace('_', ' ').title()
        if payload.severity != 'critical'
        else 'Very High',
        'Frequency of Incidents': payload.frequency,
        'Current Situation': payload.notes.strip(),
        'state': (payload.location or '').strip() or 'Unknown',
    }
    cases = _load_cases()
    cases.insert(0, case)
    _save_cases(cases)
    return case


def list_cases() -> list[dict[str, Any]]:
    return _load_cases()


def get_case(case_id: str) -> Optional[dict[str, Any]]:
    for case in _load_cases():
        if case.get('id') == case_id:
            return case
    return None


def update_case(case_id: str, **fields: Any) -> Optional[dict[str, Any]]:
    cases = _load_cases()
    for i, case in enumerate(cases):
        if case.get('id') == case_id:
            case.update(fields)
            case['updated_at'] = utc_now()
            cases[i] = case
            _save_cases(cases)
            return case
    return None


def save_evidence_file(filename: str, content: bytes) -> dict[str, str]:
    ensure_dirs()
    safe_name = f'{uuid.uuid4().hex}_{Path(filename).name}'
    path = UPLOAD_DIR / safe_name
    path.write_bytes(content)
    return {
        'filename': Path(filename).name,
        'stored_as': safe_name,
        'path': str(path),
    }


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
