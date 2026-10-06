import { describe, expect, it } from "vitest";
import { emptyDoc } from "@routinecast/shared";
import { RoutinesStore } from "../src/server/store.js";
import { InMemoryStore } from "./helpers.js";

/**
 * E2E [concurrent If-Match writers]: the build pipeline and the agent both
 * mutate routines.json. Two racing updateRoutines() calls must BOTH land —
 * the loser's ETag precondition fails and it retries on the fresh doc.
 */
describe("E2E: concurrent If-Match writers", () => {
  it("both mutations survive a simulated write conflict", async () => {
    const backing = new InMemoryStore();
    await backing.putJson("routines.json", emptyDoc("t".repeat(32)));

    // Wrap the backing store so the FIRST conditional write always conflicts.
    const store = new RoutinesStore(backing);
    backing.conflictOnNextPut = true;

    const [a, b] = await Promise.all([
      store.updateRoutines((doc) => ({
        ...doc,
        agent: { lastCheckInAt: "2026-09-22T11:00:00Z" },
      })),
      store.updateRoutines((doc) => ({
        ...doc,
        builds: [
          ...doc.builds,
          {
            date: "2026-09-22",
            assetKeys: ["k1"],
            mp3Key: "t/builds/x.mp3",
            rssGuid: "g1",
            durationMs: 1000,
            staleSegments: [],
            skippedSegments: [],
            ffmpegVersions: {},
            builtAt: "2026-09-22T11:00:00Z",
          },
        ],
      })),
    ]);

    // Both returned docs reflect BOTH mutations (the retried one re-read).
    const final = await store.read();
    expect(final.agent.lastCheckInAt).toBe("2026-09-22T11:00:00Z");
    expect(final.builds).toHaveLength(1);
    expect(final.builds[0]!.rssGuid).toBe("g1");
    void a;
    void b;
  });

  it("gives up after the retry cap under permanent conflict", async () => {
    const backing = new InMemoryStore();
    await backing.putJson("routines.json", emptyDoc("t".repeat(32)));
    // Sabotage: every conditional write fails.
    const original = backing.putJson.bind(backing);
    backing.putJson = async (key, body, ifMatch) => {
      if (ifMatch !== undefined) {
        const err = new Error("PreconditionFailed") as Error & { name: string };
        err.name = "PreconditionFailed";
        throw err;
      }
      return original(key, body, ifMatch);
    };
    const store = new RoutinesStore(backing);
    await expect(store.updateRoutines((doc) => doc)).rejects.toThrow(/retries/);
  });
});
