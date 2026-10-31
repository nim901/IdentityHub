import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FindingComposer, type FindingDraft } from "./FindingComposer";
import { Settings } from "./Settings";
import { createFinding, CreatedNotRecorded, RejectedFinding, safeTicketUrl, type Ticket } from "./findingApi";
import type { Session } from "./authApi";
import {
  jiraRequest,
  SessionChanged,
  type JiraProject,
  type JiraStatus,
} from "./jiraApi";

type Props = {
  session: Session;
  sessionRefresh: number;
  onSignOut: () => void;
  onSessionChanged: (session: Session) => void;
};
type Destination = "findings" | "settings" | "signout";
const emptyDraft: FindingDraft = { project: "", title: "", description: "" };

export function Shell({
  session: currentSession,
  sessionRefresh,
  onSignOut,
  onSessionChanged: notifySessionChanged,
}: Props) {
  const session = useMemo(
    () => currentSession,
    [
      currentSession.user.id,
      currentSession.user.email,
      currentSession.csrfToken,
    ],
  );
  const onSessionChanged = useCallback(() => notifySessionChanged(session), [notifySessionChanged, session]);
  const [callbackResult] = useState(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("jira");
    if (result) {
      url.searchParams.delete("jira");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    }
    return result;
  });
  const [view, setView] = useState<"findings" | "report" | "settings">(
    callbackResult ? "settings" : "findings",
  );
  const [jira, setJira] = useState<JiraStatus | null>(null);
  const [jiraError, setJiraError] = useState("");
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [project, setProject] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [projectRetry, setProjectRetry] = useState(0);
  const statusVersion = useRef(0);
  const [confirmedSessionRefresh, setConfirmedSessionRefresh] = useState(sessionRefresh);
  const refreshJira = useCallback(async () => {
    const version = ++statusVersion.current;
    try {
      const result = await jiraRequest<JiraStatus>(session, "/api/jira/status");
      if (version === statusVersion.current) {
        setJira(result);
        setJiraError("");
        setConfirmedSessionRefresh(sessionRefresh);
      }
    } catch (error) {
      if (version !== statusVersion.current) return;
      if (error instanceof SessionChanged) onSessionChanged();
      else {
        setJiraError("Could not load Jira connection. Please try again.");
        setJira(null);
      }
      throw error;
    }
  }, [session, onSessionChanged, sessionRefresh]);
  useEffect(() => {
    void refreshJira().catch(() => {});
    return () => {
      ++statusVersion.current;
    };
  }, [refreshJira]);
  useEffect(() => {
    let active = true;
    setProjects([]);
    setProject("");
    setProjectError("");
    if (!jira?.site)
      return () => {
        active = false;
      };
    setProjectsLoading(true);
    jiraRequest<{ projects: JiraProject[] }>(session, "/api/jira/projects")
      .then((result) => {
        if (active) {
          setProjects(result.projects);
          setProjectError("");
        }
      })
      .catch((error) => {
        if (active) {
          if (error instanceof SessionChanged) onSessionChanged();
          else
            setProjectError(
              "Could not load projects. Check access or reconnect Jira.",
            );
        }
      })
      .finally(() => {
        if (active) setProjectsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [jira?.site?.id, session, onSessionChanged, projectRetry]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketContext, setTicketContext] = useState("");
  const currentTicketContext = `${jira?.site?.id ?? ""}:${project}`;
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submissionLock = useRef(false);
  const [submitError, setSubmitError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [createdMessage, setCreatedMessage] = useState("");
  useEffect(() => {
    let active = true;
    setTickets([]);
    setTicketContext(currentTicketContext);
    setTicketsError("");
    if (!project || !jira?.site) { setTicketsLoading(false); return () => { active = false; }; }
    if (confirmedSessionRefresh !== sessionRefresh) {
      setTicketsLoading(true);
      return () => { active = false; };
    }
    setTicketsLoading(true);
    jiraRequest<{ findings: Ticket[] }>(session, `/api/findings?project=${encodeURIComponent(project)}&siteId=${encodeURIComponent(jira.site.id)}`)
      .then(result => { if (active) setTickets(result.findings); })
      .catch(error => {
        if (!active) return;
        if (error instanceof SessionChanged) onSessionChanged();
        else setTicketsError("Could not load recent tickets. Try again.");
      })
      .finally(() => { if (active) setTicketsLoading(false); });
    return () => { active = false; };
  }, [project, jira?.site?.id, session, onSessionChanged, historyVersion, sessionRefresh, confirmedSessionRefresh]);
  const [draft, setDraft] = useState<FindingDraft>(emptyDraft);
  const [pending, setPending] = useState<Destination | null>(null);
  const [focusFindings, setFocusFindings] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const hasDraft = Boolean(draft.project || draft.title || draft.description);

  useEffect(() => {
    if (!hasDraft) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasDraft]);

  useEffect(() => {
    if (view === "findings" && focusFindings) heading.current?.focus();
  }, [view, focusFindings]);

  async function submitFinding() {
    if (submissionLock.current || confirmedSessionRefresh !== sessionRefresh || !project || draft.project !== project || !jira?.site || !draft.title.trim() || !draft.description.trim() || (uncertain && !acknowledged)) return;
    submissionLock.current = true;
    setSubmitting(true);
    setSubmitError("");
    setUncertain(false);
    setAcknowledged(false);
    try {
      const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
      const result = await createFinding(session, { project, siteId: jira.site.id, title: draft.title.trim(), description: draft.description }, key);
      setDraft(emptyDraft);
      setCreatedMessage(`Created ${result.issueKey}.`);
      setHistoryVersion(value => value + 1);
      setView("findings");
    } catch (error) {
      if (error instanceof SessionChanged) onSessionChanged();
      else if (error instanceof RejectedFinding) setSubmitError(error.message);
      else if (error instanceof CreatedNotRecorded) { setUncertain(true); setSubmitError(error.message); }
      else {
        setUncertain(true);
        setSubmitError("The creation outcome is unknown. Check Jira before trying again; another attempt may create a duplicate.");
      }
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  }

  function leave(destination: Destination) {
    if (submissionLock.current) return;
    if (hasDraft) {
      returnFocus.current =
        destination === "signout"
          ? accountButton.current
          : (document.activeElement as HTMLElement | null);
      setPending(destination);
      return;
    }
    navigate(destination);
  }

  function navigate(destination: Destination) {
    setDraft(emptyDraft);
    if (destination === "signout") {
      onSignOut();
    } else if (destination === "findings") {
      setFocusFindings(true);
      setView("findings");
    } else {
      setView("settings");
    }
  }

  function discardDraft() {
    returnFocus.current = null;
    if (pending) navigate(pending);
    setPending(null);
  }

  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="header wrap">
        <div className="brand">
          <span className="brand-mark">i</span>IdentityHub
        </div>
        <nav aria-label="Main navigation">
          <button
            className={view !== "settings" ? "active" : ""}
            disabled={submitting}
            onClick={() => leave("findings")}
          >
            Findings
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            disabled={submitting}
            onClick={() => leave("settings")}
          >
            Settings
          </button>
        </nav>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            ref={accountButton}
            disabled={submitting}
            className="account"
            aria-label={`Account: ${session.user.email}`}
          >
            <span className="email">{session.user.email}</span>
            <span className="avatar">
              {session.user.email[0]?.toUpperCase()}
            </span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end" sideOffset={8}>
              <DropdownMenu.Label className="menu-label">
                {session.user.email}
              </DropdownMenu.Label>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item
                className="menu-item"
                onSelect={() => leave("signout")}
              >
                Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      {view === "report" ? (
        <FindingComposer
          draft={draft}
          onChange={setDraft}
          onBack={() => leave("findings")}
          onSubmit={() => { void submitFinding(); }}
          busy={submitting}
          canSubmit={Boolean(confirmedSessionRefresh === sessionRefresh && jira?.connected && jira.site && project && draft.project === project)}
          error={submitError}
          uncertain={uncertain}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
        />
      ) : view === "settings" ? (
        <Settings
          session={session}
          status={jira}
          statusError={jiraError}
          refresh={refreshJira}
          onSessionChanged={onSessionChanged}
          callbackNotice={
            callbackResult === "failed"
              ? "Jira authorization was not completed. Try connecting again."
              : ""
          }
        />
      ) : (
        <main id="content" className="wrap workspace">
          <div className="findings-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                Findings
              </h1>
              <p className="subtitle">
                Report non-human identity findings to Jira.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setFocusFindings(false);
                setCreatedMessage("");
                if (project) setDraft((current) => ({ ...current, project }));
                setView("report");
              }}
            >
              + Report finding
            </button>
          </div>
          <div className="project-toolbar">
            {!jira ? (
              <span>{jiraError || "Loading Jira connection…"}</span>
            ) : !jira.connected || !jira.site ? (
              <span>Connect Jira and select a site in Settings.</span>
            ) : projectsLoading ? (
              <span>Loading projects…</span>
            ) : projectError ? (
              <div>
                <p role="alert">{projectError}</p>
                <button
                  className="text-button"
                  onClick={() => setProjectRetry((value) => value + 1)}
                >
                  Retry projects
                </button>
              </div>
            ) : projects.length ? (
              <label>
                Jira project{" "}
                <select
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                >
                  <option value="">Choose a project</option>
                  {projects.map((item) => (
                    <option value={item.key} key={item.id}>
                      {item.name} ({item.key})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span>No projects available. Check your Jira access.</span>
            )}
            {jira?.site && <span>{jira.site.name}</span>}
          </div>
          {jiraError && jira && <p role="alert">{jiraError}</p>}
          <section aria-labelledby="recent-heading">
            <div className="section-heading">
              <h2 id="recent-heading">Recent tickets</h2>
              <span>Latest 10 per project</span>
            </div>
            <p className="subtitle">
              Tickets created by this app, not your entire Jira history.
            </p>
            {createdMessage && <p role="status">{createdMessage}</p>}
            {!project ? (
              <div className="ledger-empty"><p>Select a Jira project to see recent tickets.</p></div>
            ) : confirmedSessionRefresh !== sessionRefresh || ticketContext !== currentTicketContext || ticketsLoading ? (
              <p role="status">Loading recent tickets…</p>
            ) : ticketsError ? (
              <div>
                <p role="alert">{ticketsError}</p>
                <button className="text-button" onClick={() => setHistoryVersion(value => value + 1)}>
                  Retry tickets
                </button>
              </div>
            ) : tickets.length === 0 ? (
              <div className="ledger-empty">
                <h3>No tickets yet</h3>
                <p>Tickets created in this project will appear here.</p>
              </div>
            ) : (
              <ul className="ticket-list">
                {tickets.map(ticket => {
                  const safeUrl = jira?.site && safeTicketUrl(ticket.url, ticket.issueKey, jira.site.url);
                  return (
                    <li key={ticket.issueKey}>
                      <div>
                        <strong>{ticket.title}</strong><br />
                        {safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">{ticket.issueKey}</a> : <span>{ticket.issueKey}</span>}
                      </div>
                      <time dateTime={ticket.createdAt}>{new Date(ticket.createdAt).toLocaleString()}</time>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </main>
      )}
      <AlertDialog.Root
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content
            className="dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              keepEditing.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocus.current?.focus();
              returnFocus.current = null;
            }}
          >
            <AlertDialog.Title>Discard this draft?</AlertDialog.Title>
            <AlertDialog.Description>
              Leaving or signing out clears this draft. Check Jira if a previous creation outcome was uncertain.
            </AlertDialog.Description>
            <div className="dialog-actions">
              <AlertDialog.Cancel ref={keepEditing}>
                Keep editing
              </AlertDialog.Cancel>
              <AlertDialog.Action onClick={discardDraft}>
                Discard draft
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
