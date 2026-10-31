import { useCallback, useEffect, useRef, useState } from "react";
import { AuthForm } from "./AuthForm";
import { Shell } from "./Shell";
import { errorMessage, getSession, signOut, type Session } from "./authApi";
import "./styles.css";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("jira") !== "expired") return "";
    url.searchParams.delete("jira");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    return "Your session ended during Jira connection. Please sign in and start again.";
  });
  const [retry, setRetry] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const requestVersion = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const currentSession = useRef<Session | null>(session);
  currentSession.current = session;

  useEffect(() => {
    let active = true;
    const version = ++requestVersion.current;
    setLoading(true);
    setMessage("");
    getSession()
      .then((result) => {
        if (active && version === requestVersion.current) setSession(result);
      })
      .catch((error) => {
        if (active && version === requestVersion.current)
          setMessage(errorMessage(error));
      })
      .finally(() => {
        if (active && version === requestVersion.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);

  useEffect(() => {
    if (!session || signingOut || logoutError) return;
    const currentUserId = session.user.id;
    async function refreshSession() {
      if (document.visibilityState !== "visible") return;
      refreshController.current?.abort();
      const controller = new AbortController();
      refreshController.current = controller;
      const version = ++requestVersion.current;
      try {
        const current = await getSession(controller.signal);
        if (version !== requestVersion.current) return;
        if (!current) {
          setSession(null);
          setMessage("");
          setNotice(
            "Your session ended. Any unsent draft was cleared. Please sign in again.",
          );
        } else {
          setSession(current);
          setSessionRefresh((value) => value + 1);
          setMessage(
            current.user.id === currentUserId
              ? ""
              : "Your account changed. Any unsent draft was cleared.",
          );
        }
      } catch (error) {
        if (!controller.signal.aborted && version === requestVersion.current)
          setMessage(errorMessage(error));
      } finally {
        if (refreshController.current === controller)
          refreshController.current = null;
      }
    }
    window.addEventListener("focus", refreshSession);
    document.addEventListener("visibilitychange", refreshSession);
    return () => {
      refreshController.current?.abort();
      window.removeEventListener("focus", refreshSession);
      document.removeEventListener("visibilitychange", refreshSession);
    };
  }, [session?.user.id, signingOut, logoutError]);

  async function handleSignOut() {
    if (!session || signingOut) return;
    ++requestVersion.current;
    setSigningOut(true);
    setMessage("");
    try {
      await signOut(session.csrfToken);
      setSession(null);
      setLogoutError(false);
    } catch {
      setLogoutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  function handleSignIn(current: Session) {
    ++requestVersion.current;
    setNotice("");
    setSession(current);
  }

  const handleSessionChanged = useCallback((expected: Session) => {
    if (currentSession.current?.user.id !== expected.user.id ||
        currentSession.current.csrfToken !== expected.csrfToken) return;
    ++requestVersion.current;
    setSession(null);
    setNotice(
      "Your session or account changed. Any unsent draft was cleared. Please sign in again.",
    );
  }, []);

  if (loading)
    return (
      <main className="auth-page">
        <p>Checking your session...</p>
      </main>
    );
  if (!session && message)
    return (
      <main className="auth-page">
        <div>
          <p role="alert">{message}</p>
          <button onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div>
      </main>
    );
  if (session) {
    return (
      <>
        <Shell
          key={session.user.id}
          session={session}
          sessionRefresh={sessionRefresh}
          onSignOut={handleSignOut}
          onSessionChanged={handleSessionChanged}
        />
        {message && (
          <p className="wrap" role="alert">
            {message}
          </p>
        )}
        {logoutError && (
          <div className="wrap" role="alert">
            <p>
              Sign out could not be confirmed. Your session may still be active.
            </p>
            <button disabled={signingOut} onClick={handleSignOut}>
              Retry sign out
            </button>
            <button disabled={signingOut} onClick={() => setLogoutError(false)}>
              Back to workspace
            </button>
          </div>
        )}
      </>
    );
  }
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">i</span>IdentityHub
        </div>
        <h1>Welcome</h1>
        <p className="subtitle">Sign in or create an account to continue.</p>
        {notice && <p role="alert">{notice}</p>}
        <AuthForm onSignIn={handleSignIn} />
      </div>
    </main>
  );
}
