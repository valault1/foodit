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
