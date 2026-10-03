"""Structured summaries.

summarize() never raises for "bad input": it returns a dict with kind != "ok" and a
machine-readable `reason`, so the UI can explain exactly why there is no summary.
Only real service failures (LLM down, bad key) raise SummaryError.

Stored in uploads.summary as JSON text, so no schema change is needed."""
import json
import os
import re
import time

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

MIN_WORDS = 15            # below this there is nothing meaningful to summarize
SEGMENT_CHARS = 20000     # transcripts longer than this are summarized in segments first

MESSAGES = {
    "no_speech": "No speech was detected in this audio, so there is nothing to summarize.",
    "too_short": "The recording is too short to summarize. Try a longer clip with a few sentences of speech.",
    "insufficient_content": "There isn't enough conversation to summarize. The audio has no real discussion or information.",
    "too_vague": "The content is too vague to summarize: it has no clear topic, facts, or decisions.",
    "unsupported_language": "The speech doesn't appear to be in the language you selected, or it's not a supported language. Re-upload and choose the language that is actually spoken.",
    "unintelligible": "The transcript is mostly unintelligible (noise, music, or very poor audio), so a reliable summary isn't possible.",
    "llm_error": "The summary service is temporarily unavailable. Your transcript is saved. Use “Regenerate summary” to try again.",
}

PROMPT = """You analyse transcripts of audio recordings (meetings, calls, lectures, voice notes).
The speaker was expected to use: {lang}.

First decide whether a useful summary is possible. Set "status" to exactly one of:
- "ok": there is real, meaningful content.
- "insufficient_content": greetings, small talk, a few stray words, or no real discussion.
- "too_vague": speech exists but has no identifiable topic, facts, decisions or actions.
- "unsupported_language": the transcript is mainly in a language other than {lang}, or is a language you cannot read reliably.
- "unintelligible": mostly garbled, repeated or nonsensical text.

If status is "ok", fill the other fields faithfully from the transcript. Never invent facts,
names, numbers or action items that are not in the transcript. Write in the transcript's own language.
If a field has nothing, use an empty list or empty string.

Return ONLY JSON with this shape:
{{"status": "...", "title": "short title, max 8 words",
 "overview": "2-4 sentence summary",
 "key_points": ["3-6 concise points"],
 "topics": ["1-5 short topic tags"],
 "decisions": ["decisions made, if any"],
 "action_items": ["tasks or follow-ups, with owner/date only if stated"],
 "language": "language of the transcript"}}

TRANSCRIPT:
"""


class SummaryError(Exception):
    """The summary service failed (not the user's audio). Safe to retry."""


def _result(kind: str, reason: str | None = None, **data) -> dict:
    out = {"kind": kind, "reason": reason, "message": MESSAGES.get(reason or "", ""), **data}
    return out


def _word_count(text: str) -> int:
    return len(re.findall(r"\w+", text, flags=re.UNICODE))


TRANSIENT = {429, 500, 502, 503, 504}   # overload / rate limit: worth waiting and retrying
ATTEMPTS = 5                              # waits 2, 4, 8, 16 s between attempts


def _models() -> list[str]:
    """Primary model, then an optional fallback used when the primary is overloaded."""
    names = [os.environ["GEMINI_MODEL"]]
    fb = os.environ.get("GEMINI_FALLBACK_MODEL", "").strip()
    if fb and fb != names[0]:
        names.append(fb)
    return names


def _generate(client, prompt: str, **config):
    """generate_content with backoff on 429/5xx and model fallback; raises SummaryError."""
    models = _models()
    last = "unknown error"
    for attempt in range(ATTEMPTS):
        # first 2 attempts on the primary model, the rest alternate onto the fallback
        model = models[0] if attempt < 2 or len(models) == 1 else models[(attempt - 1) % len(models)]
        try:
            return client.models.generate_content(
                model=model, contents=prompt, config=types.GenerateContentConfig(**config)
            )
        except genai_errors.APIError as e:
            code = getattr(e, "code", None)
            last = f"{code} {getattr(e, 'status', '')}".strip()
            if code not in TRANSIENT:  # bad key / bad request: waiting won't help
                raise SummaryError(f"Gemini rejected the request ({last}).")
        except Exception as e:  # network blips
            last = type(e).__name__
        if attempt < ATTEMPTS - 1:
            time.sleep(2 ** (attempt + 1))
    raise SummaryError(f"Gemini is overloaded or unreachable after {ATTEMPTS} attempts ({last}).")


def _ask_json(client, prompt: str) -> dict:
    for _ in range(2):  # one extra try if the model returns malformed JSON
        resp = _generate(client, prompt, response_mime_type="application/json", temperature=0.2)
        try:
            text = re.sub(r"^```(?:json)?|```$", "", (resp.text or "").strip()).strip()
            data = json.loads(text)
            if isinstance(data, dict):
                return data
        except ValueError:
            pass
    raise SummaryError("The model returned an unreadable answer twice.")


def _as_list(v) -> list[str]:
    return [str(x).strip() for x in v if str(x).strip()] if isinstance(v, list) else []


def summarize(transcript: str, language_name: str = "the selected language") -> dict:
    transcript = (transcript or "").strip()
    n = _word_count(transcript)
    if n == 0:
        return _result("unavailable", "no_speech")
    if n < MIN_WORDS:
        return _result("unavailable", "too_short", word_count=n)

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    body = transcript
    if len(transcript) > SEGMENT_CHARS:
        # Very long transcript: condense each segment, then analyse the condensed text.
        parts = [transcript[i:i + SEGMENT_CHARS] for i in range(0, len(transcript), SEGMENT_CHARS)]
        condensed = []
        for p in parts:
            r = _generate(
                client,
                "Condense this transcript segment, keeping every fact, name, number, decision "
                "and action item. Same language as the text.\n\n" + p,
            )
            condensed.append((r.text or "").strip())
        body = "\n\n".join(condensed)

    data = _ask_json(client, PROMPT.format(lang=language_name) + body)
    status = str(data.get("status", "ok")).lower()
    if status != "ok":
        reason = status if status in MESSAGES else "insufficient_content"
        return _result("unavailable", reason, word_count=n)

    overview = str(data.get("overview", "")).strip()
    points = _as_list(data.get("key_points"))
    if not overview and not points:
        return _result("unavailable", "insufficient_content", word_count=n)
    return _result(
        "ok",
        title=str(data.get("title", "")).strip(),
        overview=overview,
        key_points=points,
        topics=_as_list(data.get("topics")),
        decisions=_as_list(data.get("decisions")),
        action_items=_as_list(data.get("action_items")),
        language=str(data.get("language", "")).strip(),
        word_count=n,
    )


def error_result() -> dict:
    return _result("unavailable", "llm_error")