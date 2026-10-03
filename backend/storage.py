"""Thin object-storage layer. The rest of the app never touches boto3 directly,
so swapping MinIO / R2 / B2 / S3 only means changing environment variables."""
import logging
import os

import boto3
from botocore.client import Config

_s3 = boto3.client(
    "s3",
    endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
    region_name=os.environ.get("S3_REGION", "auto"),
    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)
BUCKET = os.environ["S3_BUCKET"]


def upload(file_obj, key: str) -> None:
    _s3.upload_fileobj(file_obj, BUCKET, key)  # streamed + multipart, not loaded into RAM


def download(key: str, destination: str) -> None:
    _s3.download_file(BUCKET, key, destination)


def delete(key: str) -> None:
    _s3.delete_object(Bucket=BUCKET, Key=key)


def ensure_bucket() -> None:
    """Create the bucket if missing (handy for local MinIO). On managed providers the
    token often can't create buckets, so failure here is logged, not fatal."""
    try:
        _s3.head_bucket(Bucket=BUCKET)
    except Exception:
        try:
            _s3.create_bucket(Bucket=BUCKET)
        except Exception as e:
            logging.getLogger(__name__).warning("Could not create bucket %s: %s", BUCKET, e)
