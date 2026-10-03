import glob
import json
import os
import subprocess


class BadAudio(Exception):
    """The file is unreadable, empty or corrupted. Retrying won't help."""


def probe_duration(path: str) -> float:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
            capture_output=True, text=True, timeout=60,
        )
    except subprocess.TimeoutExpired:
        raise BadAudio("Timed out while inspecting the audio file.")
    if r.returncode != 0:
        raise BadAudio("File is corrupted or not a readable audio file.")
    try:
        duration = float(json.loads(r.stdout)["format"]["duration"])
    except (KeyError, ValueError, TypeError):
        raise BadAudio("Could not determine audio duration.")
    if duration <= 0:
        raise BadAudio("Audio is empty.")
    return duration


def split_audio(path: str, out_dir: str, seconds: int = 30) -> list[str]:
    """Decode to mono 16 kHz WAV and cut into fixed-length segments.
    Fixed cuts may land mid-word; silence-aware splitting would be a later improvement."""
    os.makedirs(out_dir, exist_ok=True)
    r = subprocess.run(
        [
            "ffmpeg", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", "-f", "segment", "-segment_time", str(seconds),
            "-reset_timestamps", "1", os.path.join(out_dir, "chunk_%04d.wav"),
        ],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise BadAudio("Failed to decode audio.")
    chunks = sorted(glob.glob(os.path.join(out_dir, "chunk_*.wav")))
    if not chunks:
        raise BadAudio("No audio could be extracted.")
    return chunks
