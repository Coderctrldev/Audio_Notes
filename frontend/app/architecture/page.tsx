import Mermaid from "@/components/Mermaid";

const GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/YOUR-USERNAME/audio-notes";

export const metadata = { title: "Architecture · Audio Notes" };

const SYSTEM = `flowchart LR
  subgraph Client
    B["Browser<br/>Next.js UI"]
  end
  subgraph Backend
    API["FastAPI<br/>validate · enqueue · read status"]
    Q[("Redis<br/>RQ queue")]
    W["RQ worker<br/>ffmpeg · ASR · summary"]
  end
  subgraph Storage
    S3[("Object storage<br/>original audio")]
    PG[("PostgreSQL<br/>uploads · chunks<br/>transcript · summary")]
  end
  subgraph External
    ASR["Gnani STT<br/>REST, ≤30 s per call"]
    LLM["Google Gemini<br/>structured summary"]
  end
  B -- "1 POST /uploads" --> API
  API -- "2 stream file" --> S3
  API -- "3 insert row (queued)" --> PG
  API -- "4 enqueue job" --> Q
  Q -- "5 deliver job" --> W
  W -- "download" --> S3
  W -- "chunks, 3 in parallel" --> ASR
  W -- "transcript" --> LLM
  W -- "progress, results" --> PG
  B -. "poll GET /uploads/id every 2 s" .-> API
  API -. "read" .-> PG
  B -. "cancel · delete · retry · regenerate" .-> API`;

const SEQUENCE = `sequenceDiagram
  autonumber
  actor U as User
  participant FE as Browser
  participant API as FastAPI
  participant S3 as Object storage
  participant DB as PostgreSQL
  participant Q as Redis (RQ)
  participant W as Worker
  participant ASR as Gnani STT
  participant LLM as Gemini
  U->>FE: choose file + language
  FE->>API: POST /uploads (progress via XHR)
  API->>S3: stream original
  API->>DB: insert row (queued)
  API->>Q: enqueue job
  API-->>FE: 202 + id
  loop every 2 s
    FE->>API: GET /uploads/id
    API-->>FE: status, percent, parts
  end
  Q->>W: job
  W->>DB: claim (queued to processing)
  W->>S3: download, ffprobe, ffmpeg split
  par up to 3 chunks at once
    W->>ASR: chunk (retry 429/5xx)
    ASR-->>W: text
  end
  W->>DB: save chunk, update percent
  W->>LLM: full transcript
  LLM-->>W: JSON summary or reason
  W->>DB: completed (transcript + summary)
  FE-->>U: summary, key points, actions, transcript`;

const STATES = `stateDiagram-v2
  [*] --> queued
  queued --> processing: worker claims job
  processing --> transcribing: audio split into chunks
  transcribing --> summarizing: all chunks done
  summarizing --> completed: summary stored
  completed --> summarizing: regenerate summary
  processing --> failed: corrupt audio
  transcribing --> failed: ASR error
  failed --> queued: retry
  queued --> cancelled: cancel
  processing --> cancelled: cancel
  transcribing --> cancelled: cancel
  summarizing --> cancelled: cancel
  cancelled --> queued: restart
  completed --> [*]: delete
  failed --> [*]: delete
  cancelled --> [*]: delete`;

const SUMMARY = `flowchart TD
  T["Joined transcript"] --> A{"Any words?"}
  A -- "no" --> R1["no_speech"]
  A -- "yes" --> B{"Fewer than 15 words?"}
  B -- "yes" --> R2["too_short"]
  B -- "no" --> C["Gemini: judge and summarize (JSON)"]
  C -- "service error" --> R3["llm_error<br/>transcript kept, Regenerate button"]
  C --> D{"status"}
  D -- "ok" --> OK["Structured summary<br/>title · overview · key points<br/>decisions · action items · topics"]
  D -- "insufficient_content" --> R4["Not enough conversation"]
  D -- "too_vague" --> R5["Too vague"]
  D -- "unsupported_language" --> R6["Wrong or unsupported language"]
  D -- "unintelligible" --> R7["Audio unclear"]`;

const DATA = `erDiagram
  UPLOADS ||--o{ AUDIO_CHUNKS : has
  UPLOADS {
    string id PK
    string filename
    string storage_key
    string language_code
    string status
    int total_chunks
    int completed_chunks
    text transcript
    text summary_json
    text error_message
    datetime created_at
    datetime updated_at
  }
  AUDIO_CHUNKS {
    int id PK
    string upload_id FK
    int chunk_index
    string status
    text transcript
    int attempts
    text error_message
  }`;

