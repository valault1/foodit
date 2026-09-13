import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  pool,
  getUserByEmail,
  getPendingInviteByEmail,
  getPendingAppInviteByEmail,
  markAppInviteAccepted,
  createUser,
  createHouseholdWithAdmin,
  markInviteAccepted,
  getUserById,
  setUserRole,
  type User,
} from "./db.js";

// --- Tunables ----------------------------------------------------------------

const CODE_TTL_MS = 10 * 60 * 1000; // login codes valid for 10 minutes
const MAX_CODE_ATTEMPTS = 5; // wrong guesses before a code is burned
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const SESSION_COOKIE = "foodit_session";

// --- Small crypto helpers ----------------------------------------------------

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function generateCode(): string {
  // 6-digit numeric code, zero-padded.
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// --- Super admins ------------------------------------------------------------

/**
 * App-level owners, by email (comma-separated in FOODIT_SUPER_ADMINS).
 *
 * The env var — not the database — is the source of truth, so a super admin can
 * always get back in even against an empty database. Without this, the
 * invite-only gate below would lock everyone out of a fresh deploy: there'd be
 * no user to issue the first invite.
 */
const SUPER_ADMIN_EMAILS = new Set(
  (process.env.FOODIT_SUPER_ADMINS ?? "valault1@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export function isSuperAdminEmail(email: string): boolean {
  return SUPER_ADMIN_EMAILS.has(normalizeEmail(email));
}

/**
 * Signup is invite-only (ADR-010). An email may sign in if it already has an
 * account, was invited to a household, was invited to the app by a super admin,
 * or is itself a super admin.
 */
export async function canSignIn(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (isSuperAdminEmail(normalized)) return true;
  if (await getUserByEmail(normalized)) return true;
  if (await getPendingInviteByEmail(normalized)) return true;
  if (await getPendingAppInviteByEmail(normalized)) return true;
  return false;
}

// --- Login codes -------------------------------------------------------------

/**
 * Create a fresh login code for an email, invalidating any earlier ones.
 * Returns the plaintext code so the caller can deliver it.
 */
export async function createLoginCode(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  const now = Date.now();

  // Burn any outstanding codes for this email.
  await pool.query("DELETE FROM login_codes WHERE email = $1", [normalized]);

  const code = generateCode();
  await pool.query(
    `INSERT INTO login_codes (id, email, code_hash, expires_at, attempts, created_at)
     VALUES ($1, $2, $3, $4, 0, $5)`,
    [
      crypto.randomUUID(),
      normalized,
      sha256(code),
      new Date(now + CODE_TTL_MS).toISOString(),
      new Date(now).toISOString(),
    ]
  );

  return code;
}

interface CodeRow {
  id: string;
  email: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
}

export type VerifyResult =
  | { ok: true; user: User }
  | { ok: false; reason: "no_code" | "expired" | "too_many_attempts" | "wrong_code" };

/**
 * Verify a submitted code. On success, resolves the user — creating one if this
 * is a self-serve first login or an invited email accepting their invite.
 */
export async function verifyLoginCode(
  email: string,
  submitted: string
): Promise<VerifyResult> {
  const normalized = normalizeEmail(email);
  const { rows } = await pool.query(
    "SELECT * FROM login_codes WHERE email = $1 AND consumed_at IS NULL",
    [normalized]
  );
  const row = (rows as CodeRow[])[0] ?? null;

  if (!row) return { ok: false, reason: "no_code" };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query("DELETE FROM login_codes WHERE id = $1", [row.id]);
    return { ok: false, reason: "expired" };
  }

  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    await pool.query("DELETE FROM login_codes WHERE id = $1", [row.id]);
    return { ok: false, reason: "too_many_attempts" };
  }

  const matches = constantTimeEqual(row.code_hash, sha256(submitted.trim()));
  if (!matches) {
    await pool.query(
      "UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1",
      [row.id]
    );
    return { ok: false, reason: "wrong_code" };
  }

  // Success — consume the code and resolve the user.
  await pool.query("UPDATE login_codes SET consumed_at = $1 WHERE id = $2", [
    new Date().toISOString(),
    row.id,
  ]);

  const user = await resolveUserOnLogin(normalized);
  return { ok: true, user };
}

/** Raised when an uninvited email completes the code challenge (ADR-010). */
export class SignupNotAllowedError extends Error {
  constructor() {
    super("You need an invite to use foodit. Ask someone to invite you.");
    this.name = "SignupNotAllowedError";
  }
}

/**
 * Existing user → itself (role re-synced against the allowlist). Household
 * invite → new member of that household. App invite or super admin → their own
 * new household. Anyone else is rejected: signup is invite-only (ADR-010).
 */
