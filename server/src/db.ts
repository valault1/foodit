import { createPool } from "@vercel/postgres";

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

// --- Connection --------------------------------------------------------------
//
// A single pooled client, built for serverless: `createPool()` reads
// `POSTGRES_URL` from the environment (Vercel injects it in production; locally
// it comes from `server/.env` — see VERCEL_MIGRATION_PLAN.md A6). The pool is
// safe to hold at module scope and shared with the auth module (auth.ts).
// Schema DDL lives in schema.ts and runs once via `bun run migrate` — never on
// the request path. See ADR-008.

export const pool = createPool();

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

export async function listRecipes(
  householdId: string,
  opts: ListOptions = {}
): Promise<Recipe[]> {
  const { rows } = await pool.query(
    "SELECT * FROM recipes WHERE household_id = $1 ORDER BY updated_at DESC",
    [householdId]
  );

  let recipes = (rows as RecipeRow[]).map(rowToRecipe);

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

export async function getRecipe(householdId: string, id: string): Promise<Recipe | null> {
  const { rows } = await pool.query(
    "SELECT * FROM recipes WHERE household_id = $1 AND id = $2",
    [householdId, id]
  );
  const row = (rows as RecipeRow[])[0] ?? null;
  return row ? rowToRecipe(row) : null;
}

export async function createRecipe(
  householdId: string,
  input: RecipeInput
): Promise<Recipe> {
  const data = normalizeInput(input);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await pool.query(
    `INSERT INTO recipes
       (id, household_id, name, source_url, category, ingredients, notes, rating, tags, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
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
      now,
    ]
  );

  return (await getRecipe(householdId, id))!;
}

export async function updateRecipe(
  householdId: string,
  id: string,
  input: RecipeInput
): Promise<Recipe | null> {
  const existing = await getRecipe(householdId, id);
  if (!existing) return null;

  const data = normalizeInput({ ...existing, ...input });
  const now = new Date().toISOString();

  await pool.query(
    `UPDATE recipes SET
       name = $1, source_url = $2, category = $3, ingredients = $4,
       notes = $5, rating = $6, tags = $7, updated_at = $8
     WHERE household_id = $9 AND id = $10`,
    [
      data.name,
      data.sourceUrl,
      data.category,
      JSON.stringify(data.ingredients),
      data.notes,
      data.rating,
      JSON.stringify(data.tags),
      now,
      householdId,
      id,
    ]
  );

  return getRecipe(householdId, id);
}

export async function deleteRecipe(householdId: string, id: string): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM recipes WHERE household_id = $1 AND id = $2",
    [householdId, id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listTags(householdId: string): Promise<string[]> {
  const recipes = await listRecipes(householdId);
  const set = new Set<string>();
  for (const r of recipes) for (const t of r.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ============================================================================
// Auth: households, users, invites (login codes + sessions live in auth.ts)
// ============================================================================

/**
 * `super_admin` is app-level (see ADR-010): it implies household `admin`
 * everywhere, and additionally allows inviting people to the app itself. Use
 * `isHouseholdAdmin` rather than comparing to "admin" directly.
 */
export type Role = "super_admin" | "admin" | "member";

export function isHouseholdAdmin(user: { role: Role }): boolean {
  return user.role === "admin" || user.role === "super_admin";
}

export function isSuperAdmin(user: { role: Role }): boolean {
  return user.role === "super_admin";
}

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

export async function getUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [
    normalizeEmail(email),
  ]);
  const row = (rows as UserRow[])[0] ?? null;
  return row ? rowToUser(row) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  const row = (rows as UserRow[])[0] ?? null;
  return row ? rowToUser(row) : null;
}

export async function listHouseholdMembers(householdId: string): Promise<User[]> {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE household_id = $1 ORDER BY created_at ASC",
    [householdId]
  );
  return (rows as UserRow[]).map(rowToUser);
}

export async function getHousehold(id: string): Promise<Household | null> {
  const { rows } = await pool.query("SELECT * FROM households WHERE id = $1", [id]);
  const row = (rows as { id: string; name: string; created_at: string }[])[0] ?? null;
  return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
}

/**
 * Create a brand-new household with its first user as its admin. `role` lets a
 * super admin bootstrap their own household without being demoted to "admin".
 */
export async function createHouseholdWithAdmin(
  email: string,
  name?: string,
  role: Role = "admin"
): Promise<User> {
  const now = new Date().toISOString();
  const householdId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO households (id, name, created_at) VALUES ($1, $2, $3)",
      [householdId, name?.trim() || "My Household", now]
    );
    await client.query(
      "INSERT INTO users (id, household_id, email, name, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [userId, householdId, normalizeEmail(email), name?.trim() || null, role, now]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return (await getUserById(userId))!;
}

export async function createUser(
  householdId: string,
  email: string,
  role: Role
): Promise<User> {
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users (id, household_id, email, name, role, created_at) VALUES ($1, $2, $3, NULL, $4, $5)",
    [userId, householdId, normalizeEmail(email), role, now]
  );
  return (await getUserById(userId))!;
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

export async function getPendingInviteByEmail(email: string): Promise<Invite | null> {
  const { rows } = await pool.query(
    "SELECT * FROM invites WHERE email = $1 AND accepted_at IS NULL",
    [normalizeEmail(email)]
  );
  const row = (rows as InviteRow[])[0] ?? null;
  return row ? rowToInvite(row) : null;
}

export async function createInvite(
  householdId: string,
  email: string,
  role: Role,
  invitedBy: string
): Promise<Invite> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  // Re-inviting the same email refreshes the pending invite rather than erroring.
  await pool.query(
    `INSERT INTO invites (id, household_id, email, role, invited_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(household_id, email) DO UPDATE SET
       role = excluded.role, invited_by = excluded.invited_by,
       created_at = excluded.created_at, accepted_at = NULL`,
    [id, householdId, normalizeEmail(email), role, invitedBy, now]
  );
  return (await getPendingInviteByEmail(email))!;
}

export async function listPendingInvites(householdId: string): Promise<Invite[]> {
  const { rows } = await pool.query(
    "SELECT * FROM invites WHERE household_id = $1 AND accepted_at IS NULL ORDER BY created_at ASC",
    [householdId]
  );
  return (rows as InviteRow[]).map(rowToInvite);
}

export async function markInviteAccepted(
  householdId: string,
  email: string
): Promise<void> {
  await pool.query(
    "UPDATE invites SET accepted_at = $1 WHERE household_id = $2 AND email = $3",
    [new Date().toISOString(), householdId, normalizeEmail(email)]
  );
}

/** Keep a user's stored role in sync with the super-admin allowlist. */
export async function setUserRole(userId: string, role: Role): Promise<void> {
  await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, userId]);
}

// --- App invites (super-admin only) -----------------------------------------

export interface AppInvite {
  id: string;
  email: string;
  invitedBy: string | null;
  createdAt: string;
  acceptedAt: string | null;
}

interface AppInviteRow {
  id: string;
  email: string;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
}

function rowToAppInvite(row: AppInviteRow): AppInvite {
  return {
    id: row.id,
    email: row.email,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  };
}

export async function getPendingAppInviteByEmail(
  email: string
): Promise<AppInvite | null> {
  const { rows } = await pool.query(
    "SELECT * FROM app_invites WHERE email = $1 AND accepted_at IS NULL",
    [normalizeEmail(email)]
  );
  const row = (rows as AppInviteRow[])[0] ?? null;
  return row ? rowToAppInvite(row) : null;
}

export async function createAppInvite(
  email: string,
  invitedBy: string
): Promise<AppInvite> {
  const now = new Date().toISOString();
  // Re-inviting the same email refreshes the pending invite rather than erroring.
  await pool.query(
    `INSERT INTO app_invites (id, email, invited_by, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(email) DO UPDATE SET
       invited_by = excluded.invited_by, created_at = excluded.created_at,
       accepted_at = NULL`,
    [crypto.randomUUID(), normalizeEmail(email), invitedBy, now]
  );
  return (await getPendingAppInviteByEmail(email))!;
}

export async function listPendingAppInvites(): Promise<AppInvite[]> {
  const { rows } = await pool.query(
    "SELECT * FROM app_invites WHERE accepted_at IS NULL ORDER BY created_at ASC"
  );
  return (rows as AppInviteRow[]).map(rowToAppInvite);
}

export async function markAppInviteAccepted(email: string): Promise<void> {
  await pool.query("UPDATE app_invites SET accepted_at = $1 WHERE email = $2", [
    new Date().toISOString(),
    normalizeEmail(email),
  ]);
}

export async function deleteAppInvite(id: string): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM app_invites WHERE id = $1 AND accepted_at IS NULL",
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteInvite(householdId: string, id: string): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM invites WHERE household_id = $1 AND id = $2 AND accepted_at IS NULL",
    [householdId, id]
  );
  return (result.rowCount ?? 0) > 0;
}
