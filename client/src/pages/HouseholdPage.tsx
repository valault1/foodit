import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { HouseholdInfo } from "../types";

export function HouseholdPage() {
  const { user } = useAuth();
  const [info, setInfo] = useState<HouseholdInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  async function load() {
    try {
      setInfo(await api.getHousehold());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load household");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteNotice(null);
    const email = inviteEmail.trim();
    try {
      const { emailed, warning } = await api.createInvite(email, "member");
      setInviteEmail("");
      // The invite always lands; `emailed` says whether they were told about it.
      if (emailed) setInviteNotice(`Invite sent to ${email}.`);
      else setInviteError(warning ?? "The invite was created, but we couldn't email them.");
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not send invite");
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id: string) {
    await api.deleteInvite(id);
    await load();
  }

  if (loading) return <div className="container"><p className="muted">Loading…</p></div>;

  return (
    <div className="container container--narrow">
      <Link to="/" className="back-link">← Back to recipes</Link>
      <h1 className="page-title">{info?.household?.name ?? "Household"}</h1>
      <p className="page-subtitle">Everyone here shares the same recipe collection.</p>

      {error && <div className="alert alert--error">{error}</div>}

      <section className="card household-section">
        <h2 className="section-title">Members</h2>
        <ul className="member-list">
          {info?.members.map((m) => (
            <li key={m.id} className="member-row">
              <div className="member-avatar" aria-hidden="true">
                {(m.name ?? m.email).charAt(0).toUpperCase()}
              </div>
              <div className="member-info">
                <span className="member-email">{m.email}</span>
                {m.id === user?.id && <span className="member-you">you</span>}
              </div>
              <span className={`role-badge role-badge--${m.role}`}>{m.role}</span>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="card household-section">
          <h2 className="section-title">Invite someone</h2>
          <form className="invite-form" onSubmit={sendInvite}>
            <input
              className="input"
              type="email"
              placeholder="their@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
            <button className="btn btn-primary" disabled={inviting || !inviteEmail.trim()}>
              {inviting ? "Inviting…" : "Send invite"}
            </button>
          </form>
          {inviteError && <div className="alert alert--error">{inviteError}</div>}
          {inviteNotice && <div className="alert alert--success">{inviteNotice}</div>}
          <p className="invite-hint">
            We'll email them a link. They sign in with this address to join your household.
          </p>

          {info && info.invites.length > 0 && (
            <div className="pending-invites">
              <h3 className="pending-title">Pending invites</h3>
              <ul className="member-list">
                {info.invites.map((inv) => (
                  <li key={inv.id} className="member-row">
                    <div className="member-avatar member-avatar--pending" aria-hidden="true">
                      ⋯
                    </div>
                    <div className="member-info">
                      <span className="member-email">{inv.email}</span>
                      <span className="member-you">invited</span>
                    </div>
                    <button
                      className="link-button link-button--danger"
                      onClick={() => revokeInvite(inv.id)}
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
