import { useCallback, useEffect, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { Session } from "./authApi";
import { ApiKeyRequestError, keyRequest, type ApiKey } from "./apiKeyApi";
import { SessionChanged, type JiraProject, type JiraStatus } from "./jiraApi";

type Props = {
  session: Session;
  status: JiraStatus | null;
  projects: JiraProject[];
  projectsLoading: boolean;
  projectError: string;
  onSessionChanged: () => void;
  onKeyCreationChange: (operation: symbol, active: boolean) => void;
};

export function ApiKeyPanel({ session, status, projects, projectsLoading, projectError, onSessionChanged, onKeyCreationChange }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [allowed, setAllowed] = useState<string[]>([]);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const operation = useRef(Symbol("api-key-creation"));
  const [pending, setPending] = useState<ApiKey | null>(null);
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    try {
      const result = await keyRequest<{ keys: ApiKey[] }>(session, "/api/keys");
      if (!Array.isArray(result.keys)) throw new Error("Invalid API key list");
      if (current === version.current) { setKeys(result.keys); setListError(""); }
    } catch (e) {
      if (current !== version.current) return;
      if (e instanceof SessionChanged) onSessionChanged();
      else setListError("Could not load API keys. Try again.");
    } finally { if (current === version.current) setLoading(false); }
  }, [session, onSessionChanged]);
  useEffect(() => { void load(); return () => { ++version.current; }; }, [load]);
  useEffect(() => {
    const current = operation.current;
    return () => { onKeyCreationChange(current, false); };
  }, [onKeyCreationChange]);
  useEffect(() => { setAllowed([]); }, [status?.site?.id]);
  useEffect(() => { setAllowed(current => current.filter(key => projects.some(project => project.key === key))); }, [projects]);

  async function create() {
    if (lock.current || !status?.site || !name.trim() || !allowed.length) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    onKeyCreationChange(operation.current, true);
    try {
      const result = await keyRequest<{ key: string; apiKey: ApiKey }>(session, "/api/keys", {
        method: "POST", body: JSON.stringify({ name: name.trim(), siteId: status.site.id, projects: allowed }),
      });
      if (typeof result.key !== "string" || !/^ih_[A-Za-z0-9_-]{43}$/.test(result.key)) throw new Error("Invalid key response");
      setSecret(result.key); setName(""); setAllowed([]);
      await load();
    } catch (e) {
      if (e instanceof SessionChanged) onSessionChanged();
      else if (e instanceof ApiKeyRequestError && (
        (e.status === 403 && ["Invalid CSRF token", "One or more projects are not available."].includes(e.code)) ||
        (e.status === 409 && ["Jira site changed. Refresh and select a site.", "Active API key limit reached."].includes(e.code)) ||
        (e.status === 422 && e.code === "Enter a name and select available projects.") ||
        (e.status === 503 && e.code === "Jira connection is not configured.")
      )) setError("Key was not created. Check your selected site, project access, and active key limit.");
      else {
        setNotice("The key may have been created, but its secret could not be displayed. Check the list and revoke any unwanted key before trying again.");
        await load();
      }
    } finally { lock.current = false; setBusy(false); onKeyCreationChange(operation.current, false); }
  }
  async function revoke(key: ApiKey) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await keyRequest<void>(session, `/api/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
      setKeys(current => current.map(item => item.id === key.id ? { ...item, revokedAt: new Date().toISOString() } : item));
      setPending(null);
      await load();
      setNotice("API key revoked.");
    } catch (e) {
      setPending(null);
      if (e instanceof SessionChanged) onSessionChanged();
      else { setNotice("Could not confirm revocation. Check the list before trying again."); await load(); }
    } finally { lock.current = false; setBusy(false); }
  }
  return (
    <section aria-labelledby="api-key-heading">
      <h2 id="api-key-heading">Scanner access</h2>
      <p>Create keys restricted to projects on your selected Jira site. The scanner endpoint is not available yet.</p>
      {secret && <div className="key-secret" role="status"><strong>Copy this key now</strong><p>It will not be shown again. Store it securely.</p><label>New API key<input readOnly value={secret} /></label><button className="secondary-button" onClick={() => setSecret("")}>Done</button></div>}
      {!status?.site ? <p>Connect Jira and select a site before generating a key.</p> : <>
        <p>Site: {status.site.name}</p>
        <label className="key-name">Key name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <fieldset disabled={busy || projectsLoading || Boolean(projectError)}>
          <legend>Allowed projects (up to 20)</legend>
          {projectsLoading ? <p>Loading projects…</p> : projectError ? <p>Could not load projects. Retry from Findings.</p> : projects.length === 0 ? <p>No projects available.</p> : projects.map(project => <label className="key-project" key={project.id}><input type="checkbox" aria-label={`Allow ${project.key}`} disabled={!allowed.includes(project.key) && allowed.length >= 20} checked={allowed.includes(project.key)} onChange={event => setAllowed(current => event.target.checked ? [...current, project.key] : current.filter(item => item !== project.key))} /> {project.name} ({project.key})</label>)}
        </fieldset>
      </>}
      <button className="primary-button" disabled={busy || Boolean(secret) || !status?.site || !name.trim() || !allowed.length || projectsLoading || Boolean(projectError)} onClick={() => { void create(); }}>Generate API key</button>
      {busy && <p role="status">Updating API keys… Please keep this page open.</p>}
      {error && <p role="alert">{error}</p>}
      {listError && <div><p role="alert">{listError}</p><button className="text-button" onClick={() => { void load(); }}>Retry keys</button></div>}
      {notice && <p role="status">{notice}</p>}
      <h3>API keys</h3>
      {loading ? <p role="status">Loading API keys…</p> : listError && keys.length === 0 ? null : keys.length === 0 ? <p>No API keys yet.</p> : <ul className="key-list">{keys.map(key => <li key={key.id}><div><strong>{key.name}</strong> <span>{key.revokedAt ? "Revoked" : key.requiresReplacement ? "Needs replacement" : "Active"}</span>{!key.revokedAt && key.requiresReplacement && <p>Replace this key before using scanner access.</p>}<p>{key.prefix}… · {key.projects.join(", ")} · Site {status?.site?.id === key.siteId ? status.site.name : key.siteId}</p></div>{!key.revokedAt && <button className="secondary-button" disabled={busy} aria-label={`Revoke ${key.name} (${key.prefix})`} onClick={() => setPending(key)}>Revoke</button>}</li>)}</ul>}
      <p>Planned endpoint — not available:</p><code>POST /api/v1/findings</code>
      <AlertDialog.Root open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }}>
        <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay" /><AlertDialog.Content className="dialog"><AlertDialog.Title>Revoke API key?</AlertDialog.Title><AlertDialog.Description>Revoking {pending?.name} cannot be undone.</AlertDialog.Description><div className="dialog-actions"><AlertDialog.Cancel>Cancel</AlertDialog.Cancel><AlertDialog.Action disabled={busy} onClick={event => { event.preventDefault(); if (pending) void revoke(pending); }}>Confirm revoke</AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
