// Database schema for foodit (Postgres). Run once via `bun run migrate`
// (scripts/migrate.ts) against the target database — never on the request path.
// See VERCEL_MIGRATION_PLAN.md A3 and ADR-008.
//
// Types mirror the original SQLite schema as closely as is sensible:
//  - IDs are `text` (the app generates `crypto.randomUUID()`).
//  - Timestamps are `text` holding ISO-8601 strings (`new Date().toISOString()`).
//  - `ingredients` / `tags` are `text` holding a JSON array of strings.
//  - `rating` and `attempts` are `integer`.

import type { VercelPool } from "@vercel/postgres";

export async function migrate(pool: VercelPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS households (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id),
      email        TEXT NOT NULL UNIQUE,
      name         TEXT,
      role         TEXT NOT NULL DEFAULT 'member', -- 'super_admin' | 'admin' | 'member'
      created_at   TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      id           TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id),
      name         TEXT NOT NULL,
      source_url   TEXT,
      category     TEXT NOT NULL DEFAULT 'other',
      ingredients  TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
      notes        TEXT NOT NULL DEFAULT '',
      rating       INTEGER,                     -- 1..5 or NULL
      tags         TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_recipes_household ON recipes(household_id);"
  );

  // Passwordless login: short-lived one-time codes emailed to a user.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_codes (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL,
      code_hash   TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      consumed_at TEXT,
      created_at  TEXT NOT NULL
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email);"
  );

  // Long-lived sessions with sliding expiry (~90 days, refreshed on use).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      token_hash   TEXT NOT NULL UNIQUE,
      expires_at   TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);"
  );

  // Pending invitations: an admin invites an email into their household.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      id           TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id),
      email        TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'member',
      invited_by   TEXT REFERENCES users(id),
      created_at   TEXT NOT NULL,
      accepted_at  TEXT,
      UNIQUE(household_id, email)
    );
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);");

  // App-level invitations: a super admin lets an email sign up at all. Unlike
  // `invites` these carry no household — the invitee gets their own on first
  // login (ADR-010). Signup is invite-only, so a row here (or in `invites`, or
  // an existing user, or the super-admin allowlist) is what permits a login.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_invites (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      invited_by  TEXT REFERENCES users(id),
      created_at  TEXT NOT NULL,
      accepted_at TEXT
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_app_invites_email ON app_invites(email);"
  );
}
