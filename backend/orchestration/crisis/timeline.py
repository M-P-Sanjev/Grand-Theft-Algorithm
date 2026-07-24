from __future__ import annotations

from typing import Any

from backend.cases import utc_now


def append_timeline(case: dict[str, Any], event: str, *, detail: str = '', meta: dict[str, Any] | None = None) -> None:
    """Append a live incident timeline entry (mutates case)."""
    tl = list(case.get('timeline') or [])
    tl.append(
        {
            'at': utc_now(),
            'event': event,
            'detail': detail,
            'meta': meta or {},
        }
    )
    case['timeline'] = tl[-80:]


def append_risk_point(case: dict[str, Any], severity: dict[str, Any]) -> None:
    hist = list(case.get('risk_history') or [])
    hist.append(
        {
            'at': utc_now(),
            'score': severity.get('risk_index'),
            'tier': severity.get('tier'),
            'emotion': (severity.get('emotion') or {}).get('primary'),
            'confidence': severity.get('confidence'),
        }
    )
    case['risk_history'] = hist[-40:]
