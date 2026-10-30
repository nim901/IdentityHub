export type Session = {
  user: { id: string; email: string };
  csrfToken: string;
};
export type AuthAction = "login" | "register";

const connectionError =
  "Unable to reach the server. Check that it is running and try again.";

export async function getSession(signal?: AbortSignal): Promise<Session | null> {
  const timeout = AbortSignal.timeout(10_000);
  let response: Response;
  try {
    response = await fetch("/api/auth/session", {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Unable to load your session. Please try again.");
  }
  if (response.status === 401) return null;
  if (!response.ok)
    throw new Error("Unable to load your session. Please try again.");
  return response.json();
}

export async function authenticate(
  action: AuthAction,
  email: string,
  password: string,
): Promise<Session | null> {
  const response = await fetch(`/api/auth/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 429)
    throw new Error("Too many attempts. Please wait and try again.");
  if (response.status >= 500)
    throw new Error(
      "The server could not complete your request. Please try again.",
    );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error ?? "Unable to complete your request. Please try again.",
    );
  return action === "register" ? null : result;
}

export async function signOut(csrfToken: string) {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
  });
  if (response.status !== 401 && !response.ok)
    throw new Error("Unable to sign out. Please try again.");
}

export function errorMessage(error: unknown) {
  return error instanceof TypeError
    ? connectionError
    : error instanceof Error
      ? error.message
      : connectionError;
}
