import UploadView from "@/components/UploadView";

export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UploadView id={id} />;
}
