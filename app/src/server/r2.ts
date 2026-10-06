import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import type { AppConfig } from "./config.js";

/**
 * Thin R2 adapter (S3-compatible). Tests fake this interface, not the logic.
 * Two buckets: state (private) and feed (public via r2.dev).
 */
export interface ObjectStore {
  getJson(key: string): Promise<{ body: unknown; etag: string } | null>;
  putJson(key: string, body: unknown, ifMatchEtag?: string): Promise<{ etag: string }>;
  getObject(key: string): Promise<{ bytes: Uint8Array; etag: string } | null>;
  putObject(key: string, bytes: Uint8Array | Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
}

export class R2Store implements ObjectStore {
  private client: S3Client;

  constructor(
    config: AppConfig["r2"],
    private bucket: string,
  ) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async getJson(key: string): Promise<{ body: unknown; etag: string } | null> {
    const res = await this.getObject(key);
    if (!res) return null;
    return { body: JSON.parse(Buffer.from(res.bytes).toString("utf-8")), etag: res.etag };
  }

  async putJson(key: string, body: unknown, ifMatchEtag?: string): Promise<{ etag: string }> {
    // S3 PutObject supports If-Match on R2 for conditional writes.
    const res = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(body, null, 2),
        ContentType: "application/json",
        ...(ifMatchEtag ? { IfMatch: ifMatchEtag } : {}),
      }),
    );
    return { etag: res.ETag ?? "" };
  }

  async getObject(key: string): Promise<{ bytes: Uint8Array; etag: string } | null> {
    let res: GetObjectCommandOutput;
    try {
      res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
    const bytes = await res.Body!.transformToByteArray();
    return { bytes, etag: res.ETag ?? "" };
  }

  async putObject(key: string, bytes: Uint8Array | Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}
