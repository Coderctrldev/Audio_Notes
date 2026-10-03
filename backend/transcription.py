"""Transcription provider switch.

TRANSCRIPTION_PROVIDER=gnani   -> Gnani REST STT (REQUIRED for the final submission, default)
TRANSCRIPTION_PROVIDER=gemini  -> dev/testing only, to save Gnani credits

Both providers take one <=30s WAV chunk and return plain text, and both raise
gnani.ASRError on failure, so the worker doesn't care which one ran."""
import os
import random
import time

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

import gnani
from gnani import ASRError

LANG_NAMES = {
    "bn-IN": "Bengali", "en-IN": "English", "gu-IN": "Gujarati", "hi-IN": "Hindi",
    "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi", "pa-IN": "Punjabi",
    "ta-IN": "Tamil", "te-IN": "Telugu", "as-IN": "Assamese", "or-IN": "Odia",
}


def provider() -> str:
    return os.environ.get("TRANSCRIPTION_PROVIDER", "gnani").lower()


def _gemini(path: str, language_code: str, max_attempts: int = 5) -> str:
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    with open(path, "rb") as f:
        data = f.read()  # a 30s mono 16 kHz WAV is ~1 MB, fine to send inline
    lang = LANG_NAMES.get(language_code, "the spoken language")
    prompt = (
        f"Transcribe this audio verbatim in {lang}. Output only the spoken words, "
        "with no commentary or labels. If there is no speech, output nothing."
    )
    last = "unknown error"
    for attempt in range(max_attempts):
        try:
            resp = client.models.generate_content(
                model=os.environ["GEMINI_MODEL"],
                contents=[prompt, types.Part.from_bytes(data=data, mime_type="audio/wav")],
            )
            return (resp.text or "").strip()
        except genai_errors.ClientError as e:
            if getattr(e, "code", None) != 429:  # bad key / bad model name / bad request: retrying won't help
                raise ASRError(f"Gemini rejected the request ({getattr(e, 'code', '?')}): {e}", fatal=True)
            last = "rate limited (429)"
        except genai_errors.ServerError as e:  # 500/503: Google-side overload, usually passes in seconds
            last = f"Gemini server error {getattr(e, 'code', '?')}: {getattr(e, 'message', e)}"
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
        if attempt < max_attempts - 1:
            time.sleep(min(30, 3 * 2 ** attempt) + random.random())  # 3s, 6s, 12s, 24s + jitter
    raise ASRError(f"Gemini transcription failed after {max_attempts} attempts. Last error: {last}")


def transcribe_chunk(path: str, language_code: str) -> str:
    p = provider()
    if p == "gnani":
        return gnani.transcribe_chunk(path, language_code)
    if p == "gemini":
        return _gemini(path, language_code)
    raise ASRError(f"Unknown TRANSCRIPTION_PROVIDER '{p}'.", fatal=True)