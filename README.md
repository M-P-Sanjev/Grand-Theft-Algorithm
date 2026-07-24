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
2. Enter the secret passport OTP (default `SAFEWATER`).
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

- Victim: Menu → **Water** → `SAFEWATER` → `/report` → see risk + RAG legal/therapy
- Secure inbox: `/secure/<token>` from the confirmation screen
- Admin: http://localhost:3000/admin → `admin123` (Leaflet map loads without extra keys)

### RAG (legal + therapy)

- Corpus: `backend/knowledge/legal/*.md` and `backend/knowledge/therapy/*.md`
- Index: auto-built to `backend/data/rag_index.json` on first ask
- Without `GEMINI_API_KEY`: local TF-IDF retrieval + extractive answers from top chunks
- With `GEMINI_API_KEY`: Gemini embeddings + grounded generation over retrieved chunks
- Chat UI shows **Sources** under each answer

### Optional cloud keys (`backend/.env`)

| Variable | Effect when set |
|----------|-----------------|
| `GEMINI_API_KEY` | Better RAG embeddings + generated answers; also risk triage |
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
