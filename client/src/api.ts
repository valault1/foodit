import type {
  AppInvite,
  AuthUser,
  Household,
  HouseholdInfo,
  Invite,
  Membership,
  Recipe,
  RecipeInput,
  Role,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include", // send/receive the session cookie
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

/** The invite row, plus whether the notification email actually went out. */
export interface CreateInviteResult {
  invite: Invite;
  emailed: boolean;
  warning?: string;
}

export interface CreateAppInviteResult {
  appInvite: AppInvite;
  emailed: boolean;
  warning?: string;
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

  // --- Auth ---------------------------------------------------------------

  me(): Promise<{ user: AuthUser | null; household?: Household | null }> {
    return request("/me");
  },

  requestCode(email: string): Promise<{ ok: true }> {
    return request("/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  verifyCode(email: string, code: string): Promise<AuthUser> {
    return request<{ user: AuthUser }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }).then((r) => r.user);
  },

  logout(): Promise<void> {
    return request("/auth/logout", { method: "POST" });
  },

  // --- Household ----------------------------------------------------------

  getHousehold(): Promise<HouseholdInfo> {
    return request("/household");
  },

  createInvite(email: string, role: Role): Promise<CreateInviteResult> {
    return request<CreateInviteResult>("/household/invites", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
  },

  deleteInvite(id: string): Promise<void> {
    return request<void>(`/household/invites/${id}`, { method: "DELETE" });
  },

  // --- Households you belong to ---

  activateHousehold(householdId: string): Promise<Household> {
    return request<{ household: Household }>(`/households/${householdId}/activate`, {
      method: "POST",
    }).then((r) => r.household);
  },

  createHousehold(name: string): Promise<Membership> {
    return request<{ membership: Membership }>("/households", {
      method: "POST",
      body: JSON.stringify({ name }),
    }).then((r) => r.membership);
  },

  renameHousehold(householdId: string, name: string): Promise<Household> {
    return request<{ household: Household }>(`/households/${householdId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }).then((r) => r.household);
  },

  /** Resolves to the household the user landed on afterwards (may be new). */
  deleteHousehold(householdId: string): Promise<string | null> {
    return request<{ activeHouseholdId: string | null }>(`/households/${householdId}`, {
      method: "DELETE",
    }).then((r) => r.activeHouseholdId);
  },

  acceptInvite(inviteId: string): Promise<Household> {
    return request<{ household: Household }>(`/household/invites/${inviteId}/accept`, {
      method: "POST",
    }).then((r) => r.household);
  },

  // --- App invites (super admin only) ---

  listAppInvites(): Promise<AppInvite[]> {
    return request<{ appInvites: AppInvite[] }>("/app-invites").then((r) => r.appInvites);
  },

  createAppInvite(email: string): Promise<CreateAppInviteResult> {
    return request<CreateAppInviteResult>("/app-invites", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  deleteAppInvite(id: string): Promise<void> {
    return request<void>(`/app-invites/${id}`, { method: "DELETE" });
  },
};