async function resolveUserOnLogin(email: string): Promise<User> {
  const superAdmin = isSuperAdminEmail(email);

  const existing = await getUserByEmail(email);
  if (existing) return syncSuperAdminRole(existing, superAdmin);

  const invite = await getPendingInviteByEmail(email);
  if (invite) {
    const user = await createUser(invite.householdId, email, invite.role);
    await markInviteAccepted(invite.householdId, email);
    return syncSuperAdminRole(user, superAdmin);
  }

  const appInvite = await getPendingAppInviteByEmail(email);
  if (appInvite) {
    // Invited to the app, not to a household — they get their own (ADR-010).
    const user = await createHouseholdWithAdmin(email, undefined, "admin");
    await markAppInviteAccepted(email);
    return syncSuperAdminRole(user, superAdmin);
  }

  // A super admin with no account yet bootstraps their own household.
  if (superAdmin) return createHouseholdWithAdmin(email, undefined, "super_admin");

  throw new SignupNotAllowedError();
}

/**
 * Reconcile a user's stored role with the allowlist. Demotion targets "admin",
 * never "member": super_admin already implied household admin, so this can only
 * remove app-level power, never grant more inside a household.
 */
async function syncSuperAdminRole(user: User, shouldBeSuper: boolean): Promise<User> {
  if (shouldBeSuper && user.role !== "super_admin") {
    await setUserRole(user.id, "super_admin");
    return { ...user, role: "super_admin" };
  }
  if (!shouldBeSuper && user.role === "super_admin") {
    await setUserRole(user.id, "admin");
    return { ...user, role: "admin" };
  }
  return user;
}

// --- Sessions ----------------------------------------------------------------

/** Create a session and return the plaintext token to store in the cookie. */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      crypto.randomUUID(),
      userId,
      sha256(token),
      new Date(now + SESSION_TTL_MS).toISOString(),
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    ]
  );
  return token;
}

/**
 * Resolve the user for a session token, sliding the expiry forward (so active
 * users stay logged in indefinitely; inactive ones lapse after 90 days).
 */
export async function getSessionUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;

  const { rows } = await pool.query(
    "SELECT * FROM sessions WHERE token_hash = $1",
    [sha256(token)]
  );
  const row =
    (rows as { id: string; user_id: string; expires_at: string }[])[0] ?? null;
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [row.id]);
    return null;
  }

  const now = Date.now();
  await pool.query(
    "UPDATE sessions SET expires_at = $1, last_used_at = $2 WHERE id = $3",
    [
      new Date(now + SESSION_TTL_MS).toISOString(),
      new Date(now).toISOString(),
      row.id,
    ]
  );

  return getUserById(row.user_id);
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

// --- Email delivery (Resend, with a console fallback for local dev) ----------

const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();
const FROM_EMAIL = process.env.FOODIT_FROM_EMAIL?.trim() || "foodit <onboarding@resend.dev>";
const APP_URL = process.env.FOODIT_APP_URL?.trim() || "http://localhost:3000";

/**
 * POST one email through Resend. Returns false when no key is configured, so
 * callers can fall back to logging instead (see ADR-007); throws if Resend
 * itself rejects the send.
 */
async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
  failureMessage: string;
}): Promise<boolean> {
  if (!RESEND_API_KEY) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[foodit] Resend error ${res.status}: ${body}`);
    throw new Error(message.failureMessage);
  }
  return true;
}

export async function sendLoginCodeEmail(email: string, code: string): Promise<void> {
  try {
    const sent = await sendEmail({
      to: email,
      subject: `Your foodit login code: ${code}`,
      text: `Your foodit login code is ${code}. It expires in 10 minutes.`,
      html: loginEmailHtml(code),
      failureMessage: "Could not send the login email. Please try again.",
    });
    // Dev stub: no key configured, so print the code instead of emailing it.
    if (!sent) console.log(`\n  [foodit] Login code for ${email}: ${code}\n`);
  } catch (err) {
    // Log the code too, so a Resend outage doesn't block local development.
    console.log(`  [foodit] Login code for ${email}: ${code}`);
    throw err;
  }
}

export interface InviteEmailOptions {
  /** Household the invitee is being added to, for the email body. */
  householdName: string;
  /** Email of the admin who sent the invite. */
  invitedByEmail: string;
}

/**
 * Tell an invited email that they can now sign in and land in the household.
 * There is no invite token — ADR-005 resolves the pending invite on first
 * login — so this email carries no secret and is safe to re-send.
 */
export async function sendInviteEmail(
  email: string,
  { householdName, invitedByEmail }: InviteEmailOptions
): Promise<void> {
  // Link to the app root, not a /login path: signed-out visitors get the login
  // screen at any route, and after signing in the root is where they belong
  // (there is no /login route once authenticated — it would 404).
  const signInUrl = APP_URL.replace(/\/$/, "") || APP_URL;
  const sent = await sendEmail({
    to: email,
    subject: `${invitedByEmail} invited you to ${householdName} on foodit`,
    text:
      `${invitedByEmail} invited you to join "${householdName}" on foodit, ` +
      `a shared recipe collection.\n\n` +
      `Sign in with this email address (${email}) to join: ${signInUrl}\n\n` +
      `You'll get a one-time code to finish signing in — no password needed.`,
    html: inviteEmailHtml({ householdName, invitedByEmail, email, signInUrl }),
    failureMessage: "Could not send the invite email.",
  });

  if (!sent) {
    // Dev stub: mirrors the login-code fallback so local dev works with no key.
    console.log(
      `\n  [foodit] Invite for ${email} to "${householdName}" — sign in at ${signInUrl}\n`
    );
  }
}

