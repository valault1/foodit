import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

type Step = "email" | "code";

export function LoginPage() {
  const { onSignedIn } = useAuth();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestCode(email.trim());
      setStep("code");
      setNotice(`We sent a 6-digit code to ${email.trim()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.verifyCode(email.trim(), code.trim());
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="wordmark-dot" aria-hidden="true" />
          foodit
        </div>

        {step === "email" ? (
          <>
            <h1 className="auth-title">Sign in</h1>
            <p className="auth-subtitle">
              Enter your email and we'll send you a login code — no password needed.
            </p>
            <form className="auth-form" onSubmit={sendCode}>
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
              {error && <div className="alert alert--error">{error}</div>}
              <button className="btn btn-primary btn-block" disabled={busy || !email.trim()}>
                {busy ? "Sending…" : "Send code"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="auth-title">Enter your code</h1>
            {notice && <p className="auth-subtitle">{notice}</p>}
            <form className="auth-form" onSubmit={verify}>
              <input
                className="input code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
                required
              />
              {error && <div className="alert alert--error">{error}</div>}
              <button
                className="btn btn-primary btn-block"
                disabled={busy || code.length < 6}
              >
                {busy ? "Verifying…" : "Sign in"}
              </button>
            </form>
            <div className="auth-secondary">
              <button
                className="link-button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
              >
                ← Use a different email
              </button>
              <button className="link-button" onClick={() => sendCode()} disabled={busy}>
                Resend code
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
