// All talking to the backend lives here, so components never build URLs or parse errors themselves.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export const ALLOWED_EXT = [".wav", ".mp3", ".ogg", ".flac", ".aac", ".m4a"];

export const LANGUAGES = [
  { code: "en-IN", label: "English (India)" },
  { code: "as-IN", label: "Assamese" },
  { code: "hi-IN", label: "Hindi" },
  { code: "bn-IN", label: "Bengali" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "mr-IN", label: "Marathi" },
  { code: "or-IN", label: "Odia" },
  { code: "pa-IN", label: "Punjabi" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
];

export type Status =
  | "queued"
  | "processing"
  | "transcribing"
  | "summarizing"
  | "completed"
  | "failed"
  | "cancelled";

export const isActive = (s: Status) => s !== "completed" && s !== "failed" && s !== "cancelled";
// Worker is busy with it (can be cancelled, can't be deleted until cancelled).
export const isRunning = (s: Status) => s === "processing" || s === "transcribing" || s === "summarizing";

export interface UploadSummary {
  id: string;
  filename: string;
  status: Status;
  progress: number;
  created_at: string;
}

export type SummaryReason =
  | "no_speech" | "too_short" | "insufficient_content" | "too_vague"
  | "unsupported_language" | "unintelligible" | "llm_error";

export interface Summary {
  kind: "ok" | "unavailable";
  reason: SummaryReason | null;
  message: string;
  title?: string;
  overview?: string;
  key_points?: string[];
  topics?: string[];
  decisions?: string[];
  action_items?: string[];
  language?: string;
  word_count?: number;
}

export interface UploadDetail extends UploadSummary {
  language_code: string;
  completed_chunks: number;
  total_chunks: number;
  transcript: string | null;
  summary: Summary | null;
  error_message: string | null;
  updated_at: string;
}

export class ApiError extends Error {
  status: number; // 0 = network failure (never reached the server)
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
  }
  return `Request failed (HTTP ${status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, cache: "no-store" });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(messageFrom(body, res.status), res.status);
  }
  return (await res.json()) as T;
}

export const listUploads = () => request<UploadSummary[]>("/uploads");
export const getUpload = (id: string) => request<UploadDetail>(`/uploads/${id}`);
export const retryUpload = (id: string) =>
  request<{ id: string; status: Status }>(`/uploads/${id}/retry`, { method: "POST" });

export const cancelUpload = (id: string) =>
  request<{ id: string; status: Status }>(`/uploads/${id}/cancel`, { method: "POST" });
export const resummarizeUpload = (id: string) =>
  request<{ id: string; status: Status }>(`/uploads/${id}/resummarize`, { method: "POST" });

export async function deleteUpload(id: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/uploads/${id}`, { method: "DELETE", cache: "no-store" });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (res.ok) return;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  throw new ApiError(messageFrom(body, res.status), res.status);
}

// fetch() can't report upload progress, so uploads use XMLHttpRequest.
// No client-side timeout or size cap: the task allows any length/size.
export function uploadFile(
  file: File,
  languageCode: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("language_code", languageCode);

    xhr.open("POST", `${API_URL}/uploads`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded * 100) / e.total));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body && typeof body === "object" && "id" in body) {
        resolve({ id: String((body as { id: unknown }).id) });
      } else {
        reject(new ApiError(messageFrom(body, xhr.status), xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("Upload failed: network error. Please try again.", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
