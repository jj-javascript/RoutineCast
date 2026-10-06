import type { RoutinesDoc } from "@routinecast/shared";

/** The CMS talks to the same-origin API with the bearer token the user
 *  pasted at login (stored in sessionStorage — never persisted to disk). */
export function getToken(): string | null {
  return sessionStorage.getItem("routinecast_token");
}
export function setToken(token: string): void {
  sessionStorage.setItem("routinecast_token", token);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface StateResponse {
  doc: RoutinesDoc;
  freshness: Record<string, "fresh" | "stale" | "skip">;
  feedUrl: string;
}

export const api = {
  state: () => request<StateResponse>("/api/state"),
  createSegment: (body: unknown) =>
    request<{ segment: unknown }>("/api/segments", { method: "POST", body: JSON.stringify(body) }),
  updateSegment: (id: string, body: unknown) =>
    request<{ enqueued: boolean }>(`/api/segments/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteSegment: (id: string) => request<void>(`/api/segments/${id}`, { method: "DELETE" }),
  reorder: (orderedIds: string[]) =>
    request<void>("/api/routine", { method: "PUT", body: JSON.stringify({ orderedIds }) }),
  importLooptube: (loops: unknown[]) =>
    request<{ created: number }>("/api/import/looptube", {
      method: "POST",
      body: JSON.stringify({ loops }),
    }),
  upload: (form: FormData) =>
    request<{ segmentId: string; durationMs: number }>("/api/upload", {
      method: "POST",
      body: form,
    }),
  build: () => request<{ ok: boolean; error?: string }>("/api/build", { method: "POST" }),
};
