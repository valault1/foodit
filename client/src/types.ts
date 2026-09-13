// Domain types shared across the client. Keep in sync with the server (server/src/db.ts).

export type Category = "dessert" | "side" | "entree" | "other";

export const CATEGORIES: Category[] = ["dessert", "side", "entree", "other"];

export const CATEGORY_LABELS: Record<Category, string> = {
  dessert: "Dessert",
  side: "Side",
  entree: "Entree",
  other: "Other",
};

export interface Recipe {
  id: string;
  householdId: string;
  name: string;
  sourceUrl: string | null;
  category: Category;
  ingredients: string[];
  notes: string;
  rating: number | null;
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

// --- Auth ------------------------------------------------------------------

export type Role = "admin" | "member";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  householdId: string;
}

export interface Household {
  id: string;
  name: string;
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

export interface HouseholdInfo {
  household: Household | null;
  members: AuthUser[];
  invites: Invite[];
}
