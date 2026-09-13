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
`);

// --- Default household (until real auth lands; see ADR-004) ------------------

export const DEFAULT_HOUSEHOLD_ID = "default-household";

{
  const exists = db
    .query("SELECT id FROM households WHERE id = ?")
    .get(DEFAULT_HOUSEHOLD_ID);
  if (!exists) {
    db.query("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
      DEFAULT_HOUSEHOLD_ID,
      "My Household",
      new Date().toISOString()
    );
  }
}

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
