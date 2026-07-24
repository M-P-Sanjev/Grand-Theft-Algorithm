"""RAG package for legal / therapy knowledge retrieval."""

from backend.orchestration.rag.answer import answer_with_rag
from backend.orchestration.rag.ingest import ensure_index

__all__ = ['answer_with_rag', 'ensure_index']
