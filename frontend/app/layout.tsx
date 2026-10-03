import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audio Notes",
  description: "Upload audio, get a transcript and a summary.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <div className="wrap row spread">
            <Link href="/" className="brand">
              Audio Notes
            </Link>
            <nav className="row">
              <Link href="/">Uploads</Link>
              <Link href="/architecture">Architecture</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
