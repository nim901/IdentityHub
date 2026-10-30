import { useState, type FormEvent } from "react";
import {
  authenticate,
  errorMessage,
  type AuthAction,
  type Session,
} from "./authApi";

type Props = { onSignIn: (session: Session) => void };

function validate(
  action: AuthAction,
  email: string,
  password: string,
): string | null {
  if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return "Enter a valid email address.";
  if (!password) return "Enter your password.";
  if (action === "register" && password.length < 12)
    return "Password must be at least 12 characters.";
  if (password.length > 256) return "Password must be 256 characters or fewer.";
  return null;
}

export function AuthForm({ onSignIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const button = (event.nativeEvent as SubmitEvent).submitter;
    const action: AuthAction =
      button?.getAttribute("value") === "register" ? "register" : "login";
    const validationError = validate(action, email, password);
    setMessage(validationError ?? "");
    if (validationError) return;

    setBusy(true);
    try {
      const session = await authenticate(action, email, password);
      if (session) {
        setPassword("");
        onSignIn(session);
      } else {
        setMessage("Account created. Please sign in.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      <label>
        Email{" "}
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setMessage("");
          }}
        />
      </label>
      <br />
      <label>
        Password{" "}
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setMessage("");
          }}
        />
      </label>
      <br />
      <button disabled={busy} value="login">
        Sign in
      </button>{" "}
      <button disabled={busy} value="register">
        Create account
      </button>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
