import { useRef, useState } from "react";
import { api } from "../api";

/** Upload a purchased/recorded audio file. The server normalizes it with the
 *  same spec as YouTube fetches and keeps the original for re-processing. */
export function UploadForm(props: { onUploaded: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !title) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("title", title);
      const res = await api.upload(form);
      setMsg(`Uploaded — ${(res.durationMs / 1000).toFixed(1)}s normalized.`);
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      await props.onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <label>Audio file (mp3, m4a, wav…)</label>
      <input ref={fileRef} type="file" accept="audio/*" />
      <label>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Stretching timer" />
      <div className="actions">
        <button onClick={() => void submit()} disabled={busy || !title}>
          {busy ? "Normalizing…" : "Upload"}
        </button>
      </div>
      {msg && <p className="ok">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
