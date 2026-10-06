import { parseRoutinesDoc, emptyDoc, type RoutinesDoc } from "@routinecast/shared";
import type { ObjectStore } from "./r2.js";

const ROUTINES_KEY = "routines.json";
const MAX_RMW_RETRIES = 5;

/**
 * Data layer (D10): `updateRoutines()` is the ONLY way to write
 * routines.json — an If-Match (ETag) read-modify-write loop with retry.
 * The build pipeline, the agent endpoints, and the CMS all mutate this
 * document; last-write-wins without conditional writes would clobber state.
 */
export class RoutinesStore {
  constructor(private state: ObjectStore) {}

  async read(): Promise<RoutinesDoc> {
    const res = await this.state.getJson(ROUTINES_KEY);
    if (!res) {
      // First run: initialize with a fresh unguessable feed token.
      return emptyDoc(crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""));
    }
    return parseRoutinesDoc(res.body);
  }

  /**
   * mutateFn must be pure-ish: it receives the current doc and returns the
   * next doc. It may be called multiple times on retry — no side effects.
   */
  async updateRoutines(mutateFn: (doc: RoutinesDoc) => RoutinesDoc): Promise<RoutinesDoc> {
    for (let attempt = 0; attempt < MAX_RMW_RETRIES; attempt++) {
      const current = await this.state.getJson(ROUTINES_KEY);
      const doc = current ? parseRoutinesDoc(current.body) : null;
      const next = mutateFn(
        doc ?? emptyDoc(crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "")),
      );
      try {
        if (current) {
          await this.state.putJson(ROUTINES_KEY, next, current.etag);
        } else {
          // Create-if-absent: If-None-Match * semantics via a sentinel —
          // R2 supports If-Match only, so accept the tiny first-write race
          // (single-operator personal app; both writers would create
          // equivalent empty docs and the loser's next RMW retries).
          await this.state.putJson(ROUTINES_KEY, next);
        }
        return next;
      } catch (err) {
        if (isPreconditionFailed(err)) continue; // concurrent writer — retry
        throw err;
      }
    }
    throw new Error(`updateRoutines: exceeded ${MAX_RMW_RETRIES} retries (concurrent writers)`);
  }

  /** Daily state snapshot (D17): copy routines.json to a dated backup key. */
  async snapshot(now: Date): Promise<string> {
    const doc = await this.read();
    const key = `snapshots/${now.toISOString().replaceAll(":", "-")}.json`;
    await this.state.putJson(key, doc);
    return key;
  }
}

function isPreconditionFailed(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "PreconditionFailed" || e.$metadata?.httpStatusCode === 412;
}