export default function Architecture() {
  return (
    <article className="card doc">
      <h1 style={{ marginTop: 0 }}>Architecture</h1>
      <p>
        Source code:{" "}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          {GITHUB_URL}
        </a>
      </p>

      <h2>Overview</h2>
      <p>
        A user uploads an audio file. The API stores it and returns immediately. A background worker
        validates and splits the audio, transcribes the pieces with Gnani&apos;s speech-to-text API,
        and asks an LLM (Google Gemini) for a structured summary. The browser polls a status
        endpoint, so the user sees a live percentage, the current stage, an estimate of the time left,
        and a plain-language reason whenever something fails or a summary can&apos;t be produced.
      </p>
      <div className="legend">
        <div>
          <strong>Never blocks the request</strong>All slow work happens in the worker, not in the API call.
        </div>
        <div>
          <strong>Resumable</strong>Finished chunks are saved, so retry and restart skip them.
        </div>
        <div>
          <strong>Always explains itself</strong>Every failure has a stored reason shown in the UI.
        </div>
        <div>
          <strong>User stays in control</strong>Cancel, delete, retry and regenerate the summary.
        </div>
      </div>

      <h2>System diagram</h2>
      <Mermaid chart={SYSTEM} label="System architecture: browser, API, queue, worker, storage and external services" />

      <h2>Request flow: upload to summary</h2>
      <Mermaid chart={SEQUENCE} label="Sequence of an upload from file selection to summary" />
      <ol>
        <li>
          The browser checks the extension and that the file isn&apos;t empty, then uploads with
          XMLHttpRequest so the user sees real upload progress. There is no client-side size limit.
        </li>
        <li>
          <code>POST /uploads</code> validates type, language and size, creates an{" "}
          <code>uploads</code> row, streams the file to object storage, enqueues a job and returns{" "}
          <code>202</code> with the id. No transcription happens inside this request.
        </li>
        <li>
          The browser opens the upload&apos;s page and polls <code>GET /uploads/&#123;id&#125;</code>{" "}
          every two seconds until the status is final.
        </li>
        <li>
          The worker writes progress to Postgres after every chunk, which is what the poll reads.
        </li>
        <li>
          The home page lists past uploads (searchable and filterable) and each one reopens with its
          stored transcript and summary.
        </li>
      </ol>

      <h2>Upload lifecycle</h2>
      <Mermaid chart={STATES} label="State machine of an upload" />
      <p>
        Status changes use guarded updates (<code>UPDATE … WHERE status = …</code>). That is what
        lets exactly one worker claim a job, and what stops a cancelled job from being overwritten
        by a worker that was already running.
      </p>

      <h2>Where files and data live</h2>
      <ul>
        <li>
          <strong>Original audio:</strong> S3-compatible object storage, key{" "}
          <code>uploads/&lt;id&gt;/original.&lt;ext&gt;</code>, accessed only through a small{" "}
          <code>storage.py</code>. Local development uses a self-hosted S3-compatible server; a
          deployment uses a managed bucket (Cloudflare R2, S3, …) with only environment changes.
        </li>
        <li>
          <strong>Chunks:</strong> temporary files in the worker, deleted when the job ends. Only
          their transcripts are persisted.
        </li>
        <li>
          <strong>Metadata, transcript, summary, per-chunk state:</strong> Postgres. The summary is
          stored as JSON text, so its shape can evolve without a migration.
        </li>
        <li>
          <strong>Job queue:</strong> Redis (RQ).
        </li>
      </ul>
      <Mermaid chart={DATA} label="Data model" />

      <h2>Handling long audio</h2>
      <p>
        Gnani&apos;s REST endpoint accepts a short clip per request (30 seconds recommended, 60 at
        most). The worker decodes the file with ffmpeg to mono 16 kHz WAV and cuts it into 30-second
        chunks, so a 2-minute file becomes 4 or 5 chunks and a 2-hour file about 240. Up to{" "}
        <code>TRANSCRIBE_CONCURRENCY</code> chunks (default 3) are sent in parallel and the results
        are joined in chunk order. Memory use doesn&apos;t grow with file length: the upload streams
        to storage and the worker keeps only a few chunks in flight.
      </p>
      <p>
        Progress is reported as a percentage: 5% once the audio is prepared, up to 90% across the
        chunks, 95% while summarizing and 100% when done. The UI also shows parts done, elapsed time
        and an estimated time remaining based on the chunk throughput actually observed.
      </p>

      <h2>Languages</h2>
      <p>
        The language selector offers the Gnani STT languages: English (India), Hindi, Bengali,
        Gujarati, Kannada, Malayalam, Marathi, Punjabi, Tamil, Telugu, Assamese and Odia. The server
        rejects any other code. The summary step also checks the transcript, so audio in a language
        that wasn&apos;t selected, or isn&apos;t supported, produces a clear message instead of a
        misleading summary.
      </p>

      <h2>Summaries and when there isn&apos;t one</h2>
      <Mermaid chart={SUMMARY} label="How the summary stage decides between a summary and an explanation" />
      <p>
        A successful summary has a title, overview, key points, decisions, action items and topic
        tags, and the model is told not to invent anything that isn&apos;t in the transcript. Cheap
        checks run first (no speech, too short) so no LLM call is wasted. If the LLM itself fails, the
        upload still completes with the transcript, and <em>Regenerate</em> re-runs only the summary
        without redoing transcription.
      </p>

      <h2>Synchronous vs background</h2>
      <table>
        <thead>
          <tr>
            <th>Synchronous (API request)</th>
            <th>Background (RQ worker)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Validate extension / language / non-empty, stream to storage, create the row, enqueue,
              return 202. Reads, cancel, delete, retry.
            </td>
            <td>
              Download, ffprobe validation, splitting, per-chunk ASR with retries, joining, LLM
              summary, all status and progress updates. Jobs have a 2-hour timeout.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Keeping transcription out of the request avoids HTTP timeouts and keeps the API responsive
        while audio is processed.
      </p>

      <h2>API</h2>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>POST /uploads</code></td><td>Upload a file with a language; returns 202 and an id</td></tr>
          <tr><td><code>GET /uploads</code>, <code>GET /uploads/&#123;id&#125;</code></td><td>List, or fetch status, percent, transcript and summary</td></tr>
          <tr><td><code>POST /uploads/&#123;id&#125;/cancel</code></td><td>Stop a queued or running job (worker stops at the next checkpoint)</td></tr>
          <tr><td><code>DELETE /uploads/&#123;id&#125;</code></td><td>Remove the row, chunks and stored audio (running jobs must be cancelled first)</td></tr>
          <tr><td><code>POST /uploads/&#123;id&#125;/retry</code></td><td>Resume a failed, cancelled or stalled upload; finished chunks are skipped</td></tr>
          <tr><td><code>POST /uploads/&#123;id&#125;/resummarize</code></td><td>Regenerate only the summary from the stored transcript</td></tr>
        </tbody>
      </table>

      <h2>Failure handling</h2>
      <table>
        <thead>
          <tr>
            <th>Situation</th>
            <th>What happens</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Wrong type, empty or corrupt file</td><td>Rejected up front, or ffprobe/ffmpeg fails in the worker and the upload becomes <code>failed</code> with a readable message.</td></tr>
          <tr><td>ASR 429 / 500 / 503 / network</td><td>Retried with exponential backoff (1 s, 2 s, 4 s).</td></tr>
          <tr><td>ASR 400 / 403</td><td>Not retried (bad input or key); fails immediately with a clear message.</td></tr>
          <tr><td>A chunk fails</td><td>Its row is marked <code>failed</code>, the upload fails, and retry resumes from that chunk.</td></tr>
          <tr><td>Summary too short, vague, wrong language, unclear</td><td>Upload completes; the UI explains why there is no summary and keeps the transcript.</td></tr>
          <tr><td>LLM service error</td><td>Upload completes with the transcript; the summary can be regenerated.</td></tr>
          <tr><td>User cancels or deletes</td><td>Guarded status updates make the worker stop at its next checkpoint without overwriting the result.</td></tr>
          <tr><td>Dead worker / duplicate delivery</td><td>An atomic claim lets one worker run a job; a job idle for 15 minutes can be retried from the UI.</td></tr>
          <tr><td>Storage or queue failure</td><td>An error is returned (and logged with a traceback), or the row is marked failed so it never sits in <code>queued</code> unexplained.</td></tr>
          <tr><td>Browser offline</td><td>Polling continues through temporary errors and says so.</td></tr>
        </tbody>
      </table>

      <h2>Trade-offs and limitations</h2>
      <ul>
        <li>Fixed 30-second cuts can land mid-word, which may slightly hurt accuracy at chunk boundaries.</li>
        <li>
          Execution is at-least-once with an atomic claim, not exactly-once: a worker that crashes
          after receiving an ASR result but before saving it redoes that chunk on retry.
        </li>
        <li>Polling every 2 seconds is simple and robust, but less efficient than push updates.</li>
        <li>
          There is no authentication: anyone with the URL can see all uploads. Tables are created at
          startup rather than through migrations.
        </li>
        <li>A very long transcript is condensed in segments before the final summary, which can lose detail.</li>
        <li>
          A cancel is cooperative: an ASR call already in flight finishes first, so it can take a few
          seconds to take effect.
        </li>
        <li>
          The language check on the summary is an LLM judgement, so unusual code-mixed speech can
          occasionally be flagged incorrectly (Regenerate is available).
        </li>
      </ul>

      <h2>With more time</h2>
      <ul>
        <li>Per-user accounts and private uploads; signed URLs to play the original audio.</li>
        <li>Silence-aware chunking with a small overlap, to avoid cutting words.</li>
        <li>Gnani&apos;s batch API for very large files; adaptive concurrency from rate-limit headers.</li>
        <li>Server-sent events instead of polling; a worker heartbeat instead of the 15-minute rule.</li>
        <li>A transactional outbox (or sweeper) for lost enqueues; Alembic migrations; worker tests in CI.</li>
        <li>An expiry policy for stored audio; speaker labels and timestamps in the transcript.</li>
      </ul>

      <h2>Stack</h2>
      <p>
        Next.js · FastAPI · PostgreSQL · Redis + RQ · S3-compatible object storage · ffmpeg/ffprobe ·
        Gnani speech-to-text · Google Gemini (summary) · Mermaid (diagrams).
      </p>
    </article>
  );
}
