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

  // `household_id` and `role` here are LEGACY (pre-ADR-011) and are not written
  // by the application any more — membership lives in `household_members`, and
  // app-level power in `users.is_super_admin`. They stay in the CREATE so that a
  // fresh database ends up structurally identical to a migrated one;
  // `migrateToMultiHousehold` below drops their NOT NULL. Safe to delete both
  // columns (and this note) once no deploy can roll back past ADR-011.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      household_id TEXT REFERENCES households(id),
      email        TEXT NOT NULL UNIQUE,
      name         TEXT,
      role         TEXT NOT NULL DEFAULT 'member',
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

  await migrateToMultiHousehold(pool);
}

/**
 * ADR-011: a user belongs to many households.
 *
 * Membership moved off `users` (one `household_id` + one `role`) into a
 * `household_members` join table, `role` became per-household, and the
 * app-level `super_admin` role became a `users.is_super_admin` flag — it was
 * never a household role, and with roles now scoped per household it could not
 * stay in that column.
 *
 * Written to be re-runnable and safe against a populated database: every step
 * is `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / idempotent UPDATE. The legacy
 * `users.household_id` and `users.role` columns are deliberately *not* dropped
 * — only made nullable — so that a rollback to the previous deploy still finds
 * the data it expects. They are dead weight; drop them once this has stuck.
 */
async function migrateToMultiHousehold(pool: VercelPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS household_members (
      household_id TEXT NOT NULL REFERENCES households(id),
      user_id      TEXT NOT NULL REFERENCES users(id),
      role         TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
      created_at   TEXT NOT NULL,
      PRIMARY KEY (household_id, user_id)
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_household_members_user ON household_members(user_id);"
  );

  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;"
  );
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_household_id TEXT REFERENCES households(id);"
  );

  // Pre-existing rows carry the old shape; new rows never populate these.
  const legacy = await columnExists(pool, "users", "household_id");
  if (legacy) {
    // Every current user is a member of the household they were pinned to.
    // 'super_admin' was only ever held by someone who ran their own household,
    // so it maps to household 'admin'.
    await pool.query(`
      INSERT INTO household_members (household_id, user_id, role, created_at)
      SELECT household_id, id,
             CASE WHEN role IN ('admin', 'super_admin') THEN 'admin' ELSE 'member' END,
             created_at
      FROM users
      WHERE household_id IS NOT NULL
      ON CONFLICT (household_id, user_id) DO NOTHING;
    `);
    await pool.query(`
      UPDATE users SET is_super_admin = TRUE
      WHERE role = 'super_admin' AND is_super_admin = FALSE;
    `);
    await pool.query(`
      UPDATE users SET active_household_id = household_id
      WHERE active_household_id IS NULL AND household_id IS NOT NULL;
    `);
    // New users are created without these; the NOT NULL would reject them.
    await pool.query("ALTER TABLE users ALTER COLUMN household_id DROP NOT NULL;");
  }
}

async function columnExists(
  pool: VercelPool,
  table: string,
  column: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}
