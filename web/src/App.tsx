import { useEffect, useState } from "react";
import { AuthForm } from "./AuthForm";
import { errorMessage, getSession, signOut, type Session } from "./authApi";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    getSession()
      .then((result) => {
        if (active) setSession(result);
      })
      .catch((error) => {
        if (active) setMessage(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    if (!session) return;
    try {
      await signOut(session.csrfToken);
      setSession(null);
      setMessage("");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <main>
      <h1>IdentityHub</h1>
      {session ? (
        <>
          <p>Signed in as {session.user.email}</p>
          <button onClick={handleSignOut}>Sign out</button>
          <p>Jira integration setup is underway.</p>
        </>
      ) : (
        <AuthForm onSignIn={setSession} />
      )}
      {message && <p role="alert">{message}</p>}
    </main>
  );
}
