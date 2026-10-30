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
): { field: "email" | "password"; message: string } | null {
  if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return { field: "email", message: "Enter a valid email address." };
  if (!password) return { field: "password", message: "Enter your password." };
  if (action === "register" && password.length < 12)
    return { field: "password", message: "Password must be at least 12 characters." };
  if (password.length > 256) return { field: "password", message: "Password must be 256 characters or fewer." };
  return null;
}

export function AuthForm({ onSignIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState<ReturnType<typeof validate>>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const button = (event.nativeEvent as SubmitEvent).submitter;
    const action: AuthAction =
      button?.getAttribute("value") === "register" ? "register" : "login";
    const validationError = validate(action, email, password);
    setFieldError(validationError);
    setMessage("");
    setSuccess(false);
    if (validationError) return;

    setBusy(true);
    try {
      const session = await authenticate(action, email, password);
      if (session) {
        setPassword("");
        onSignIn(session);
      } else {
        setMessage("Account created. Please sign in.");
        setSuccess(true);
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
          aria-invalid={fieldError?.field === "email" || undefined}
          aria-describedby={fieldError?.field === "email" ? "email-error" : undefined}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (fieldError?.field === "email") setFieldError(null);
            setMessage("");
          }}
        />
      </label>
      {fieldError?.field === "email" && <p id="email-error" className="field-error" role="alert">{fieldError.message}</p>}
      <label>
        Password{" "}
        <input
          type="password"
          autoComplete="current-password"
          aria-invalid={fieldError?.field === "password" || undefined}
          aria-describedby={fieldError?.field === "password" ? "password-error" : undefined}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (fieldError?.field === "password") setFieldError(null);
            setMessage("");
          }}
        />
      </label>
      {fieldError?.field === "password" && <p id="password-error" className="field-error" role="alert">{fieldError.message}</p>}
      <button disabled={busy} value="login">
        Sign in
      </button>{" "}
      <button disabled={busy} value="register">
        Create account
      </button>
      {message && <p className={success ? "form-message success" : "form-message error"} role={success ? "status" : "alert"}>{message}</p>}
    </form>
  );
}