function loginEmailHtml(code: string): string {
  return `
  <div style="font-family: system-ui, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 20px; margin: 0 0 8px;">Sign in to foodit</h1>
    <p style="color: #555; margin: 0 0 20px;">Enter this code to finish signing in. It expires in 10 minutes.</p>
    <div style="font-size: 34px; font-weight: 700; letter-spacing: 8px; text-align: center;
                background: #f4f2ee; border-radius: 12px; padding: 18px;">${code}</div>
    <p style="color: #999; font-size: 12px; margin: 20px 0 0;">
      If you didn't request this, you can safely ignore this email.
    </p>
  </div>`;
}

/**
 * Tell someone a super admin has opened the app to them. Unlike a household
 * invite this grants no membership — on first login they get their own
 * household (ADR-010).
 */
export async function sendAppInviteEmail(
  email: string,
  invitedByEmail: string
): Promise<void> {
  const signInUrl = APP_URL.replace(/\/$/, "") || APP_URL;
  const sent = await sendEmail({
    to: email,
    subject: `You've been invited to foodit`,
    text:
      `${invitedByEmail} invited you to foodit, a place to keep your recipes.\n\n` +
      `Sign in with this email address (${email}) to get started: ${signInUrl}\n\n` +
      `You'll get a one-time code to finish signing in — no password needed. ` +
      `You'll start with your own recipe collection, and can invite others to share it.`,
    html: appInviteEmailHtml({ invitedByEmail, email, signInUrl }),
    failureMessage: "Could not send the invite email.",
  });

  if (!sent) {
    console.log(`\n  [foodit] App invite for ${email} — sign in at ${signInUrl}\n`);
  }
}

function appInviteEmailHtml(opts: {
  invitedByEmail: string;
  email: string;
  signInUrl: string;
}): string {
  return `
  <div style="font-family: system-ui, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 20px; margin: 0 0 8px;">You're invited to foodit</h1>
    <p style="color: #555; margin: 0 0 20px;">
      ${escapeHtml(opts.invitedByEmail)} invited you to foodit — a simple place to
      keep and share recipes.
    </p>
    <div style="text-align: center; margin: 0 0 20px;">
      <a href="${escapeHtml(opts.signInUrl)}"
         style="display: inline-block; background: #1f1d1a; color: #fff; text-decoration: none;
                font-weight: 600; border-radius: 12px; padding: 14px 28px;">Get started</a>
    </div>
    <p style="color: #555; margin: 0;">
      Sign in with <strong>${escapeHtml(opts.email)}</strong> and we'll email you a
      one-time code — no password needed.
    </p>
    <p style="color: #999; font-size: 12px; margin: 20px 0 0;">
      If you weren't expecting this, you can safely ignore this email.
    </p>
  </div>`;
}

function inviteEmailHtml(opts: {
  householdName: string;
  invitedByEmail: string;
  email: string;
  signInUrl: string;
}): string {
  return `
  <div style="font-family: system-ui, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 20px; margin: 0 0 8px;">You're invited to ${escapeHtml(
      opts.householdName
    )}</h1>
    <p style="color: #555; margin: 0 0 20px;">
      ${escapeHtml(opts.invitedByEmail)} invited you to share a recipe collection on foodit.
    </p>
    <div style="text-align: center; margin: 0 0 20px;">
      <a href="${escapeHtml(opts.signInUrl)}"
         style="display: inline-block; background: #1f1d1a; color: #fff; text-decoration: none;
                font-weight: 600; border-radius: 12px; padding: 14px 28px;">Join the household</a>
    </div>
    <p style="color: #555; margin: 0;">
      Sign in with <strong>${escapeHtml(opts.email)}</strong> and we'll email you a
      one-time code — no password needed.
    </p>
    <p style="color: #999; font-size: 12px; margin: 20px 0 0;">
      If you weren't expecting this, you can safely ignore this email.
    </p>
  </div>`;
}

/** Invite emails interpolate user-controlled text (household name, emails). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
