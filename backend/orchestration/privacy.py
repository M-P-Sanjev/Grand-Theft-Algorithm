from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from typing import Any, Optional

try:
    from cryptography.fernet import Fernet, InvalidToken

    _HAS_FERNET = True
except ImportError:  # pragma: no cover
    Fernet = None  # type: ignore
    InvalidToken = Exception  # type: ignore
    _HAS_FERNET = False


def privacy_secret() -> str:
    return os.getenv('PRIVACY_SECRET', 'safra-demo-privacy-secret-change-me')


def _fernet() -> Optional[Any]:
    if not _HAS_FERNET:
        return None
    digest = hashlib.sha256(privacy_secret().encode('utf-8')).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_text(plain: str) -> str:
    if not plain:
        return ''
    f = _fernet()
    if f is None:
        return 'b64:' + base64.urlsafe_b64encode(plain.encode('utf-8')).decode('ascii')
    return 'fernet:' + f.encrypt(plain.encode('utf-8')).decode('ascii')


def decrypt_text(token: str) -> str:
    if not token:
        return ''
    if token.startswith('b64:'):
        return base64.urlsafe_b64decode(token[4:].encode('ascii')).decode('utf-8')
    if token.startswith('fernet:') and _HAS_FERNET:
        f = _fernet()
        assert f is not None
        try:
            return f.decrypt(token[7:].encode('ascii')).decode('utf-8')
        except InvalidToken:
            return ''
    return token


def mask_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    digits = ''.join(c for c in phone if c.isdigit())
    if len(digits) < 4:
        return '****'
    return f'***-***-{digits[-4:]}'


def initials(name: Optional[str]) -> str:
    if not name or name.strip().lower() == 'anonymous':
        return 'A.'
    parts = [p for p in name.strip().split() if p]
    if not parts:
        return 'A.'
    if len(parts) == 1:
        return parts[0][0].upper() + '.'
    return (parts[0][0] + parts[-1][0]).upper() + '.'


def redact_case_for_list(case: dict[str, Any]) -> dict[str, Any]:
    """Admin queue row: hide PII until case is opened."""
    preview = {
        **case,
        'name': initials(case.get('name')),
        'Name': initials(case.get('name') or case.get('Name')),
        'phone': mask_phone(case.get('phone')),
        'notes': _truncate_notes(case.get('notes') or ''),
        'privacy': {
            'redacted_preview': True,
            'contact_visible_to': 'admin_detail',
        },
    }
    # Never expose encrypted payloads or raw secure tokens in list view
    sc = case.get('secure_channel') or {}
    preview['secure_channel'] = {
        'has_inbox': bool(sc.get('messages')),
        'message_count': len(sc.get('messages') or []),
    }
    return preview


def _truncate_notes(notes: str, limit: int = 80) -> str:
    notes = notes.strip()
    if len(notes) <= limit:
        return notes
    return notes[: limit - 1] + '…'


def strip_pii_for_llm(case: dict[str, Any]) -> str:
    notes = (case.get('notes') or '').strip()
    return (
        f"severity={case.get('severity')} frequency={case.get('frequency')} "
        f"risk_tier={case.get('risk_tier')} has_gps={case.get('lat') is not None} "
        f"evidence_count={len(case.get('evidence') or [])} notes={notes[:800]}"
    )


def issue_secure_token() -> tuple[str, str]:
    """Returns (plaintext_token, sha256_hash). Store only the hash."""
    token = secrets.token_urlsafe(24)
    digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
    return token, digest


def hash_secure_token(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def verify_secure_token(token: str, stored_hash: str) -> bool:
    if not token or not stored_hash:
        return False
    return hmac.compare_digest(hash_secure_token(token), stored_hash)
