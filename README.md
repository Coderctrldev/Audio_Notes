# Audio Notes

Upload an audio file, get a transcript (Gnani ASR) and a summary (Gemini).
Next.js · FastAPI · Postgres · Redis + RQ · S3-compatible storage · ffmpeg.
The written design is on the app's `/architecture` page (source: `frontend/app/architecture/page.tsx`).

## Layout
```
backend/    FastAPI API, RQ worker, Dockerfile, docker-compose.yml (local dev stack)
frontend/   Next.js app (upload, history, detail, /architecture)
docker-compose.prod.yml + Caddyfile   single-server deployment with automatic HTTPS
```

## Run locally
1. Backend (API + worker + Postgres + Redis + MinIO):
   ```
   cd backend
   cp .env.example .env        # fill GNANI_API_KEY, GEMINI_API_KEY, GEMINI_MODEL
   docker compose up --build
   ```
   Check http://localhost:8000/health and http://localhost:8000/docs.
   Set `TRANSCRIPTION_PROVIDER=gemini` in `backend/.env` while developing to save Gnani credits.
2. Frontend:
   ```
   cd frontend
   cp .env.example .env.local
   npm install
   npm run dev
   ```
   Open http://localhost:3001.

