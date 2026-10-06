/** Agent configuration from env (set in the launchd plist or shell env). */
export interface AgentConfig {
  /** Base URL of the cloud app, e.g. https://routinecast.onrender.com */
  apiBaseUrl: string;
  apiToken: string;
  ytDlpBin: string;
  ffmpegBin: string;
  /** Opt-in ONLY if YouTube shows the bot wall (D19). e.g. "safari" */
  cookiesFromBrowser?: string;
}

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`missing required env var: ${name}`);
    return v;
  };
  return {
    apiBaseUrl: required("ROUTINECAST_API_URL").replace(/\/$/, ""),
    apiToken: required("ROUTINECAST_API_TOKEN"),
    ytDlpBin: env.YT_DLP_BIN ?? "yt-dlp",
    ffmpegBin: env.FFMPEG_BIN ?? "ffmpeg",
    ...(env.YT_DLP_COOKIES_FROM_BROWSER
      ? { cookiesFromBrowser: env.YT_DLP_COOKIES_FROM_BROWSER }
      : {}),
  };
}
