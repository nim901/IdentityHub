import { useEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  jiraRequest,
  SessionChanged,
  type JiraSite,
  type JiraStatus,
} from "./jiraApi";
import type { Session } from "./authApi";
import { ApiKeyPanel } from "./ApiKeyPanel";
import type { JiraProject } from "./jiraApi";

type Props = {
  session: Session;
  status: JiraStatus | null;
  statusError: string;
  refresh: () => Promise<void>;
  onSessionChanged: () => void;
  callbackNotice: string;
  projects: JiraProject[];
  projectsLoading: boolean;
  projectError: string;
  keyCreating: boolean;
  onKeyCreationChange: (operation: symbol, active: boolean) => void;
};

export function Settings({
  session,
  status,
  statusError,
  refresh,
  onSessionChanged,
  callbackNotice,
  projects,
  projectsLoading,
  projectError,
  keyCreating,
  onKeyCreationChange,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [sites, setSites] = useState<JiraSite[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [message, setMessage] = useState(callbackNotice);
  const [error, setError] = useState("");
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    let active = true;
    setSites([]);
    setSelected(status?.site?.id ?? "");
    if (!status?.connected)
      return () => {
        active = false;
      };
    setLoadingSites(true);
    jiraRequest<{ sites: JiraSite[] }>(session, "/api/jira/sites")
      .then((result) => {
        if (active) setSites(result.sites);
      })
      .catch((e) => {
        if (active) {
          if (e instanceof SessionChanged) onSessionChanged();
          else setError("Could not load Jira sites. Try reconnecting.");
        }
      })
      .finally(() => {
        if (active) setLoadingSites(false);
      });
    return () => {
      active = false;
    };
  }, [status?.connected, status?.site?.id, session, onSessionChanged]);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const result = await jiraRequest<{ authorizationUrl: string }>(
        session,
        "/api/jira/connect",
        { method: "POST" },
      );
      const url = new URL(result.authorizationUrl);
      if (
        url.origin !== "https://auth.atlassian.com" ||
        url.username ||
        url.password
      )
        throw new Error("Invalid authorization destination");
      window.location.assign(url.href);
    } catch (e) {
      if (e instanceof SessionChanged) onSessionChanged();
      else
        setError(
          "Could not start Jira connection. Check configuration and try again.",
        );
      setBusy(false);
    }
  }
  async function saveSite() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await jiraRequest(session, "/api/jira/site", {
        method: "POST",
        body: JSON.stringify({ id: selected }),
      });
      await refresh();
      setMessage("Site selected.");
    } catch (e) {
      if (e instanceof SessionChanged) onSessionChanged();
      else
        setError(
          "Could not select this site. Check your access and try again.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="content" className="wrap settings">
      <h1 ref={heading} tabIndex={-1}>
        Settings
      </h1>
      <p className="subtitle">Manage your connections and scanner access.</p>
      <Tabs.Root defaultValue="jira">
        <Tabs.List className="settings-tabs" aria-label="Settings sections">
          <Tabs.Trigger value="jira" disabled={keyCreating}>Jira connection</Tabs.Trigger>
          <Tabs.Trigger value="api">API access</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="jira" className="settings-panel">
          <h2>Jira connection</h2>
          <p className="subtitle">Account: {session.user.email}</p>
          {!status ? (
            statusError ? (
              <>
                <p role="alert">{statusError}</p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    void refresh().catch(() => {});
                  }}
                >
                  Retry
                </button>
              </>
            ) : (
              <p role="status">Loading connection…</p>
            )
          ) : !status.configured ? (
            <>
              <p id="jira-setup-notice">
                Jira connection is not configured yet. Complete the Jira setup
                to connect.
              </p>
              <button
                className="primary-button"
                disabled
                aria-describedby="jira-setup-notice"
              >
                Connect Jira
              </button>
              <details className="jira-setup">
                <summary>Jira setup instructions</summary>
                <p>
                  Set <code>ATLASSIAN_CLIENT_ID</code>,{" "}
                  <code>ATLASSIAN_CLIENT_SECRET</code>,{" "}
                  <code>OAUTH_REDIRECT_URI</code>, and <code>ENCRYPTION_KEY</code>{" "}
                  in the server environment, then restart the server. The encryption
                  key must be a stable base64-encoded 32-byte key. See the project
                  README before changing an existing key.
                </p>
              </details>
            </>
          ) : (
            <>
              <p>
                {status.connected
                  ? status.site
                    ? `Connected to ${status.site.name}.`
                    : "Jira connected. Choose a site."
                  : "Not connected to Jira."}
              </p>
              <button
                className="primary-button"
                disabled={busy}
                onClick={connect}
              >
                {status.connected ? "Reconnect Jira" : "Connect Jira"}
              </button>
              {status.connected && (
                <div className="site-picker">
                  <label htmlFor="jira-site">Jira site</label>
                  <select
                    id="jira-site"
                    value={selected}
                    disabled={loadingSites}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    <option value="">Choose a site</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} — {site.url}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-button"
                    disabled={busy || loadingSites || !selected}
                    onClick={saveSite}
                  >
                    Save site
                  </button>
                  {loadingSites ? (
                    <p role="status">Loading Jira sites…</p>
                  ) : (
                    sites.length === 0 &&
                    !error && (
                      <p className="subtitle">
                        No sites available. Check your Jira access or reconnect.
                      </p>
                    )
                  )}
                </div>
              )}
            </>
          )}
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </Tabs.Content>
        <Tabs.Content value="api" className="settings-panel">
          <ApiKeyPanel key={session.csrfToken} session={session} status={status} projects={projects} projectsLoading={projectsLoading} projectError={projectError} onSessionChanged={onSessionChanged} onKeyCreationChange={onKeyCreationChange} />
        </Tabs.Content>
      </Tabs.Root>
    </main>
  );
}
