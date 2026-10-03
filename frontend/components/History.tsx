"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  cancelUpload,
  deleteUpload,
  isActive,
  isRunning,
  listUploads,
  type UploadSummary,
} from "@/lib/api";
import StatusBadge from "./StatusBadge";

type Filter = "all" | "active" | "completed" | "failed";

export default function History() {
  const [items, setItems] = useState<UploadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const anyActive = useRef(false);
  const reload = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      clearTimeout(timer);
      try {
        const data = await listUploads();
        if (!alive) return;
        anyActive.current = data.some((d) => isActive(d.status));
        setItems(data);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : "Could not load past uploads.");
      }
      if (alive) timer = setTimeout(load, anyActive.current ? 3000 : 15000);
    }
    reload.current = load;
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((u) => {
      if (q && !u.filename.toLowerCase().includes(q)) return false;
      if (filter === "active") return isActive(u.status);
      if (filter === "completed") return u.status === "completed";
      if (filter === "failed") return u.status === "failed" || u.status === "cancelled";
      return true;
    });
  }, [items, query, filter]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setActionError(null);
    setPending((p) => new Set(p).add(id));
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "That didn't work. Please try again.");
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(id);
        return n;
      });
      reload.current();
    }
  }

  const finished = (items ?? []).filter((u) => !isActive(u.status));

  async function clearFinished() {
    if (!window.confirm(`Delete ${finished.length} finished upload(s) permanently?`)) return;
    for (const u of finished) await act(u.id, () => deleteUpload(u.id));
  }

  return (
    <section className="card">
      <div className="row spread">
        <h2>Past uploads</h2>
        {finished.length > 1 && (
          <button className="btn btn-ghost btn-sm" onClick={clearFinished}>
            Clear finished ({finished.length})
          </button>
        )}
      </div>

      {items && items.length > 0 && (
        <div className="row toolbar">
          <input
            className="search"
            type="search"
            placeholder="Search by file name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter by status">
            <option value="all">All</option>
            <option value="active">In progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed / cancelled</option>
          </select>
        </div>
      )}

      {error && <p className="error">{error} Retrying automatically…</p>}
      {actionError && <p className="error">{actionError}</p>}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items && items.length === 0 && <p className="muted">Nothing yet. Upload a file above.</p>}
      {items && items.length > 0 && shown.length === 0 && <p className="muted">No uploads match.</p>}

      {shown.length > 0 && (
        <ul className="list">
          {shown.map((u) => {
            const busy = pending.has(u.id);
            return (
              <li key={u.id}>
                <div className="item">
                  <Link href={`/uploads/${u.id}`} className="item-main">
                    <span className="name">{u.filename}</span>
                    <span className="meta">
                      {isActive(u.status) && <span className="pct-sm">{u.progress}%</span>}
                      <StatusBadge status={u.status} />
                      <span className="muted">{new Date(u.created_at).toLocaleString()}</span>
                    </span>
                  </Link>
                  <div className="item-actions">
                    {isActive(u.status) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => act(u.id, () => cancelUpload(u.id))}
                      >
                        Cancel
                      </button>
                    )}
                    {!isRunning(u.status) && (
                      <button
                        className="btn btn-danger-ghost btn-sm"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Delete “${u.filename}” permanently?`)) act(u.id, () => deleteUpload(u.id));
                        }}
                        aria-label={`Delete ${u.filename}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {isActive(u.status) && (
                  <div className="bar bar-thin">
                    <div style={{ width: `${u.progress}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
