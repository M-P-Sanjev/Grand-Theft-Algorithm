from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from typing import Any


def _try_twilio(to_phone: str | None, body: str) -> dict[str, Any]:
    sid = os.getenv('TWILIO_ACCOUNT_SID')
    token = os.getenv('TWILIO_AUTH_TOKEN')
    from_num = os.getenv('TWILIO_FROM')
    if not (sid and token and from_num and to_phone):
        return {'channel': 'sms', 'status': 'skipped', 'detail': 'Twilio or phone missing'}
    try:
        from twilio.rest import Client  # type: ignore

        client = Client(sid, token)
        msg = client.messages.create(body=body[:1500], from_=from_num, to=to_phone)
        return {'channel': 'sms', 'status': 'sent', 'detail': msg.sid}
    except Exception as exc:
        return {'channel': 'sms', 'status': 'error', 'detail': str(exc)[:200]}


def _try_smtp(subject: str, body: str) -> dict[str, Any]:
    host = os.getenv('SMTP_HOST')
    user = os.getenv('SMTP_USER')
    password = os.getenv('SMTP_PASSWORD')
    to_addr = os.getenv('SMTP_TO') or user
    port = int(os.getenv('SMTP_PORT', '587'))
    if not (host and user and password and to_addr):
        return {'channel': 'email', 'status': 'skipped', 'detail': 'SMTP not configured'}
    try:
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = user
        msg['To'] = to_addr
        msg.set_content(body)
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(user, password)
            smtp.send_message(msg)
        return {'channel': 'email', 'status': 'sent', 'detail': to_addr}
    except Exception as exc:
        return {'channel': 'email', 'status': 'error', 'detail': str(exc)[:200]}


def run_notify(case: dict[str, Any]) -> dict[str, Any]:
    routing = case.get('routing') or 'admin'
    case_id = case.get('id', '')
    risk = case.get('risk_tier') or case.get('severity')
    primary = (case.get('escalation_contacts') or {}).get('primary') or routing

    body = (
        f"[Safra SOS] Case {case_id[:8]} routed to {routing}. "
        f"Risk={risk}. Contact pack: {primary}"
    )

    attempts = []
    # Always queue in-app
    attempts.append(
        {
            'channel': 'in_app',
            'status': 'queued',
            'detail': 'Logged for admin command center',
        }
    )

    if routing in ('police', 'ngo'):
        attempts.append(_try_twilio(case.get('phone'), body))
        attempts.append(
            _try_smtp(
                subject=f'Safra SOS {routing.upper()} — {case_id[:8]}',
                body=body,
            )
        )

    sent_any = any(a.get('status') == 'sent' for a in attempts)
    status = 'notify_sent' if sent_any else 'notify_queued'

    return {
        'agent': 'notify',
        'status': status,
        'attempts': attempts,
        'message': f'{status}: {routing}',
        'rationale': 'Outbound notify with graceful fallbacks',
        'source': 'rules',
    }
