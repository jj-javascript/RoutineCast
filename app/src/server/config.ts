/**
 * Environment configuration. All secrets come from env vars — never hardcoded.
 * Two R2 buckets (D6/D15): public feed bucket (r2.dev enabled) and private
 * state bucket (API-credential access only).
 */
export interface AppConfig {
  port: number;
  /** Static bearer token authenticating the Mac agent and the CMS. */
  apiToken: string;
  r2: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** Private: routines.json, segment assets, upload originals, snapshots. */
    stateBucket: string;
    /** Public: RSS + build mp3s at tokened paths, served via r2.dev. */
    feedBucket: string;
    /** e.g. https://pub-xxxxxxxx.r2.dev */
    feedPublicBaseUrl: string;
  };
  ntfyTopic?: string;
  healthchecksPingUrl?: string;
  feedTitle: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`missing required env var: ${name}`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 3000),
    apiToken: required("API_TOKEN"),
    r2: {
      accountId: required("R2_ACCOUNT_ID"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      stateBucket: required("R2_STATE_BUCKET"),
      feedBucket: required("R2_FEED_BUCKET"),
      feedPublicBaseUrl: required("R2_FEED_PUBLIC_BASE_URL"),
    },
    ...(env.NTFY_TOPIC ? { ntfyTopic: env.NTFY_TOPIC } : {}),
    ...(env.HEALTHCHECKS_PING_URL ? { healthchecksPingUrl: env.HEALTHCHECKS_PING_URL } : {}),
    feedTitle: env.FEED_TITLE ?? "Daily Routine",
  };
}
