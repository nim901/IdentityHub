import { getSession, type Session } from "./authApi";

export type JiraSite = { id: string; name: string; url: string };
export type JiraProject = { id: string; key: string; name: string };
export type JiraStatus = {
  configured: boolean;
  connected: boolean;
  site: JiraSite | null;
};

export class SessionChanged extends Error {}

async function verifySession(session: Session) {
  const current = await getSession();
  if (
    !current ||
    current.user.id !== session.user.id ||
    current.csrfToken !== session.csrfToken
  )
    throw new SessionChanged();
}

export async function jiraRequest<T>(
  session: Session,
  path: string,
  init?: RequestInit,
): Promise<T> {
  await verifySession(session);
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      ...init?.headers,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-csrf-token": session.csrfToken,
    },
  });
  await verifySession(session);
  if (response.status === 401) throw new SessionChanged();
  if (!response.ok) {
    if (response.status === 403)
      throw new Error(
        "Access was denied. Check your Jira permissions or reconnect.",
      );
    if (response.status === 503)
      throw new Error("Jira is not configured or is temporarily unavailable.");
    throw new Error(
      "Could not complete the Jira request. Try again or reconnect.",
    );
  }
  return response.json() as Promise<T>;
}
