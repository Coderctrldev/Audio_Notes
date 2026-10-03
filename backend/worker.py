import json
import logging
import os
import tempfile
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from sqlalchemy import func, select, update

import audio
import gnani
import storage
import summarize as llm
import transcription
from db import SessionLocal
from models import AudioChunk, Status, Upload

log = logging.getLogger(__name__)

# Chunks sent to the ASR API at the same time. Retries already back off on 429s, so a small
# amount of parallelism is safe and makes long files several times faster.
CONCURRENCY = max(1, int(os.environ.get("TRANSCRIBE_CONCURRENCY", "3")))


class Cancelled(Exception):
    """The user cancelled or deleted this upload while it was running."""


def claim(db, upload_id: str) -> bool:
    """Atomic claim: only one worker can flip queued -> processing."""
    res = db.execute(
        update(Upload)
        .where(Upload.id == upload_id, Upload.status == Status.queued.value)
        .values(status=Status.processing.value, error_message=None)
    )
    db.commit()
    return res.rowcount == 1


def _check_cancel(db, upload_id: str) -> None:
    status = db.execute(select(Upload.status).where(Upload.id == upload_id)).scalar()
    db.rollback()  # end the read transaction so the next read sees fresh data
    if status is None or status == Status.cancelled.value:
        raise Cancelled()


def _advance(db, up, from_status: Status, **values) -> None:
    """Move to the next stage only if nobody cancelled in the meantime."""
    res = db.execute(
        update(Upload).where(Upload.id == up.id, Upload.status == from_status.value).values(**values)
    )
    db.commit()
    if res.rowcount != 1:
        raise Cancelled()
    db.refresh(up)


def _transcribe_all(db, up) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "original" + os.path.splitext(up.storage_key)[1])
        storage.download(up.storage_key, src)
        _check_cancel(db, up.id)
        audio.probe_duration(src)  # raises BadAudio on corrupt files
        chunks = audio.split_audio(src, os.path.join(tmp, "chunks"))

        existing = {c.chunk_index: c for c in db.query(AudioChunk).filter_by(upload_id=up.id)}
        done_now = sum(1 for c in existing.values() if c.status == "done")
        _advance(
            db, up, Status.processing,
            total_chunks=len(chunks), completed_chunks=done_now, status=Status.transcribing.value,
        )

        todo = [i for i in range(len(chunks)) if not (existing.get(i) and existing[i].status == "done")]
        pending = iter(todo)
        in_flight: dict = {}

        def submit(pool) -> bool:
            i = next(pending, None)
            if i is None:
                return False
            row = existing.get(i)
            if not row:
                row = existing[i] = AudioChunk(upload_id=up.id, chunk_index=i, attempts=0, status="pending")
                db.add(row)
            row.attempts += 1
            up.updated_at = func.now()  # heartbeat for stalled-job detection
            db.commit()
            fut = pool.submit(transcription.transcribe_chunk, chunks[i], up.language_code)
            in_flight[fut] = i
            return True

        pool = ThreadPoolExecutor(max_workers=CONCURRENCY)
        try:
            for _ in range(CONCURRENCY):
                if not submit(pool):
                    break
            while in_flight:
                finished, _ = wait(in_flight, return_when=FIRST_COMPLETED)
                for fut in finished:
                    i = in_flight.pop(fut)
                    row = existing[i]
                    try:
                        text = fut.result()
                    except gnani.ASRError as e:
                        row.status, row.error_message = "failed", str(e)
                        db.commit()  # persist which chunk failed, then bubble up
                        raise
                    row.transcript, row.status, row.error_message = text, "done", None
                    db.commit()
                    up.completed_chunks = db.query(AudioChunk).filter_by(upload_id=up.id, status="done").count()
                    up.updated_at = func.now()
                    db.commit()
                    _check_cancel(db, up.id)
                    submit(pool)
        finally:
            pool.shutdown(wait=True, cancel_futures=True)


def _summary_stage(db, up) -> None:
    """Summary is its own stage: if it fails, the transcript is kept and the user can regenerate."""
    lang = transcription.LANG_NAMES.get(up.language_code, up.language_code)
    try:
        result = llm.summarize(up.transcript or "", lang)
    except Exception:
        log.exception("summary failed for %s", up.id)
        result = llm.error_result()
    _advance(db, up, Status.summarizing, summary=json.dumps(result, ensure_ascii=False),
             status=Status.completed.value)


def process_upload(upload_id: str) -> None:
    db = SessionLocal()
    up = None
    try:
        if not claim(db, upload_id):
            return  # duplicate / stale delivery / cancelled while queued
        up = db.get(Upload, upload_id)

        _transcribe_all(db, up)

        parts = db.query(AudioChunk).filter_by(upload_id=up.id).order_by(AudioChunk.chunk_index).all()
        full = " ".join(p.transcript.strip() for p in parts if p.transcript and p.transcript.strip())
        _advance(db, up, Status.transcribing, transcript=full, completed_chunks=len(parts),
                 status=Status.summarizing.value)
        _summary_stage(db, up)

    except Cancelled:
        log.info("upload %s cancelled", upload_id)
    except (audio.BadAudio, gnani.ASRError) as e:
        _fail(db, up, str(e))
    except Exception:
        log.exception("unexpected failure for %s", upload_id)
        _fail(db, up, "Unexpected error while processing. Please retry.")
    finally:
        db.close()


def resummarize(upload_id: str) -> None:
    """Re-run only the summary from the stored transcript (the API set status=summarizing)."""
    db = SessionLocal()
    try:
        up = db.get(Upload, upload_id)
        if up is None or up.status != Status.summarizing.value:
            return
        _summary_stage(db, up)
    except Cancelled:
        pass
    except Exception:
        log.exception("resummarize failed for %s", upload_id)
        db.rollback()
        up = db.get(Upload, upload_id)
        if up is not None and up.status == Status.summarizing.value:
            up.summary, up.status = json.dumps(llm.error_result()), Status.completed.value
            db.commit()
    finally:
        db.close()


def _fail(db, up, message: str) -> None:
    db.rollback()
    if up is None:
        return
    # Don't overwrite a cancel that raced with the failure.
    db.execute(
        update(Upload)
        .where(Upload.id == up.id, Upload.status.notin_([Status.cancelled.value, Status.completed.value]))
        .values(status=Status.failed.value, error_message=message)
    )
    db.commit()
