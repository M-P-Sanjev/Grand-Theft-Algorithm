# Grand Theft Algorithm

AI-powered safety platform with a **Safra food-ordering cover app**. A menu item named **Water** quietly unlocks a secret passport flow for survivors to submit notes and evidence. Cases are processed by a **multi-agent crisis orchestration engine** (risk, **RAG legal**, **RAG therapy**, dispatch, notify) with privacy-preserving secure messaging.

## Layout

| Path | Purpose |
|------|---------|
| `frontend/` | Safra cover UI (menu, Water → passport → report, `/admin`, `/secure`) |
| `backend/` | FastAPI SOS + orchestration agents |
| `backend/orchestration/` | Risk / legal / therapy / dispatch / notify + RAG |
| `backend/knowledge/` | Curated legal + therapy markdown corpora for RAG |
| `haven-frontend/` | Legacy law/therapy apps (optional; Safra embeds agents in-app) |
| `ai-avatar/` | Mental-health AI avatar (optional) |

## Water cover flow

1. Open Safra menu → select **Water** (does not add to cart).
2. Enter the secret passport OTP (default `SAFRA`).
3. On `/report`, allow **location access** (“confirm delivery area”) so GPS is attached to the case.
4. Fill abuse notes + optional evidence, then submit.
5. Orchestration runs immediately:
   - **Risk agent** scores 0–100 and sets `risk_tier`
   - **Legal / therapy agents** answer via **RAG** over `backend/knowledge/`
   - **Dispatch** routes `police` / `ngo` / `admin`
   - **Notify** queues in-app alerts (Twilio/SMTP when configured)
   - Survivor receives a **secure channel** link
6. Cases appear on `/admin` (admin key default `admin123`):
   - Priority queue by **risk score**, then frequency
   - **Live Leaflet / OpenStreetMap** (no Google Maps key needed) + **SSE** (~3s)
   - Agent timeline, re-orchestrate, RAG legal/therapy chat, encrypted messages
7. **High / critical** risk → auto-route **Police**.
8. **Repeated / ongoing** (non-critical) → auto-route **NGO**.

## Quick start

### 1) SOS backend (required)

```bash
cd backend
python -m venv .venv
# Windows:
.\.venv\Scripts\Activate
pip install fastapi uvicorn python-dotenv python-multipart pydantic cryptography
copy .env.example .env
cd ..
uvicorn backend.sos_app:app --reload --port 8000
```

Health check: http://127.0.0.1:8000/health — should include `"orchestration": true`.

### 2) Safra cover frontend

```bash
cd frontend
npm install
copy .env.local.example .env.local
```

Set `NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000` in `.env.local` if needed.

```bash
npm run dev
```

Open http://localhost:3000

- Victim: Menu → **Water** → `SAFRA` → `/report` → see risk + RAG legal/therapy
- Secure inbox: `/secure/<token>` from the confirmation screen
- Admin: http://localhost:3000/admin → `admin123` (Leaflet map loads without extra keys)

### Crisis command center (not a chatbot)

Pipeline per message / case:
`emotion → severity classifier (no LLM) → safety plan → vector RAG → companion reply → live admin/victim boards`

- Therapy: acknowledge → validate → one step → one question
- Legal: plain-English rights, steps, time, documents, helplines, “What next?”
- Severity: violence/threat/fear/isolation/urgency/mental/children/weapon → Risk Index 0–100
- Live: `GET /cases/stream` (SSE) + `WS /ws/live`

- Corpus: `backend/knowledge/legal/*.md` and `backend/knowledge/therapy/*.md`
- Local index: `backend/data/rag_index.json` (always available as fallback)
- **Streaming chat:** `POST /cases/{id}/agents/{legal|therapy}/stream` (SSE token stream)
- UI: premium `AiChatPanel` (bubbles, history, markdown, sources, quick prompts, regenerate/copy/read-aloud)

Passport OTP default: **`SAFRA`**

### Option A — Gemini + MongoDB Atlas Vector Search

1. Open [Google AI Studio](https://aistudio.google.com/apikey) → **Create API key** → copy the key.
2. In `backend/.env`, set:
   - `GEMINI_API_KEY=<your key>`
   - `MONGO_ENDPOINT=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority`
   - `MONGO_DB_NAME=SheBuilds` (or your DB name)
3. In [MongoDB Atlas](https://cloud.mongodb.com/):
   1. Open your cluster → **Browse Collections**.
   2. Create database `SheBuilds` and collection `rag_chunks` if they do not exist.
   3. Select `rag_chunks` → **Search Indexes** → **Create Search Index** → **JSON Editor** → **Next**.
   4. Index name: `rag_vector_index`
   5. Paste:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    }
  ]
}
```

   6. Click **Create Search Index**. Wait until status is **Active** (often 1–2 minutes).
4. Restart the API from the repo root. On startup it seeds `rag_chunks` with Gemini `gemini-embedding-001` (768-d) vectors when keys are present.
5. Or from repo root after `MONGO_ENDPOINT` is set: `python -m backend.scripts.setup_atlas_rag`
6. Optional reindex: `POST http://127.0.0.1:8000/rag/reindex` with header `X-Admin-Key: admin123`.

Without Atlas/Gemini, local TF-IDF RAG still streams answers in the same UI.

### Optional cloud keys (`backend/.env`)

| Variable | Effect when set |
|----------|-----------------|
| `GEMINI_API_KEY` | Embeddings + streamed answers; also risk triage |
| `MONGO_ENDPOINT` | Atlas case mirror + vector RAG store |
| `MONGO_RAG_INDEX` | Vector index name (default `rag_vector_index`) |
| `TWILIO_*` | SMS on police/NGO dispatch |
| `SMTP_*` | Email on police/NGO dispatch |
| `PRIVACY_SECRET` | Fernet key material for encrypted messages |

Without these keys, RAG (local), orchestration, Leaflet map, and `notify_queued` still work end-to-end.

## Orchestration diagram

```text
/report submit → create_case → Risk → Legal(RAG) → Therapy(RAG) → Dispatch → Notify
                                      ↓
                              cases.json + agent_log
                                      ↓
                         /admin (SSE + Leaflet) + /secure/{token}
```

## Notes

- Secrets stay in `.env` / `.env.local` (gitignored).
- Local cases: `backend/data/cases.json`
- Uploaded evidence: `backend/uploads/`
- Admin list view redacts names/phones until a case is opened
