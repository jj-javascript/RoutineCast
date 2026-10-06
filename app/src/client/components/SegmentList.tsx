import { useState } from "react";
import type { RoutinesDoc, Segment } from "@routinecast/shared";
import { api } from "../api";

/** Drag-to-reorder segment list. Reorder writes only the ordered id array —
 *  cached audio is never invalidated by reordering. */
export function SegmentList(props: {
  doc: RoutinesDoc;
  freshness: Record<string, string>;
  onEdit: (seg: Segment) => void;
  onChanged: () => Promise<void>;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { doc } = props;

  const ordered = doc.routine
    .map((id) => doc.segments[id])
    .filter((s): s is Segment => s !== undefined);

  const move = async (fromId: string, toId: string) => {
    const ids = ordered.map((s) => s.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from === -1 || to === -1 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    try {
      await api.reorder(ids);
      await props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async (id: string) => {
    try {
      await api.deleteSegment(id);
      await props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (ordered.length === 0) {
    return <p className="muted">No segments yet. Add one below or import from Looptube.</p>;
  }

  return (
    <div>
      {ordered.map((seg, i) => {
        const fresh = props.freshness[seg.id] ?? "skip";
        const failedJob = doc.jobs.find((j) => j.segmentId === seg.id && j.status === "failed");
        return (
          <div
            key={seg.id}
            className={`segment-row${dragId === seg.id ? " dragging" : ""}`}
            draggable
            onDragStart={() => setDragId(seg.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId) void move(dragId, seg.id);
            }}
          >
            <span className="grip">⠿</span>
            <span className="muted">{i + 1}.</span>
            <span className="title">{seg.title}</span>
            {failedJob && <span className="badge skip" title={failedJob.lastError}>fetch failed</span>}
            <span className={`badge ${fresh}`}>{fresh === "skip" ? "no audio" : fresh}</span>
            <span className="badge">{seg.refresh}</span>
            <button className="secondary" onClick={() => props.onEdit(seg)}>
              Edit
            </button>
            <button className="danger" onClick={() => void onDelete(seg.id)}>
              ✕
            </button>
          </div>
        );
      })}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
