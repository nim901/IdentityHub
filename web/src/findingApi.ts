import { getSession, type Session } from "./authApi";
import { SessionChanged } from "./jiraApi";

export type Ticket = { issueKey: string; title: string; createdAt: string; url: string };
export class UnknownOutcome extends Error {}
export class RejectedFinding extends Error {}
export class CreatedNotRecorded extends Error {}

async function checkSession(session: Session) {
  const current = await getSession();
  if (!current || current.user.id !== session.user.id || current.csrfToken !== session.csrfToken)
    throw new SessionChanged();
}

export function safeTicketUrl(url: string, issueKey: string, siteUrl: string): string | null {
  try {
    const site = new URL(siteUrl);
    const target = new URL(url);
    if (site.protocol !== "https:" || !site.hostname.endsWith(".atlassian.net") || site.username || site.password || site.port ||
        !/^[A-Z][A-Z0-9_]{0,31}-[1-9][0-9]{0,19}$/.test(issueKey) ||
        target.origin !== site.origin || target.username || target.password ||
        target.pathname !== `/browse/${issueKey}` || target.search || target.hash) return null;
    return target.href;
  } catch { return null; }
}

export async function createFinding(session: Session, input: { project: string; siteId: string; title: string; description: string }, key: string) {
  try { await checkSession(session); } catch (error) {
    if (error instanceof SessionChanged) throw error;
    throw new RejectedFinding("Could not verify your session. No ticket was sent; try again.");
  }
  let response: Response;
  try {
    response = await fetch("/api/findings", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken, "Idempotency-Key": key },
      body: JSON.stringify(input),
    });
  } catch { throw new UnknownOutcome(); }
  try { await checkSession(session); } catch (error) {
    if (error instanceof SessionChanged) throw error;
    throw new UnknownOutcome();
  }
  const body: { error?: string; issueKey?: string; url?: string } = await response.json().catch(() => ({}));
  if (response.ok && body.issueKey && body.url) return { issueKey: body.issueKey, url: body.url };
  if (response.ok) throw new UnknownOutcome();
  if (body.error === "Jira created the issue, but local recording failed. Do not retry.") {
    const issue = body.issueKey && /^[A-Z][A-Z0-9_]{0,31}-[1-9][0-9]{0,19}$/.test(body.issueKey) ? ` ${body.issueKey}` : "";
    throw new CreatedNotRecorded(`Jira created${issue}, but IdentityHub could not save it to recent tickets. Check Jira; do not create it again.`);
  }
  if (response.status === 409 && body.error === "Jira site changed.")
    throw new RejectedFinding("Jira site changed. No ticket was created. Return to Findings and review the selected site.");
  const confirmedRejections: Record<number, string[]> = {
    403: ["Invalid CSRF token", "Reconnect Jira to grant issue creation access.", "Jira project is not available."],
    422: ["Invalid finding or idempotency key", "No supported Jira issue type is available for this project."],
    429: ["Jira rejected the finding."],
    502: ["Jira rejected the finding."],
  };
  if (body.error && confirmedRejections[response.status]?.includes(body.error))
    throw new RejectedFinding("Jira did not create the ticket. Check your access and finding details, then try again.");
  throw new UnknownOutcome();
}
