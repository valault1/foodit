import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// --- Domain types (camelCase over the wire) ---------------------------------

export type Category = "dessert" | "side" | "entree" | "other";
export const CATEGORIES: Category[] = ["dessert", "side", "entree", "other"];

export interface Recipe {
  id: string;
  householdId: string;
  name: string;
  sourceUrl: string | null;
  category: Category;
  ingredients: string[];
  notes: string;
  rating: number | null; // 1..5 or null
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RecipeInput {
  name: string;
  sourceUrl?: string | null;
  category?: Category;
  ingredients?: string[];
  notes?: string;
  rating?: number | null;
  tags?: string[];
}

// --- Connection & schema -----------------------------------------------------

const DB_PATH = process.env.FOODIT_DB ?? join(import.meta.dir, "..", "data", "foodit.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS households (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    email        TEXT NOT NULL UNIQUE,
    name         TEXT,
    role         TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
    created_at   TEXT NOT NULL
  );

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

  CREATE INDEX IF NOT EXISTS idx_recipes_household ON recipes(household_id);

  -- Passwordless login: short-lived one-time codes emailed to a user.
  CREATE TABLE IF NOT EXISTS login_codes (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email);

  -- Long-lived sessions with sliding expiry (~90 days, refreshed on use).
  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    token_hash   TEXT NOT NULL UNIQUE,
    expires_at   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

  -- Pending invitations: an admin invites an email into their household.
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
  CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
`);

// The raw database handle, shared with the auth module (server/src/auth.ts).
export { db };

// --- Row mapping -------------------------------------------------------------

interface RecipeRow {
  id: string;
  household_id: string;
  name: string;
  source_url: string | null;
  category: string;
  ingredients: string;
  notes: string;
  rating: number | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

function rowToRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    sourceUrl: row.source_url,
    category: (row.category as Category) ?? "other",
    ingredients: safeJsonArray(row.ingredients),
    notes: row.notes ?? "",
    rating: row.rating,
    tags: safeJsonArray(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// --- Input normalization -----------------------------------------------------

function normalizeInput(input: RecipeInput) {
  const category: Category = CATEGORIES.includes(input.category as Category)
    ? (input.category as Category)
    : "other";

  let rating: number | null = null;
  if (input.rating != null) {
    const r = Math.round(Number(input.rating));
    if (Number.isFinite(r) && r >= 1 && r <= 5) rating = r;
  }

  const cleanList = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr.map((x) => String(x).trim()).filter((x) => x.length > 0)
      : [];

  return {
    name: String(input.name ?? "").trim(),
    sourceUrl: input.sourceUrl ? String(input.sourceUrl).trim() : null,
    category,
    ingredients: cleanList(input.ingredients),
    notes: typeof input.notes === "string" ? input.notes : "",
    rating,
    tags: cleanList(input.tags),
  };
}

// --- Queries -----------------------------------------------------------------

export interface ListOptions {
  q?: string;
  tag?: string;
  category?: string;
}

export function listRecipes(householdId: string, opts: ListOptions = {}): Recipe[] {
  const rows = db
    .query("SELECT * FROM recipes WHERE household_id = ? ORDER BY updated_at DESC")
    .all(householdId) as RecipeRow[];

  let recipes = rows.map(rowToRecipe);

  // Search is done in-process at household scale (see ADR-003).
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    recipes = recipes.filter((r) => {
      const haystack = [
        r.name,
        r.sourceUrl ?? "",
        r.notes,
        r.ingredients.join(" "),
        r.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  const tag = opts.tag?.trim().toLowerCase();
  if (tag) {
    recipes = recipes.filter((r) => r.tags.some((t) => t.toLowerCase() === tag));
  }

  const category = opts.category?.trim().toLowerCase();
  if (category && category !== "all") {
    recipes = recipes.filter((r) => r.category === category);
  }

  return recipes;
}

export function getRecipe(householdId: string, id: string): Recipe | null {
  const row = db
    .query("SELECT * FROM recipes WHERE household_id = ? AND id = ?")
    .get(householdId, id) as RecipeRow | null;
  return row ? rowToRecipe(row) : null;
}

export function createRecipe(householdId: string, input: RecipeInput): Recipe {
  const data = normalizeInput(input);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.query(
    `INSERT INTO recipes
       (id, household_id, name, source_url, category, ingredients, notes, rating, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    householdId,
    data.name,
    data.sourceUrl,
    data.category,
    JSON.stringify(data.ingredients),
    data.notes,
    data.rating,
    JSON.stringify(data.tags),
    now,
    now
  );

  return getRecipe(householdId, id)!;
}

