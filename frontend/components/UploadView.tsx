"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  cancelUpload,
  deleteUpload,
  getUpload,
  isActive,
  resummarizeUpload,
  retryUpload,
  type Status,
  type Summary,
  type UploadDetail,
} from "@/lib/api";
import StatusBadge from "./StatusBadge";
import SummaryCard from "./SummaryCard";

const STEPS: { key: Status; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "processing", label: "Preparing audio" },
  { key: "transcribing", label: "Transcribing" },
  { key: "summarizing", label: "Summarizing" },
  { key: "completed", label: "Done" },
];

const SLOW_MS = 2 * 60 * 1000; // show a "taking longer than usual" note
const STUCK_MS = 15 * 60 * 1000; // matches the backend's stalled-job rule

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: ignore */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function summaryToText(s: Summary): string {
  const out: string[] = [];
  if (s.title) out.push(s.title, "");
  if (s.overview) out.push(s.overview, "");
  for (const [head, items] of [
    ["Key points", s.key_points],
    ["Decisions", s.decisions],
    ["Action items", s.action_items],
  ] as const) {
    if (items?.length) out.push(head, ...items.map((i) => `- ${i}`), "");
  }
  return out.join("\n").trim();
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sec`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min${s ? ` ${s} sec` : ""}`;
}

