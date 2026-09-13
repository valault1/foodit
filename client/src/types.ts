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

/** A role *within a household*. App-level power is `AuthUser.isSuperAdmin`. */
export type Role = "admin" | "member";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  /** Role in the active household — changes when you switch (ADR-011). */
  role: Role;
  /** The household currently being viewed, not a fixed home. */
  householdId: string;
  isSuperAdmin: boolean;
}

/** One of the households you belong to, for the switcher. */
export interface Membership {
  householdId: string;
  name: string;
  role: Role;
  joinedAt: string;
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

/** An invite to the app itself (no household), issued by a super admin. */
export interface AppInvite {
  id: string;
  email: string;
  invitedBy: string | null;
  createdAt: string;
  acceptedAt: string | null;
}

export interface HouseholdInfo {
  household: Household | null;
  members: AuthUser[];
  invites: Invite[];
  memberships: Membership[];
  /** Invites to other households awaiting your decision. */
  pendingForMe: (Invite & { householdName: string })[];
}
