import { useState } from "react";
import type { Segment } from "@routinecast/shared";
import { api } from "../api";

/** Create/edit a segment. Editing source or refresh policy enqueues a fetch
 *  job immediately — the agent picks it up on its next poll. */
export function SegmentEditor(props: {
  segment: Segment | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const seg = props.segment;
  const [title, setTitle] = useState(seg?.title ?? "");
  const [videoId, setVideoId] = useState(
    seg?.source.kind === "youtube" ? (seg.source.videoId ?? "") : "",
  );
  const [startSec, setStartSec] = useState(seg?.source.startSec?.toString() ?? "");
  const [endSec, setEndSec] = useState(seg?.source.endSec?.toString() ?? "");
  const [refresh, setRefresh] = useState<"static" | "daily">(seg?.refresh ?? "static");
  const [selectorKind, setSelectorKind] = useState<"playlistId" | "channelId" | "query">(
    seg?.dailySelector?.playlistId
      ? "playlistId"
      : seg?.dailySelector?.channelId
        ? "channelId"
        : "query",
  );
  const [selectorValue, setSelectorValue] = useState(
    seg?.dailySelector?.playlistId ?? seg?.dailySelector?.channelId ?? seg?.dailySelector?.query ?? "",
  );
  const [strategy, setStrategy] = useState<"latest" | "random-unplayed">(
    seg?.dailySelector?.strategy ?? "latest",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const cut = {
        ...(startSec ? { startSec: Number(startSec) } : {}),
        ...(endSec ? { endSec: Number(endSec) } : {}),
      };
      const payload = {
        title,
        refresh,
        source:
          seg?.source.kind === "upload"
            ? { ...seg.source, ...cut }
            : { kind: "youtube" as const, ...(videoId ? { videoId } : {}), ...cut },
        ...(refresh === "daily"
          ? { dailySelector: { [selectorKind]: selectorValue, strategy } }
          : {}),
      };
      if (seg) {
        await api.updateSegment(seg.id, payload);
      } else {
        await api.createSegment(payload);
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>{seg ? "Edit segment" : "New segment"}</h2>
      <label>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wipe counters" />

      {seg?.source.kind === "upload" ? (
        <p className="muted">
          Uploaded audio (original kept in storage). To change the audio itself, delete this
          segment and upload a new file below.
        </p>
      ) : (
        <>
          <label>YouTube video ID {refresh === "daily" ? "(optional — selector resolves daily)" : ""}</label>
          <input
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            placeholder="dQw4w9WgXcQ"
          />
        </>
      )}

      <div className="row">
        <div>
          <label>Start (sec, optional)</label>
          <input value={startSec} onChange={(e) => setStartSec(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label>End (sec, optional)</label>
          <input value={endSec} onChange={(e) => setEndSec(e.target.value)} inputMode="numeric" />
        </div>
      </div>

      <label>Refresh</label>
      <select value={refresh} onChange={(e) => setRefresh(e.target.value as "static" | "daily")}>
        <option value="static">Static — fetch once, reuse</option>
        <option value="daily">Daily — fresh pick every day</option>
      </select>

      {refresh === "daily" && (
        <>
          <label>Daily source</label>
          <div className="row">
            <select
              value={selectorKind}
              onChange={(e) => setSelectorKind(e.target.value as typeof selectorKind)}
            >
              <option value="playlistId">Playlist</option>
              <option value="channelId">Channel</option>
              <option value="query">Search query</option>
            </select>
            <input
              value={selectorValue}
              onChange={(e) => setSelectorValue(e.target.value)}
              placeholder={
                selectorKind === "query" ? "lofi instrumental" : "PL… / UC…"
              }
            />
          </div>
          <label>Pick strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as typeof strategy)}
          >
            <option value="latest">Latest upload</option>
            <option value="random-unplayed">Random (no repeats until pool exhausts)</option>
          </select>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button onClick={() => void save()} disabled={saving || !title}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="secondary" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
