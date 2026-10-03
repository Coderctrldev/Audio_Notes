import UploadForm from "@/components/UploadForm";
import History from "@/components/History";

export default function Home() {
  return (
    <div className="stack">
      <div className="intro">
        <h1>Transcribe and summarize recordings</h1>
        <p>
          Upload an audio file in one of twelve Indian languages. You get the full transcript and a
          structured summary with key points, decisions and action items.
        </p>
      </div>
      <UploadForm />
      <History />
    </div>
  );
}
