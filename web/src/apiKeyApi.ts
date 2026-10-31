import { getSession, type Session } from "./authApi";
import { SessionChanged } from "./jiraApi";

export type ApiKey = { id: string; name: string; prefix: string; siteId: string; projects: string[]; createdAt: string; revokedAt: string | null; requiresReplacement: boolean };
export class ApiKeyRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super("API key request failed"); }
}

async function verifySession(expected: Session) {
  const actual = await getSession();
  if (!actual || actual.user.id !== expected.user.id || actual.csrfToken !== expected.csrfToken) throw new SessionChanged();
}

export async function keyRequest<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  await verifySession(session);
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: { ...init.headers, ...(init.body ? { "Content-Type": "application/json" } : {}), "x-csrf-token": session.csrfToken },
  });
  await verifySession(session);
  if (!response.ok) {
    const body: { error?: unknown } = await response.json().catch(() => ({}));
    throw new ApiKeyRequestError(response.status, typeof body.error === "string" ? body.error : "");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
