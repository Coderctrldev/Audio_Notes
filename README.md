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
   Open http://localhost:3000.

## Deploy (single VPS, one URL, HTTPS)
1. Create an S3-compatible bucket and an access key for it.
2. On a server with Docker, point a domain (or `<server-ip>.sslip.io`) at it and open ports 80/443.
3. `cp .env.example .env` and fill it in. `TRANSCRIPTION_PROVIDER` must be `gnani`.
4. `docker compose -f docker-compose.prod.yml --env-file .env up -d --build`
5. Open `https://<DOMAIN>/api/health`. It must show `"transcription_provider": "gnani"`.

## Before submitting
- [ ] Live URL works from a fresh browser; /health shows `gnani`
- [ ] Real 2+ minute file transcribes end to end with Gnani
- [ ] Failure tests: renamed .txt as .mp3, wrong Gnani key, worker stopped mid-job then Retry
- [ ] `GITHUB_URL` is your real repo, so /architecture links to it
- [ ] No keys in git history (`.env` is ignored)
- [ ] You can explain every file (see worker.py first)
