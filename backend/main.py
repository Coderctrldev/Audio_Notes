import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import text, update
from sqlalchemy.orm import Session

import storage
import transcription
from db import engine, get_db
from jobs import enqueue_resummarize, enqueue_upload
from models import ACTIVE_STATUSES, AudioChunk, Base, Status, Upload

ALLOWED_EXT = {".wav", ".mp3", ".ogg", ".flac", ".aac", ".m4a"}
# Gnani Vachana STT languages (as-IN / or-IN added: Assamese and Odia are in its STT list)
LANGUAGES = {
    "as-IN", "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN",
    "ml-IN", "mr-IN", "or-IN", "pa-IN", "ta-IN", "te-IN",
}
STALL_MINUTES = 15
log = logging.getLogger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)  # fine for a take-home; use Alembic in production
    storage.ensure_bucket()
    yield


app = FastAPI(title="Audio Notes API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip().rstrip("/")
        for o in os.environ.get(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001",
        ).split(",")
        if o.strip()
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _progress(up: Upload) -> int:
    if up.status == Status.completed.value:
        return 100
    if up.status == Status.summarizing.value:
        return 95
    if up.total_chunks:
        return min(90, 5 + int(85 * up.completed_chunks / up.total_chunks))  # 5% = audio prepared
    return 5 if up.status == Status.processing.value else 0


def _summary(up: Upload) -> dict:
    return {
        "id": up.id,
        "filename": up.filename,
        "status": up.status,
        "progress": _progress(up),
        "created_at": up.created_at,
    }


def _parse_summary(raw: str | None) -> dict | None:
    """summary is stored as JSON text; older rows hold plain text, so wrap those."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and "kind" in data:
            return data
    except ValueError:
        pass
    return {"kind": "ok", "reason": None, "message": "", "overview": raw, "key_points": [],
            "topics": [], "decisions": [], "action_items": []}


def _detail(up: Upload) -> dict:
    return {
        **_summary(up),
        "language_code": up.language_code,
        "completed_chunks": up.completed_chunks,
        "total_chunks": up.total_chunks,
        "transcript": up.transcript,
        "summary": _parse_summary(up.summary),
        "error_message": up.error_message,
        "updated_at": up.updated_at,
    }


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"ok": True, "transcription_provider": transcription.provider()}


@app.post("/uploads", status_code=202)
def create_upload(
    file: UploadFile = File(...),
    language_code: str = Form("en-IN"),
    db: Session = Depends(get_db),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type '{ext or 'none'}'. Allowed: {', '.join(sorted(ALLOWED_EXT))}")
    if language_code not in LANGUAGES:
        raise HTTPException(400, "Unsupported language code.")

    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size == 0:
        raise HTTPException(400, "The uploaded file is empty.")

    row = Upload(filename=file.filename, language_code=language_code, storage_key="")
    db.add(row)
    db.flush()  # assigns row.id
    row.storage_key = f"uploads/{row.id}/original{ext}"
    try:
        storage.upload(file.file, row.storage_key)
    except Exception:
        log.exception("storage upload failed for key %s", row.storage_key)
        db.rollback()
        raise HTTPException(502, "Could not store the file. Please try again.")
    db.commit()

    try:
        enqueue_upload(row.id)
    except Exception:
        log.exception("enqueue failed for %s", row.id)
        row.status = Status.failed.value
        row.error_message = "Could not queue the job. Please retry."
        db.commit()
    return {"id": row.id, "status": row.status}


@app.get("/uploads")
def list_uploads(db: Session = Depends(get_db)):
    rows = db.query(Upload).order_by(Upload.created_at.desc()).limit(100).all()
    return [_summary(r) for r in rows]


@app.get("/uploads/{upload_id}")
def get_upload(upload_id: str, db: Session = Depends(get_db)):
    up = db.get(Upload, upload_id)
    if not up:
        raise HTTPException(404, "Upload not found")
    return _detail(up)


@app.get("/uploads/{upload_id}/chunks")
def get_chunks(upload_id: str, db: Session = Depends(get_db)):
    if not db.get(Upload, upload_id):
        raise HTTPException(404, "Upload not found")
    rows = db.query(AudioChunk).filter_by(upload_id=upload_id).order_by(AudioChunk.chunk_index).all()
    return [
        {"index": c.chunk_index, "status": c.status, "attempts": c.attempts, "error": c.error_message}
        for c in rows
    ]


@app.post("/uploads/{upload_id}/retry", status_code=202)
def retry_upload(upload_id: str, db: Session = Depends(get_db)):
    up = db.get(Upload, upload_id)
    if not up:
        raise HTTPException(404, "Upload not found")
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALL_MINUTES)
    # stuck = worker died mid-job, or the job was never enqueued
    stuck = (up.status in ACTIVE_STATUSES or up.status == Status.queued.value) and up.updated_at < cutoff
    if up.status not in (Status.failed.value, Status.cancelled.value) and not stuck:
        raise HTTPException(409, "Only failed, cancelled or stalled uploads can be retried.")
    up.status = Status.queued.value
    up.error_message = None
    db.commit()
    try:
        enqueue_upload(up.id)
    except Exception:
        up.status = Status.failed.value
        up.error_message = "Could not queue the job. Please retry."
        db.commit()
        raise HTTPException(503, "Queue unavailable. Please try again shortly.")
    return {"id": up.id, "status": up.status}


@app.post("/uploads/{upload_id}/cancel")
def cancel_upload(upload_id: str, db: Session = Depends(get_db)):
    up = db.get(Upload, upload_id)
    if not up:
        raise HTTPException(404, "Upload not found")
    # Guarded update: only an unfinished job can be cancelled; the worker stops at its next checkpoint.
    res = db.execute(
        update(Upload)
        .where(Upload.id == upload_id, Upload.status.in_([Status.queued.value, *ACTIVE_STATUSES]))
        .values(status=Status.cancelled.value, error_message=None)
    )
    db.commit()
    if res.rowcount != 1:
        raise HTTPException(409, "This upload has already finished, so it can't be cancelled.")
    return {"id": upload_id, "status": Status.cancelled.value}


@app.delete("/uploads/{upload_id}", status_code=204)
def delete_upload(upload_id: str, db: Session = Depends(get_db)):
    up = db.get(Upload, upload_id)
    if not up:
        raise HTTPException(404, "Upload not found")
    if up.status in ACTIVE_STATUSES:
        raise HTTPException(409, "This upload is still processing. Cancel it first, then delete it.")
    key = up.storage_key
    db.query(AudioChunk).filter_by(upload_id=upload_id).delete()  # explicit, don't rely on DB cascade
    db.delete(up)
    db.commit()
    if key:
        try:
            storage.delete(key)
        except Exception:
            log.exception("could not delete stored file %s", key)  # row is gone; orphan file only
    return Response(status_code=204)


@app.post("/uploads/{upload_id}/resummarize", status_code=202)
def resummarize_upload(upload_id: str, db: Session = Depends(get_db)):
    up = db.get(Upload, upload_id)
    if not up:
        raise HTTPException(404, "Upload not found")
    if up.status != Status.completed.value or not (up.transcript or "").strip():
        raise HTTPException(409, "A summary can only be regenerated for a finished upload with a transcript.")
    up.status = Status.summarizing.value
    db.commit()
    try:
        enqueue_resummarize(up.id)
    except Exception:
        log.exception("enqueue resummarize failed for %s", up.id)
        up.status = Status.completed.value
        db.commit()
        raise HTTPException(503, "Queue unavailable. Please try again shortly.")
    return {"id": up.id, "status": up.status}
