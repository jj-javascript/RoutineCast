import { useState } from "react";
import { api } from "../api";

/**
 * One-time Looptube import. Looptube stores loops in browser localStorage as
 * {videoId, start, end} triples — the CMS owns them after import. Paste the
 * localStorage JSON here.
 *
 * Accepted shapes (best-effort):
 *   [{"videoId": "...", "start": 12, "end": 240, "title": "..."}, ...]
 *   {"loops": [...same...]}
 *   {"<id>": {"videoId": ...}, ...}  (record form)
 */
export function LooptubeImport(props: { onImported: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doImport = async () => {
    setError(null);
    setMsg(null);
    try {
      const loops = parseLooptubeJson(text);
      if (loops.length === 0) throw new Error("no loops found in that JSON");
      const res = await api.importLooptube(loops);
      setMsg(`Imported ${res.created} segment${res.created === 1 ? "" : "s"}. Fetch jobs queued.`);
      setText("");
      await props.onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="card">
      <p className="muted">
        In Looptube's browser tab, open devtools and run{" "}
        <code>JSON.stringify(localStorage)</code>, then paste the result here. Loops become static
        YouTube segments (fetch jobs are queued immediately).
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"loops":[{"videoId":"abc123","start":10,"end":250}]}'
      />
      <div className="actions">
        <button onClick={() => void doImport()} disabled={!text.trim()}>
          Import
        </button>
      </div>
      {msg && <p className="ok">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

interface ParsedLoop {
  videoId: string;
  title?: string;
  startSec?: number;
  endSec?: number;
}

export function parseLooptubeJson(text: string): ParsedLoop[] {
  const raw: unknown = JSON.parse(text);
  let entries: unknown[] = [];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.loops)) {
      entries = obj.loops;
    } else {
      // localStorage dump: values may be JSON strings.
      entries = Object.values(obj).map((v) => {
        if (typeof v === "string") {
          try {
            return JSON.parse(v) as unknown;
          } catch {
            return v;
          }
        }
        return v;
      });
    }
  }
  const loops: ParsedLoop[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const videoId = e.videoId ?? e.video ?? e.id;
    if (typeof videoId !== "string" || !videoId) continue;
    const loop: ParsedLoop = { videoId };
    if (typeof e.title === "string") loop.title = e.title;
    if (typeof e.name === "string") loop.title ??= e.name;
    const start = e.start ?? e.startSec;
    const end = e.end ?? e.endSec;
    if (typeof start === "number") loop.startSec = start;
    if (typeof end === "number") loop.endSec = end;
    loops.push(loop);
  }
  return loops;
}
