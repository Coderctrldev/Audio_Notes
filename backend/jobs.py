"""Queue helper. Named jobs.py (not queue.py) so it doesn't shadow the stdlib."""
import os

from redis import Redis
from rq import Queue

queue = Queue("audio_tasks", connection=Redis.from_url(os.environ["REDIS_URL"]))


def enqueue_upload(upload_id: str) -> None:
    # Enqueue by import path so the API process doesn't import worker code.
    # job_timeout matters: RQ's default (180s) would kill long transcriptions.
    queue.enqueue("worker.process_upload", upload_id, job_timeout="2h", failure_ttl=86400)


def enqueue_resummarize(upload_id: str) -> None:
    queue.enqueue("worker.resummarize", upload_id, job_timeout="30m", failure_ttl=86400)
