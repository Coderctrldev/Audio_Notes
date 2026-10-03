"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ALLOWED_EXT, ApiError, LANGUAGES, uploadFile } from "@/lib/api";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("en-IN");
  const [phase, setPhase] = useState<"idle" | "uploading" | "handoff">("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (phase !== "uploading") return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  function pick(f: File | null | undefined) {
    setError(null);
    if (!f) return;
    const dot = f.name.lastIndexOf(".");
    const ext = dot >= 0 ? f.name.slice(dot).toLowerCase() : "";
    if (!ALLOWED_EXT.includes(ext)) {
      setFile(null);
      setError(`Unsupported file type "${ext || "none"}". Use one of: ${ALLOWED_EXT.join(", ")}`);
      return;
    }
    if (f.size === 0) {
      setFile(null);
      setError("That file is empty.");
      return;
    }
    setFile(f);
  }

  async function submit() {
    if (!file) return;
    setError(null);
    setPhase("uploading");
    setPct(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { id } = await uploadFile(file, language, setPct, ctrl.signal);
      setPhase("handoff");
      router.push(`/uploads/${id}`);
    } catch (e) {
      setPhase("idle");
      setError(e instanceof ApiError ? e.message : "Upload failed. Please try again.");
    }
  }

  const busy = phase !== "idle";

  return (
    <section className="card">
      <h2>Upload audio</h2>
      <div
        className={`drop ${dragging ? "drop-active" : ""}`}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) pick(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_EXT.join(",")}
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {file ? (
          <p className="drop-file">
            <strong>{file.name}</strong> <span className="muted">({formatSize(file.size)})</span>
          </p>
        ) : (
          <>
            <svg className="drop-icon" width="32" height="28" viewBox="0 0 26 22" fill="currentColor" aria-hidden="true">
              <rect x="1" y="8" width="3" height="6" rx="1.5" />
              <rect x="6.5" y="3" width="3" height="16" rx="1.5" />
              <rect x="12" y="0" width="3" height="22" rx="1.5" />
              <rect x="17.5" y="5" width="3" height="12" rx="1.5" />
              <rect x="23" y="9" width="3" height="4" rx="1.5" />
            </svg>
            <p className="drop-title">Drop an audio file here</p>
            <p className="drop-sub">or click to choose a file ({ALLOWED_EXT.join(", ")})</p>
          </>
        )}
      </div>

      <div className="row">
        <label>
          Language
          <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={submit} disabled={!file || busy}>
          {phase === "idle" ? "Transcribe" : phase === "uploading" ? "Uploading…" : "Starting…"}
        </button>
        {phase === "uploading" && (
          <button className="btn btn-ghost" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        )}
      </div>

      <p className="muted form-note">
        Choose the language that is actually spoken in the recording. Mixed or unsupported languages
        may give a poor transcript.
      </p>

      {phase === "uploading" && (
        <div>
          <div className="bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">
            {pct < 100 ? `Uploading… ${pct}%` : "Upload finished, saving to storage…"}
          </p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
