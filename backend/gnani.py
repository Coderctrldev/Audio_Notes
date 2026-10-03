import os
import time

import httpx

URL = "https://api.vachana.ai/stt/v3"
RETRYABLE = {429, 500, 503}  # transient per Gnani docs; 400/403 are not retried


class ASRError(Exception):
    def __init__(self, msg: str, fatal: bool = False):
        super().__init__(msg)
        self.fatal = fatal


def transcribe_chunk(path: str, language_code: str, max_attempts: int = 4) -> str:
    headers = {"X-API-Key-ID": os.environ["GNANI_API_KEY"]}
    last = "unknown error"
    for attempt in range(max_attempts):
        try:
            with open(path, "rb") as f:
                r = httpx.post(
                    URL,
                    headers=headers,
                    timeout=60,
                    files={"audio_file": (os.path.basename(path), f, "audio/wav")},
                    data={"language_code": language_code, "format": "transcribe"},
                )
        except (httpx.TimeoutException, httpx.TransportError) as e:
            last = f"network error: {type(e).__name__}"
        else:
            if r.status_code == 200:
                body = r.json()
                if body.get("success"):
                    return body.get("transcript", "")  # empty string = silent chunk, valid
                last = "ASR reported failure"
            elif r.status_code in RETRYABLE:
                last = f"ASR busy or unavailable (HTTP {r.status_code})"
            elif r.status_code == 403:
                raise ASRError("ASR rejected the request: check the API key or credits.", fatal=True)
            else:
                raise ASRError(f"ASR rejected the audio (HTTP {r.status_code}).", fatal=True)
        if attempt < max_attempts - 1:
            time.sleep(2 ** attempt)  # 1s, 2s, 4s
    raise ASRError(f"ASR failed after {max_attempts} attempts: {last}")
