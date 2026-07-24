"""Crisis support agents — emotion, severity (no LLM), safety, memory, live hub."""

from backend.orchestration.crisis.emotion import detect_emotion
from backend.orchestration.crisis.severity import classify_severity
from backend.orchestration.crisis.pipeline import run_crisis_pipeline, process_victim_message

__all__ = [
    'detect_emotion',
    'classify_severity',
    'run_crisis_pipeline',
    'process_victim_message',
]
