"""
Create SheBuilds.rag_chunks and seed Gemini embeddings into MongoDB Atlas.

Usage (from repo root, after MONGO_ENDPOINT is set in backend/.env):
  python -m backend.scripts.setup_atlas_rag
"""

from __future__ import annotations

import json
import os
import sys

from dotenv import load_dotenv

load_dotenv()
load_dotenv('backend/.env')

VECTOR_INDEX_JSON = {
    'fields': [
        {
            'type': 'vector',
            'path': 'embedding',
            'numDimensions': 768,
            'similarity': 'cosine',
        }
    ]
}


def main() -> int:
    uri = os.getenv('MONGO_ENDPOINT')
    if not uri:
        print('ERROR: Set MONGO_ENDPOINT in backend/.env first.')
        print('Paste your Atlas connection string, then re-run this script.')
        return 1

    db_name = os.getenv('MONGO_DB_NAME', 'SheBuilds')
    col_name = os.getenv('MONGO_RAG_COLLECTION', 'rag_chunks')
    index_name = os.getenv('MONGO_RAG_INDEX', 'rag_vector_index')

    try:
        from pymongo import MongoClient
    except ImportError:
        print('ERROR: pymongo missing. Run: pip install pymongo')
        return 1

    print('Connecting to Atlas...')
    client = MongoClient(uri, serverSelectionTimeoutMS=8000)
    client.admin.command('ping')
    print('Ping OK')

    db = client[db_name]
    col = db[col_name]
    # Creating a collection happens on first write; insert a marker then remove if empty seed fails
    if col_name not in db.list_collection_names():
        db.create_collection(col_name)
        print(f'Created collection {db_name}.{col_name}')
    else:
        print(f'Collection exists: {db_name}.{col_name} ({col.estimated_document_count()} docs)')

    gemini = bool(os.getenv('GEMINI_API_KEY'))
    print(f'GEMINI_API_KEY present: {gemini}')

    from backend.orchestration.rag.mongo_store import seed_knowledge_to_mongo

    result = seed_knowledge_to_mongo(force=True)
    print('Seed result:', result)

    print()
    print('=== Create this Atlas Vector Search index next ===')
    print(f'Database: {db_name}')
    print(f'Collection: {col_name}')
    print(f'Index name: {index_name}')
    print(json.dumps(VECTOR_INDEX_JSON, indent=2))
    print()
    print('Atlas UI: Collection > Search Indexes > Create > JSON Editor > paste above > Create')
    return 0 if result.get('ok') else 2


if __name__ == '__main__':
    sys.exit(main())
