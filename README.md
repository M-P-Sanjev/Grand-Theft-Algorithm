# Grand Theft Algorithm

AI-powered safety platform for discreet emergency communication and survivor support, plus the Safra ordering frontend.

## Layout

| Path | Purpose |
|------|---------|
| `backend/` | FastAPI API (steganography SOS, text/image gen, MongoDB save) |
| `web/` | Next.js app (dashboard, law bot, therapy bot, SOS post flow) |
| `ai-avatar/` | Mental-health AI avatar (backend + frontend) |
| `frontend/` | Safra food-ordering UI (parallax hero, menu, cart, checkout) |

## Quick start

### Backend
```bash
cd backend
python -m venv .venv
# Windows: .\.venv\Scripts\Activate
pip install -r requirements.txt
# create backend/.env with your keys (never commit it)
uvicorn main:app --reload --port 8000
```

### Web app
```bash
cd web
npm install
# create .env.local for Clerk / API URLs
npm run dev
```

### Safra ordering UI
```bash
cd frontend
npm install
npm run dev
```

### AI avatar
See `ai-avatar/ai-avatar-backend` and `ai-avatar/ai-avatar-frontend` READMEs.

## Notes
- Secrets (`.env`, Clerk keys, Google/AWS credentials) are gitignored — add your own locally.
