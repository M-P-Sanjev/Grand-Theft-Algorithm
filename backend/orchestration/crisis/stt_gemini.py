"""Gemini multimodal STT fallback for Guardian audio chunks."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def transcribe_audio_bytes(data: bytes, *, mime: str = 'audio/webm') -> str:
    """
    Best-effort speech-to-text via Gemini.
    Returns empty string when key missing or call fails.
    """
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key or not data:
        return ''
    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(os.getenv('GEMINI_CHAT_MODEL', 'gemini-2.0-flash'))
        prompt = (
            'Transcribe the spoken words in this emergency audio clip. '
            'Return ONLY the transcript text, no quotes or commentary. '
            'If silence or unintelligible, return an empty string.'
        )
        resp = model.generate_content(
            [
                prompt,
                {'mime_type': mime if mime.startswith('audio/') else 'audio/webm', 'data': data},
            ]
        )
        text = (getattr(resp, 'text', None) or '').strip()
        # Strip wrapping quotes Gemini sometimes adds
        if len(text) >= 2 and text[0] == text[-1] and text[0] in '"\'':
            text = text[1:-1].strip()
        if text.lower() in ('', 'empty', 'silence', 'n/a', 'none'):
            return ''
        return text[:500]
    except Exception as exc:
        logger.warning('Gemini STT failed: %s', exc)
        return ''


def polish_summary(draft: str, notes: str) -> str:
    """Optional light polish; falls back to draft on any error."""
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key or not draft:
        return draft
    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(os.getenv('GEMINI_CHAT_MODEL', 'gemini-2.0-flash'))
        resp = model.generate_content(
            'Rewrite this crisis incident summary as ONE short paragraph for emergency responders. '
            'Keep facts only. Do not invent details.\n\n'
            f'Draft: {draft}\nNotes excerpt: {notes[:600]}'
        )
        text = (getattr(resp, 'text', None) or '').strip()
        return text[:600] if text else draft
    except Exception:
        return draft