export function updateRecipe(
  householdId: string,
  id: string,
  input: RecipeInput
): Recipe | null {
  const existing = getRecipe(householdId, id);
  if (!existing) return null;

  const data = normalizeInput({ ...existing, ...input });
  const now = new Date().toISOString();

  db.query(
    `UPDATE recipes SET
       name = ?, source_url = ?, category = ?, ingredients = ?,
       notes = ?, rating = ?, tags = ?, updated_at = ?
     WHERE household_id = ? AND id = ?`
  ).run(
    data.name,
    data.sourceUrl,
    data.category,
    JSON.stringify(data.ingredients),
    data.notes,
    data.rating,
    JSON.stringify(data.tags),
    now,
    householdId,
    id
  );

  return getRecipe(householdId, id);
}

export function deleteRecipe(householdId: string, id: string): boolean {
  const result = db
    .query("DELETE FROM recipes WHERE household_id = ? AND id = ?")
    .run(householdId, id);
  return result.changes > 0;
}

export function listTags(householdId: string): string[] {
  const recipes = listRecipes(householdId);
  const set = new Set<string>();
  for (const r of recipes) for (const t of r.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ============================================================================
// Auth: households, users, invites (login codes + sessions live in auth.ts)
// ============================================================================

export type Role = "admin" | "member";

export interface Household {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  householdId: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
}

export interface Invite {
  id: string;
  householdId: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  createdAt: string;
  acceptedAt: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface UserRow {
  id: string;
  household_id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    householdId: row.household_id,
    email: row.email,
    name: row.name,
    role: (row.role as Role) ?? "member",
    createdAt: row.created_at,
  };
}

export function getUserByEmail(email: string): User | null {
  const row = db
    .query("SELECT * FROM users WHERE email = ?")
    .get(normalizeEmail(email)) as UserRow | null;
  return row ? rowToUser(row) : null;
}

export function getUserById(id: string): User | null {
  const row = db.query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  return row ? rowToUser(row) : null;
}

export function listHouseholdMembers(householdId: string): User[] {
  const rows = db
    .query("SELECT * FROM users WHERE household_id = ? ORDER BY created_at ASC")
    .all(householdId) as UserRow[];
  return rows.map(rowToUser);
}

export function getHousehold(id: string): Household | null {
  const row = db.query("SELECT * FROM households WHERE id = ?").get(id) as
    | { id: string; name: string; created_at: string }
    | null;
  return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
}

/** Create a brand-new household with its first user as admin. */
export function createHouseholdWithAdmin(email: string, name?: string): User {
  const now = new Date().toISOString();
  const householdId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  const tx = db.transaction(() => {
    db.query("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
      householdId,
      name?.trim() || "My Household",
      now
    );
    db.query(
      "INSERT INTO users (id, household_id, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)"
    ).run(userId, householdId, normalizeEmail(email), name?.trim() || null, now);
  });
  tx();

  return getUserById(userId)!;
}

export function createUser(householdId: string, email: string, role: Role): User {
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  db.query(
    "INSERT INTO users (id, household_id, email, name, role, created_at) VALUES (?, ?, ?, NULL, ?, ?)"
  ).run(userId, householdId, normalizeEmail(email), role, now);
  return getUserById(userId)!;
}

// --- Invites ---------------------------------------------------------------

interface InviteRow {
  id: string;
  household_id: string;
  email: string;
  role: string;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
}

function rowToInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    householdId: row.household_id,
    email: row.email,
    role: (row.role as Role) ?? "member",
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  };
}

export function getPendingInviteByEmail(email: string): Invite | null {
  const row = db
    .query("SELECT * FROM invites WHERE email = ? AND accepted_at IS NULL")
    .get(normalizeEmail(email)) as InviteRow | null;
  return row ? rowToInvite(row) : null;
}

export function createInvite(
  householdId: string,
  email: string,
  role: Role,
  invitedBy: string
): Invite {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  // Re-inviting the same email refreshes the pending invite rather than erroring.
  db.query(
    `INSERT INTO invites (id, household_id, email, role, invited_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(household_id, email) DO UPDATE SET
       role = excluded.role, invited_by = excluded.invited_by,
       created_at = excluded.created_at, accepted_at = NULL`
  ).run(id, householdId, normalizeEmail(email), role, invitedBy, now);
  return getPendingInviteByEmail(email)!;
}

export function listPendingInvites(householdId: string): Invite[] {
  const rows = db
    .query(
      "SELECT * FROM invites WHERE household_id = ? AND accepted_at IS NULL ORDER BY created_at ASC"
    )
    .all(householdId) as InviteRow[];
  return rows.map(rowToInvite);
}

export function markInviteAccepted(householdId: string, email: string): void {
  db.query(
    "UPDATE invites SET accepted_at = ? WHERE household_id = ? AND email = ?"
  ).run(new Date().toISOString(), householdId, normalizeEmail(email));
}

export function deleteInvite(householdId: string, id: string): boolean {
  const result = db
    .query("DELETE FROM invites WHERE household_id = ? AND id = ? AND accepted_at IS NULL")
    .run(householdId, id);
  return result.changes > 0;
}
