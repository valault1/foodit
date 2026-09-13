import type { Recipe, RecipeInput } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface RecipeQuery {
  q?: string;
  tag?: string;
  category?: string;
}

export const api = {
  listRecipes(query: RecipeQuery = {}): Promise<Recipe[]> {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.tag) params.set("tag", query.tag);
    if (query.category && query.category !== "all") params.set("category", query.category);
    const qs = params.toString();
    return request<{ recipes: Recipe[] }>(`/recipes${qs ? `?${qs}` : ""}`).then(
      (r) => r.recipes
    );
  },

  getRecipe(id: string): Promise<Recipe> {
    return request<{ recipe: Recipe }>(`/recipes/${id}`).then((r) => r.recipe);
  },

  createRecipe(input: RecipeInput): Promise<Recipe> {
    return request<{ recipe: Recipe }>("/recipes", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.recipe);
  },

  updateRecipe(id: string, input: Partial<RecipeInput>): Promise<Recipe> {
    return request<{ recipe: Recipe }>(`/recipes/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }).then((r) => r.recipe);
  },

  deleteRecipe(id: string): Promise<void> {
    return request<void>(`/recipes/${id}`, { method: "DELETE" });
  },

  listTags(): Promise<string[]> {
    return request<{ tags: string[] }>("/tags").then((r) => r.tags);
  },
};
