# Running AImesis locally

Backend (FastAPI, port 8000) serves the built frontend, so one origin and one URL for phones.

```bash
# 1. build the frontend once (re-run after frontend changes)
cd frontend && npm install && npm run build && cd ..

# 2. start the backend (from backend/)
cd backend && cp .env.example .env   # first time only
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`. Parent page: `http://<laptop-ip>:8000/m/<token>` (the clinician console has a "Share with Family" QR).

Useful env vars (backend `.env`): `CLINICIAN_API_KEY` (protect clinician endpoints), `USE_LLM=true` (Gemini rationale/vision), `ENABLE_UPLOADS=true` (parent photos), `PUBLIC_BASE_URL` (link/QR host), `FRONTEND_DIST`.
Demo data resets with `POST /api/admin/reset` (needs header `X-Admin-Key` when `ADMIN_KEY` is set).

## Deploy to Cloud Run
Everything is public (no real patient data), except the data reset, which needs `ADMIN_KEY`.
```bash
gcloud auth login
export PROJECT=<your-gcp-project-id>
export ADMIN_KEY=<pick-one>   # share with the team, not in git
./deploy.sh
# Demo reset (also: Reset button in the clinician UI, enter the same key):
curl -X POST -H "X-Admin-Key: $ADMIN_KEY" https://<your-cloud-run-url>/api/admin/reset
```
