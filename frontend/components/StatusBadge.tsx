import type { Status } from "@/lib/api";

const LABELS: Record<Status, string> = {
  queued: "Queued",
  processing: "Preparing",
  transcribing: "Transcribing",
  summarizing: "Summarizing",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{LABELS[status]}</span>;
}
