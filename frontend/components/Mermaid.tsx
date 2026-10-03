"use client";

import { useEffect, useId, useState } from "react";

// Renders a Mermaid diagram in the browser (mermaid is loaded lazily so it never bloats other pages).
export default function Mermaid({ chart, label }: { chart: string; label: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const render = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          flowchart: { curve: "basis", htmlLabels: true },
        });
        const { svg } = await mermaid.render(`m${uid}${dark ? "d" : "l"}`, chart);
        if (alive) {
          setSvg(svg);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    render();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", render);
    return () => {
      alive = false;
      mq.removeEventListener("change", render);
    };
  }, [chart, uid]);

  if (error) {
    // Fallback so the content is never lost if the diagram fails to render.
    return <pre className="mermaid-box">{chart}</pre>;
  }
  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <div className="mermaid-box" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
      {!svg && <p className="muted">Loading diagram…</p>}
    </figure>
  );
}
