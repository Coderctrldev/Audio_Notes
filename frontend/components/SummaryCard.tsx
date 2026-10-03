"use client";

import { useState } from "react";
import type { Summary } from "@/lib/api";

const REASON_TITLES: Record<string, string> = {
  no_speech: "No speech detected",
  too_short: "Recording too short",
  insufficient_content: "Not enough conversation",
  too_vague: "Content too vague",
  unsupported_language: "Language not recognised",
  unintelligible: "Audio unclear",
  llm_error: "Summary unavailable",
};

function toText(s: Summary): string {
  const out: string[] = [];
  if (s.title) out.push(s.title, "");
  if (s.overview) out.push(s.overview, "");
  const block = (head: string, items?: string[]) => {
    if (items?.length) out.push(head, ...items.map((i) => `- ${i}`), "");
  };
  block("Key points", s.key_points);
  block("Decisions", s.decisions);
  block("Action items", s.action_items);
  if (s.topics?.length) out.push(`Topics: ${s.topics.join(", ")}`);
  return out.join("\n").trim();
}

function List({ title, items, tone }: { title: string; items?: string[]; tone?: string }) {
  if (!items?.length) return null;
  return (
    <div className={`sum-block ${tone ?? ""}`}>
      <h3>{title}</h3>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export default function SummaryCard({
  summary,
  onRegenerate,
  regenerating,
  hasTranscript,
  pending,
  onDownload,
}: {
  summary: Summary | null;
  onRegenerate: () => void;
  regenerating: boolean;
  hasTranscript: boolean;
  pending?: boolean;
  onDownload?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ok = summary?.kind === "ok";
  const canRegenerate = hasTranscript && !pending && summary?.reason !== "no_speech" && summary?.reason !== "too_short";

  async function copy() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(toText(summary));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <section className="card">
      <div className="row spread">
        <h2>Summary</h2>
        <div className="row">
          {ok && (
            <button className="btn btn-ghost" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {ok && onDownload && (
            <button className="btn btn-ghost" onClick={onDownload}>
              Download
            </button>
          )}
          {canRegenerate && (
            <button className="btn btn-ghost" onClick={onRegenerate} disabled={regenerating}>
              {regenerating ? "Working…" : "Regenerate"}
            </button>
          )}
        </div>
      </div>

      {pending && <p className="muted">Writing the summary…</p>}
      {!summary && !pending && <p className="muted">No summary.</p>}

      {summary && !ok && (
        <div className={summary.reason === "llm_error" ? "notice notice-warn" : "notice"}>
          <strong>{REASON_TITLES[summary.reason ?? ""] ?? "No summary"}</strong>
          <p>{summary.message || "A summary couldn't be generated for this recording."}</p>
          {summary.reason !== "llm_error" && hasTranscript && (
            <p className="muted">The full transcript is still available below.</p>
          )}
        </div>
      )}

      {ok && summary && (
        <div className="summary">
          {summary.title && <p className="sum-title">{summary.title}</p>}
          {summary.topics && summary.topics.length > 0 && (
            <div className="chips">
              {summary.topics.map((t, i) => (
                <span key={i} className="chip">
                  {t}
                </span>
              ))}
              {summary.language && <span className="chip chip-lang">{summary.language}</span>}
            </div>
          )}
          {summary.overview && <p className="sum-overview">{summary.overview}</p>}
          <List title="Key points" items={summary.key_points} />
          <List title="Decisions" items={summary.decisions} tone="sum-decision" />
          <List title="Action items" items={summary.action_items} tone="sum-action" />
        </div>
      )}
    </section>
  );
}
