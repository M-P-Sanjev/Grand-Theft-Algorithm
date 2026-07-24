"""In-memory live event hub for admin + victim dashboards."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

_queues: list[asyncio.Queue] = []
_case_presence: dict[str, dict[str, Any]] = {}


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _queues.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    try:
        _queues.remove(q)
    except ValueError:
        pass


def set_presence(case_id: str, role: str, online: bool = True) -> None:
    slot = _case_presence.setdefault(case_id, {})
    slot[role] = {'online': online, 'at': time.time()}
    publish(
        {
            'type': 'presence',
            'case_id': case_id,
            'role': role,
            'online': online,
        }
    )


def get_presence(case_id: str) -> dict[str, Any]:
    return dict(_case_presence.get(case_id) or {})


def publish(event: dict[str, Any]) -> None:
    payload = {**event, 'ts': event.get('ts') or time.time()}
    dead: list[asyncio.Queue] = []
    for q in list(_queues):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            try:
                q.get_nowait()
            except Exception:
                pass
            try:
                q.put_nowait(payload)
            except Exception:
                dead.append(q)
        except Exception:
            dead.append(q)
    for q in dead:
        unsubscribe(q)


def publish_case(case: dict[str, Any], *, event_type: str = 'case_update') -> None:
    publish(
        {
            'type': event_type,
            'case_id': case.get('id'),
            'public_id': case.get('public_id'),
            'name': case.get('name'),
            'location': case.get('location'),
            'risk_score': case.get('risk_score'),
            'risk_tier': case.get('risk_tier'),
            'severity': case.get('severity'),
            'status': case.get('status'),
            'routing': case.get('routing'),
            'pipeline': case.get('pipeline'),
            'pipeline_status': (case.get('pipeline') or {}).get('status') or case.get('pipeline_status'),
            'ai_summary': case.get('ai_summary'),
            'next_actions': case.get('next_actions'),
            'crisis': case.get('crisis'),
            'lat': case.get('lat'),
            'lng': case.get('lng'),
            'location_privacy': case.get('location_privacy'),
            'location_updated_at': case.get('location_updated_at'),
            'notify_status': case.get('notify_status'),
            'live_status': case.get('live_status'),
            'timeline': case.get('timeline'),
            'legal_brief': case.get('legal_brief'),
            'therapy_brief': case.get('therapy_brief'),
            'ai_recommendation': case.get('ai_recommendation'),
            'nearby_resources': case.get('nearby_resources'),
            'created_at': case.get('created_at'),
            'updated_at': case.get('updated_at'),
        }
    )


def encode(event: dict[str, Any]) -> str:
    return json.dumps(event, ensure_ascii=False, default=str)
