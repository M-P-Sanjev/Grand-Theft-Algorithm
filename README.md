# Grand Theft Algorithm

AI-powered safety platform with a **Safra food-ordering cover app**. A menu item named **Water** quietly unlocks a secret passport flow for survivors to submit notes and evidence.

## Layout

| Path | Purpose |
|------|---------|
| `frontend/` | Safra cover UI (menu, Water → passport → report, `/admin`) |
| `backend/` | FastAPI SOS + legacy safety APIs |
| `web/` | Law bot, therapy bot, Clerk dashboard (optional) |
| `ai-avatar/` | Mental-health AI avatar |

## Water cover flow

1. Open Safra menu → select **Water** (does not add to cart).
2. Enter the secret passport OTP (default `SAFEWATER`).
3. On `/report`, allow **location access** (“confirm delivery area”) so GPS is attached to the case.
4. Fill abuse notes + optional evidence, then submit.
5. Cases appear on `/admin` (admin key default `admin123`):
   - **Priority queue** sorted `critical → high → medium → low`, then frequency, then newest
   - **Live map** with a marker per case that has coordinates
   - Auto-refreshes every **5 seconds**
6. **High / critical** severity → auto-route **Police**.
7. **Repeated / ongoing** (non-critical) → auto-route **NGO**.

## Quick start

### 1) SOS backend (required for Water flow)

```bash
cd backend
python -m venv .venv
# Windows:
.\.venv\Scripts\Activate
pip install fastapi uvicorn python-dotenv python-multipart pydantic
copy .env.example .env
cd ..
uvicorn backend.sos_app:app --reload --port 8000
```

Health check: http://127.0.0.1:8000/health

### 2) Safra cover frontend

```bash
cd frontend
npm install
# optional: echo NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000 > .env.local
npm run dev
```

Open http://localhost:3000

- Victim path: Menu → **Water** → code `SAFEWATER` → `/report` (allow GPS)
- Admin path: http://localhost:3000/admin → key `admin123` (priority list + live map)

### 3) Optional web apps (law / therapy)

```bash
cd web
npm install
npm run dev -- -p 3001
```

### 4) Full legacy backend (Mongo / AWS / steganography)

```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Requires keys in `backend/.env` (see `.env.example`).

## Notes

- Secrets stay in `.env` (gitignored). Never commit real passport/admin keys.
- Local cases store: `backend/data/cases.json`
- Uploaded evidence: `backend/uploads/`
