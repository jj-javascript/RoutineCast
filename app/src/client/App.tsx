import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken, type StateResponse } from "./api";
import { SegmentList } from "./components/SegmentList";
import { SegmentEditor } from "./components/SegmentEditor";
import { LooptubeImport } from "./components/LooptubeImport";
import { UploadForm } from "./components/UploadForm";
import { StatusPanel } from "./components/StatusPanel";
import { BuildHistory } from "./components/BuildHistory";
import type { Segment } from "@routinecast/shared";

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Segment | "new" | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildMsg, setBuildMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (authed) void refresh();
  }, [authed, refresh]);

  if (!authed) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = new FormData(e.currentTarget).get("token");
          if (typeof input === "string" && input) {
            setToken(input);
            setAuthed(true);
          }
        }}
      >
        <h1>RoutineCast</h1>
        <p className="muted">Paste your API token to manage the routine.</p>
        <label htmlFor="token">API token</label>
        <input id="token" name="token" type="password" autoFocus />
        <div className="actions">
          <button type="submit">Sign in</button>
        </div>
      </form>
    );
  }

  if (!state) {
    return (
      <div>
        <h1>RoutineCast</h1>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const { doc, freshness, feedUrl } = state;

  const onBuild = async () => {
    setBuilding(true);
    setBuildMsg(null);
    try {
      const outcome = await api.build();
      setBuildMsg(outcome.ok ? "Build complete — new episode published." : `Build failed: ${outcome.error}`);
      await refresh();
    } catch (err) {
      setBuildMsg(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div>
      <h1>RoutineCast</h1>
      <p className="muted">One continuous mp3, every morning. {doc.routine.length} segments.</p>

      <StatusPanel doc={doc} />
      {error && <p className="error">{error}</p>}

      <h2>Routine order</h2>
      <SegmentList
        doc={doc}
        freshness={freshness}
        onEdit={(seg) => setEditing(seg)}
        onChanged={refresh}
      />
      <div className="actions">
        <button onClick={() => setEditing("new")}>Add segment</button>
        <button className="secondary" onClick={onBuild} disabled={building}>
          {building ? "Building… (this holds the connection)" : "Rebuild now"}
        </button>
      </div>
      {buildMsg && <p className={buildMsg.startsWith("Build failed") ? "error" : "ok"}>{buildMsg}</p>}

      {editing && (
        <SegmentEditor
          segment={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}

      <h2>Add from uploads</h2>
      <UploadForm onUploaded={refresh} />

      <h2>Import from Looptube</h2>
      <LooptubeImport onImported={refresh} />

      <h2>Podcast feed</h2>
      <div className="card">
        <p className="muted">Subscribe in your phone's podcast app (auto-download on):</p>
        <div className="feed-url">{feedUrl}</div>
      </div>

      <BuildHistory doc={doc} />
    </div>
  );
}
