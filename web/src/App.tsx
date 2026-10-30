import { useEffect, useState } from "react";
import { AuthForm } from "./AuthForm";
import { Shell } from "./Shell";
import { errorMessage, getSession, signOut, type Session } from "./authApi";
import "./styles.css";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    getSession().then((result) => { if (active) setSession(result); })
      .catch((error) => { if (active) setMessage(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  async function handleSignOut() {
    if (!session) return;
    try { await signOut(session.csrfToken); setSession(null); setMessage(""); }
    catch (error) { setMessage(errorMessage(error)); }
  }

  if (loading) return <main className="auth-page"><p>Checking your session...</p></main>;
  if (!session && message) return <main className="auth-page"><div><p role="alert">{message}</p><button onClick={() => setRetry((value) => value + 1)}>Retry</button></div></main>;
  return session ? <><Shell session={session} onSignOut={handleSignOut} />{message && <p className="wrap" role="alert">{message}</p>}</> :
    <main className="auth-page"><div className="auth-card"><div className="brand"><span className="brand-mark">i</span>IdentityHub</div><h1>Welcome</h1><p className="subtitle">Sign in or create an account to continue.</p><AuthForm onSignIn={setSession} />{message && <p role="alert">{message}</p>}</div></main>;
}
