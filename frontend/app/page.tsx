import UploadForm from "@/components/UploadForm";
import History from "@/components/History";

export default function Home() {
  return (
    <div className="stack">
      <UploadForm />
      <History />
    </div>
  );
}