export default function UploadView({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<UploadDetail | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [netFails, setNetFails] = useState(0);
  const [pollKey, setPollKey] = useState(0); // bump to restart polling
  const [busy, setBusy] = useState<null | "retry" | "cancel" | "delete" | "summary">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // (time, completed chunks) samples used to estimate the time remaining
  const samples = useRef<{ t: number; c: number }[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const d = await getUpload(id);
        if (!alive) return;
        if (d.status === "transcribing") {
          const last = samples.current[samples.current.length - 1];
          if (!last || last.c !== d.completed_chunks) {
            samples.current.push({ t: Date.now(), c: d.completed_chunks });
          }
        } else {
          samples.current = [];
        }
        setData(d);
        setNetFails(0);
        if (!isActive(d.status)) return; // finished: stop polling
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) {
          setFatal("This upload does not exist (it may have been deleted).");
          return;
        }
        setNetFails((n) => n + 1); // keep polling through temporary errors
      }
      timer = setTimeout(tick, 2000);
    }
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, pollKey]);

  // tick once a second so "elapsed" and the idle checks stay current
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(kind);
    setActionError(null);
    try {
      await fn();
      setPollKey((k) => k + 1);
      after?.();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (fatal) {
    return (
      <section className="card">
        <p className="error">{fatal}</p>
        <Link href="/">Back to uploads</Link>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="card">
        <p className="muted">{netFails > 1 ? "Cannot reach the server, retrying…" : "Loading…"}</p>
      </section>
    );
  }

  const active = isActive(data.status);
  const running = ["processing", "transcribing", "summarizing"].includes(data.status);
  const idleMs = now - new Date(data.updated_at).getTime();
  const slow = running && idleMs > SLOW_MS;
  const canRetry = data.status === "failed" || data.status === "cancelled" || (active && idleMs > STUCK_MS);
  const stepIndex = STEPS.findIndex((s) => s.key === data.status);
  const elapsedSec = Math.max(0, (now - new Date(data.created_at).getTime()) / 1000);

  // ETA from observed chunk throughput (needs two samples; hidden until then)
  let eta: string | null = null;
  const sm = samples.current;
  if (data.status === "transcribing" && sm.length >= 2 && data.total_chunks > 0) {
    const first = sm[0];
    const lastS = sm[sm.length - 1];
    const perChunk = (lastS.t - first.t) / 1000 / Math.max(1, lastS.c - first.c);
    const remaining = data.total_chunks - data.completed_chunks;
    if (perChunk > 0 && remaining > 0) eta = fmtDuration(perChunk * remaining);
  }

  let label = "";
  if (data.status === "queued") label = "Waiting for a worker to pick this up…";
  else if (data.status === "processing") label = "Checking and splitting the audio…";
  else if (data.status === "transcribing")
    label = `Transcribing part ${Math.min(data.completed_chunks + 1, data.total_chunks)} of ${data.total_chunks}`;
  else if (data.status === "summarizing") label = "Writing the summary…";

  const summaryBusy = data.status === "summarizing" && data.transcript;

  return (
    <div className="stack">
      <p>
        <Link href="/">← All uploads</Link>
      </p>

      <section className="card">
        <div className="row spread">
          <h2 className="break">{data.filename}</h2>
          <StatusBadge status={data.status} />
        </div>

        {active && (
          <>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.key} className={i < stepIndex ? "done" : i === stepIndex ? "current" : ""}>
                  {s.label}
                </li>
              ))}
            </ol>

            <div className="pct-row">
              <span className="pct">{data.progress}%</span>
              <span className="muted">
                {data.total_chunks > 0 && data.status === "transcribing"
                  ? `${data.completed_chunks}/${data.total_chunks} parts done · `
                  : ""}
                elapsed {fmtDuration(elapsedSec)}
                {eta ? ` · about ${eta} left` : ""}
              </span>
            </div>
            <div
              className="bar"
              role="progressbar"
              aria-valuenow={data.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div style={{ width: `${data.progress}%` }} />
            </div>
            <p className="muted">{label}</p>

            {netFails > 1 && <p className="warn">Connection problem. Still trying to reach the server…</p>}
            {slow && (
              <p className="warn">
                No progress update for {fmtDuration(idleMs / 1000)}. Long recordings can take several minutes;
                you can leave this page and come back from the list.
              </p>
            )}
          </>
        )}

        {data.status === "failed" && <p className="error">{data.error_message ?? "Processing failed."}</p>}
        {data.status === "cancelled" && (
          <p className="notice">
            <strong>Cancelled.</strong> Parts already transcribed are kept, so restarting won&apos;t redo them.
          </p>
        )}

        <div className="row actions">
          {active && (
            <button className="btn btn-danger-ghost" disabled={busy !== null} onClick={() => run("cancel", () => cancelUpload(id))}>
              {busy === "cancel" ? "Cancelling…" : "Cancel processing"}
            </button>
          )}
          {canRetry && (
            <button className="btn" disabled={busy !== null} onClick={() => run("retry", () => retryUpload(id))}>
              {busy === "retry" ? "Starting…" : data.status === "cancelled" ? "Restart" : "Retry"}
            </button>
          )}
          {!running && (
            <button
              className="btn btn-danger"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm(`Delete “${data.filename}”? The audio, transcript and summary will be removed permanently.`)) {
                  run("delete", () => deleteUpload(id), () => router.push("/"));
                }
              }}
            >
              {busy === "delete" ? "Deleting…" : "Delete"}
            </button>
          )}
          {canRetry && data.status !== "cancelled" && (
            <span className="muted">Parts that already succeeded are not redone.</span>
          )}
        </div>
        {actionError && <p className="error">{actionError}</p>}
      </section>

      {(data.status === "completed" || summaryBusy) && (
        <>
          <SummaryCard
            summary={summaryBusy ? null : data.summary}
            hasTranscript={!!data.transcript}
            pending={!!summaryBusy}
            regenerating={busy === "summary" || data.status !== "completed"}
            onRegenerate={() => run("summary", () => resummarizeUpload(id))}
          />
          {data.summary?.kind === "ok" && (
            <div className="row">
              <button
                className="btn btn-ghost"
                onClick={() => downloadText(`${data.filename}-summary.txt`, summaryToText(data.summary as Summary))}
              >
                Download summary .txt
              </button>
            </div>
          )}

          <section className="card">
            <div className="row spread">
              <h2>Transcript</h2>
              <div className="row">
                {data.transcript && <CopyButton text={data.transcript} />}
                {data.transcript && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => downloadText(`${data.filename}.txt`, data.transcript ?? "")}
                  >
                    Download .txt
                  </button>
                )}
              </div>
            </div>
            <p className="pre transcript">{data.transcript || "No speech detected."}</p>
          </section>
        </>
      )}
    </div>
  );
}
