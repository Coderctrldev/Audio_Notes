import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audio Notes",
  description: "Upload audio, get a transcript and a structured summary.",
};

function Mark() {
  // Five bars: a minimal waveform
  return (
    <svg width="26" height="22" viewBox="0 0 26 22" fill="currentColor" aria-hidden="true">
      <rect x="1" y="8" width="3" height="6" rx="1.5" />
      <rect x="6.5" y="3" width="3" height="16" rx="1.5" />
      <rect x="12" y="0" width="3" height="22" rx="1.5" />
      <rect x="17.5" y="5" width="3" height="12" rx="1.5" />
      <rect x="23" y="9" width="3" height="4" rx="1.5" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <div className="wrap row spread">
            <Link href="/" className="brand">
              <Mark />
              Audio Notes
            </Link>
            <Nav />
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
