# Safra

### *Help that doesn’t look like help.*

Safra is a discreet safety system for survivors in monitored environments. It hides behind a normal **Recipes / Shopping List** app, lets users privately save evidence, get cited rights info, and alert a **verified NGO** — without looking like a safety app.

> The most dangerous moment isn’t the abuse — it’s being caught asking for help.

---

## Problem

About **1 in 3 women** face violence globally; ~**30% in India** report domestic violence (WHO / NFHS). Abusers often monitor phones. Visible SOS apps can increase risk.

**Safra’s job:** help that survives a phone check.

---

## Solution

| Layer | What |
|-------|------|
| **Cover Mode** | Looks like recipes / shopping |
| **Quiet Relay** | “Share recipe” → NGO alert |
| **Clarity Tools** | Camera vault + Rights RAG + silent Calm Cards |

**Flow:** Cover app → secret unlock → note/photo → share recipe → NGO console → panic back to cover.

---

## Features

- **Cover Mode** — decoy UI, panic exit, duress PIN  
- **Evidence Vault** — photos/notes, share only when chosen  
- **Quiet Relay** — structured SOS to NGO (not public social stego)  
- **Rights Guide (RAG)** — cited answers + “not legal advice” + helpline  
- **Calm Cards** — silent text grounding (no loud TTS)  
- **NGO Console** — human triage + severity suggestion  

---

## Tech stack

**Frontend:** Next.js, TypeScript, Tailwind  
**Backend:** FastAPI, MongoDB Atlas  
**AI:** RAG (legal/helpline docs), LLM, severity ML assist  


```text
Cover UI → Safe Mode (vault / RAG / relay) → FastAPI → MongoDB → NGO Console
```

---

## Setup

**Backend**
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate          # Windows
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

**Env (backend):** `MONGO_URI`, `LLM_API_KEY`, `EMBEDDINGS_API_KEY`  
**Env (frontend):** `NEXT_PUBLIC_API_URL`, Clerk keys  

---

## Demo (3 min)

1. Show recipes (Cover Mode)  
2. Unlock → add note + photo  
3. Share recipe → alert on NGO screen  
4. Ask one Rights question (with citation)  
5. Panic → back to recipes  

---

## Safety

Safra is a **support tool**, not rescue or legal/medical advice. Prefer human helplines/NGOs when safe. Design assumes discovery risk (cover, duress, panic).

---

## Commit convention

All pushes to this repo use the commit comment **`Chris`**.

---

## Team

**Hackathon:** RUSH HOUR Open Innovation  
**Repo:** Grand-Theft-Algorithm  

| Name | Role |
|------|------|
| | |
| | |

**Links:** Demo · Live site · Pitch  

**License:** MIT
