"""In-memory live event hub for admin + victim dashboards."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

_queues: list[asyncio.Queue] = []
_queue_loops: dict[int, asyncio.AbstractEventLoop] = {}
_case_presence: dict[str, dict[str, Any]] = {}


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    try:
        _queue_loops[id(q)] = asyncio.get_running_loop()
    except RuntimeError:
        pass
    _queues.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    try:
        _queues.remove(q)
    except ValueError:
        pass
    _queue_loops.pop(id(q), None)


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


def _enqueue(q: asyncio.Queue, payload: dict[str, Any]) -> bool:
    """Put payload on queue; drop oldest on overflow. Returns False if queue is dead."""
    try:
        q.put_nowait(payload)
        return True
    except asyncio.QueueFull:
        try:
            q.get_nowait()
        except Exception:
            pass
        try:
            q.put_nowait(payload)
            return True
        except Exception:
            return False
    except Exception:
        return False


def publish(event: dict[str, Any]) -> None:
    """Thread-safe publish — pipeline jobs run in a threadpool."""
    payload = {**event, 'ts': event.get('ts') or time.time()}
    dead: list[asyncio.Queue] = []
    for q in list(_queues):
        loop = _queue_loops.get(id(q))

        if loop is not None and loop.is_running():

            def _put(queue: asyncio.Queue = q, data: dict[str, Any] = payload) -> None:
                _enqueue(queue, data)

            try:
                loop.call_soon_threadsafe(_put)
            except RuntimeError:
                if not _enqueue(q, payload):
                    dead.append(q)
        else:
            if not _enqueue(q, payload):
                dead.append(q)
    for q in dead:
        unsubscribe(q)


def publish_case(case: dict[str, Any], *, event_type: str = 'case_update') -> None:
    guardian = case.get('guardian') or {}
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
            'source': case.get('source'),
            'guardian': {
                'active': bool(guardian.get('active')),
                'recording': bool(guardian.get('recording')),
                'stealth': bool(guardian.get('stealth')),
                'activated_at': guardian.get('activated_at'),
                'transcript_tail': (guardian.get('transcript') or [])[-12:],
                'transcript_count': len(guardian.get('transcript') or []),
                'detected_events': (guardian.get('detected_events') or [])[-12:],
                'live_summary': guardian.get('live_summary'),
                'recording_meta': guardian.get('recording_meta'),
                'evidence_pending': bool(guardian.get('evidence_pending')),
                'contacts_notified': bool(guardian.get('contacts_notified')),
            }
            if guardian
            else None,
        }
    )


def encode(event: dict[str, Any]) -> str:
    return json.dumps(event, ensure_ascii=False, default=str)
