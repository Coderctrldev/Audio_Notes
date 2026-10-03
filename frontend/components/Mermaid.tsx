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
        const font = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: dark
            ? {
                fontFamily: font, primaryColor: "#1a2a42", primaryBorderColor: "#9db9e3",
                primaryTextColor: "#e8ebf0", lineColor: "#9aa5b6", secondaryColor: "#141b25",
                tertiaryColor: "#101720", noteBkgColor: "#2a2010", noteTextColor: "#e8ebf0",
                actorBkg: "#1a2a42", actorBorder: "#9db9e3", actorTextColor: "#e8ebf0",
                signalColor: "#9aa5b6", signalTextColor: "#e8ebf0", labelBoxBkgColor: "#141b25",
                edgeLabelBackground: "#101720", clusterBkg: "#141b25", clusterBorder: "#34435a",
              }
            : {
                fontFamily: font, primaryColor: "#e9eef6", primaryBorderColor: "#1e3557",
                primaryTextColor: "#161c27", lineColor: "#5d6778", secondaryColor: "#f8f9fb",
                tertiaryColor: "#ffffff", noteBkgColor: "#fbf5e8", noteTextColor: "#161c27",
                actorBkg: "#e9eef6", actorBorder: "#1e3557", actorTextColor: "#161c27",
                signalColor: "#5d6778", signalTextColor: "#161c27", labelBoxBkgColor: "#f8f9fb",
                edgeLabelBackground: "#f8f9fb", clusterBkg: "#f8f9fb", clusterBorder: "#cdd2dc",
              },
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
