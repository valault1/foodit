import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  pool,
  getUserByEmail,
  getPendingInviteByEmail,
  createUser,
  createHouseholdWithAdmin,
  markInviteAccepted,
  getUserById,
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

/** Existing user → itself. Invited email → new member. Otherwise → new household admin. */
async function resolveUserOnLogin(email: string): Promise<User> {
  const existing = await getUserByEmail(email);
  if (existing) return existing;

  const invite = await getPendingInviteByEmail(email);
  if (invite) {
    const user = await createUser(invite.householdId, email, invite.role);
    await markInviteAccepted(invite.householdId, email);
    return user;
  }

  // Self-serve: first time we've seen this email → spin up their household.
  return createHouseholdWithAdmin(email);
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

export async function sendLoginCodeEmail(email: string, code: string): Promise<void> {
  if (!RESEND_API_KEY) {
    // Dev stub: no key configured, so print the code instead of emailing it.
    console.log(`\n  [foodit] Login code for ${email}: ${code}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: email,
      subject: `Your foodit login code: ${code}`,
      text: `Your foodit login code is ${code}. It expires in 10 minutes.`,
      html: loginEmailHtml(code),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // Surface the failure to the caller; also log the code so dev isn't blocked.
    console.error(`[foodit] Resend error ${res.status}: ${body}`);
    console.log(`  [foodit] Login code for ${email}: ${code}`);
    throw new Error("Could not send the login email. Please try again.");
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
