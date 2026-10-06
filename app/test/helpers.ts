import type { ObjectStore } from "../src/server/r2.js";

/**
 * In-memory ObjectStore fake with ETag semantics. `failNextPutIfMatch`
 * simulates a concurrent-writer conflict (412 Precondition Failed) to
 * exercise the updateRoutines retry loop.
 */
export class InMemoryStore implements ObjectStore {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  private etagCounter = 0;
  private etags = new Map<string, string>();
  /** When armed, the next conditional putJson fails once per key. */
  conflictOnNextPut = false;

  private bumpEtag(key: string): string {
    const etag = `"e${++this.etagCounter}"`;
    this.etags.set(key, etag);
    return etag;
  }

  async getJson(key: string): Promise<{ body: unknown; etag: string } | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      body: JSON.parse(Buffer.from(obj.bytes).toString("utf-8")),
      etag: this.etags.get(key) ?? "",
    };
  }

  async putJson(key: string, body: unknown, ifMatchEtag?: string): Promise<{ etag: string }> {
    if (ifMatchEtag !== undefined) {
      const currentEtag = this.etags.get(key);
      if (this.conflictOnNextPut || currentEtag !== ifMatchEtag) {
        this.conflictOnNextPut = false;
        const err = new Error("PreconditionFailed") as Error & { name: string };
        err.name = "PreconditionFailed";
        throw err;
      }
    }
    this.objects.set(key, {
      bytes: Buffer.from(JSON.stringify(body)),
      contentType: "application/json",
    });
    const etag = this.bumpEtag(key);
    return { etag };
  }

  async getObject(key: string): Promise<{ bytes: Uint8Array; etag: string } | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return { bytes: obj.bytes, etag: this.etags.get(key) ?? "" };
  }

  async putObject(key: string, bytes: Uint8Array | Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
    this.bumpEtag(key);
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    this.etags.delete(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

export const testConfig = {
  port: 0,
  apiToken: "test-token",
  r2: {
    accountId: "test",
    accessKeyId: "test",
    secretAccessKey: "test",
    stateBucket: "state",
    feedBucket: "feed",
    feedPublicBaseUrl: "https://pub-test.r2.dev",
  },
  feedTitle: "Test Routine",
};
