import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DailySelector } from "@routinecast/shared";

const run = promisify(execFile);

/** Thin yt-dlp adapter. Tests fake this boundary, not the logic. */
export interface YtDlp {
  /** Resolve a selector to candidate videoIds (newest first). */
  resolveSelector(selector: DailySelector, limit: number): Promise<string[]>;
  /** Download audio for a videoId to outputPath (any format ffmpeg reads). */
  fetchAudio(videoId: string, outputPath: string): Promise<void>;
}

export class RealYtDlp implements YtDlp {
  constructor(
    private bin = "yt-dlp",
    private cookiesFromBrowser?: string,
  ) {}

  private authArgs(): string[] {
    // D19: cookies-from-browser is a deliberate opt-in for the bot wall,
    // never a silent default (account-ban exposure).
    return this.cookiesFromBrowser ? ["--cookies-from-browser", this.cookiesFromBrowser] : [];
  }

  async resolveSelector(selector: DailySelector, limit: number): Promise<string[]> {
    let target: string;
    if (selector.playlistId) {
      target = `https://www.youtube.com/playlist?list=${selector.playlistId}`;
    } else if (selector.channelId) {
      target = `https://www.youtube.com/channel/${selector.channelId}/videos`;
    } else if (selector.query) {
      target = `ytsearch${limit}:${selector.query}`;
    } else {
      throw new Error("selector has no playlistId, channelId, or query");
    }
    const res = await run(this.bin, [
      ...this.authArgs(),
      "--flat-playlist",
      "--print",
      "id",
      "--playlist-end",
      String(limit),
      target,
    ]);
    return res.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async fetchAudio(videoId: string, outputPath: string): Promise<void> {
    await run(this.bin, [
      ...this.authArgs(),
      "-f",
      "bestaudio/best",
      "--no-playlist",
      "-o",
      outputPath,
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
  }
}
