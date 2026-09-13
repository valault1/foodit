import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import {
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  listTags,
  getHousehold,
  listHouseholdMembers,
  listPendingInvites,
  createInvite,
  deleteInvite,
  getUserByEmail,
  type User,
} from "./db.ts";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createLoginCode,
  verifyLoginCode,
  createSession,
  getSessionUser,
  destroySession,
  sendLoginCodeEmail,
} from "./auth.ts";

// Make the authenticated user available on the request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const isProd = process.env.NODE_ENV === "production";

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Resolve the session (if any) on every request.
app.use((req, _res, next) => {
  req.user = getSessionUser(req.cookies?.[SESSION_COOKIE]) ?? undefined;
  next();
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  next();
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================================
// Health
// ============================================================================

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ============================================================================
// Auth
// ============================================================================

// Step 1: request a login code by email.
app.post("/api/auth/request-code", async (req, res) => {
  const email = String(req.body?.email ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  const code = createLoginCode(email);
  try {
    await sendLoginCodeEmail(email, code);
  } catch (e) {
    return res
      .status(502)
      .json({ error: e instanceof Error ? e.message : "Could not send the code." });
  }
  res.json({ ok: true });
});

// Step 2: verify the code, create a session, set the cookie.
app.post("/api/auth/verify", (req, res) => {
  const email = String(req.body?.email ?? "").trim();
  const code = String(req.body?.code ?? "").trim();
  if (!EMAIL_RE.test(email) || !code) {
    return res.status(400).json({ error: "Email and code are required." });
  }

  const result = verifyLoginCode(email, code);
  if (!result.ok) {
    const messages: Record<string, string> = {
      no_code: "That code has expired or was already used. Request a new one.",
      expired: "That code has expired. Request a new one.",
      too_many_attempts: "Too many attempts. Request a new code.",
      wrong_code: "That code isn't right. Check it and try again.",
    };
    return res.status(400).json({ error: messages[result.reason] });
  }

  const token = createSession(result.user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(result.user) });
});

app.post("/api/auth/logout", (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

// Current user + their household.
app.get("/api/me", (req, res) => {
  if (!req.user) return res.json({ user: null });
  const household = getHousehold(req.user.householdId);
  res.json({ user: publicUser(req.user), household });
});

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    householdId: user.householdId,
  };
}

// ============================================================================
// Household (members + invites)
// ============================================================================

app.get("/api/household", requireAuth, (req, res) => {
  const hid = req.user!.householdId;
  res.json({
    household: getHousehold(hid),
    members: listHouseholdMembers(hid).map(publicUser),
    invites: req.user!.role === "admin" ? listPendingInvites(hid) : [],
  });
});

app.post("/api/household/invites", requireAuth, (req, res) => {
  if (req.user!.role !== "admin") {
    return res.status(403).json({ error: "Only an admin can invite people." });
  }
  const email = String(req.body?.email ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  const role = req.body?.role === "admin" ? "admin" : "member";

  const existing = getUserByEmail(email);
  if (existing) {
    if (existing.householdId === req.user!.householdId) {
      return res.status(409).json({ error: "That person is already in your household." });
    }
    return res
      .status(409)
      .json({ error: "That email already belongs to another household." });
  }

  const invite = createInvite(req.user!.householdId, email, role, req.user!.id);
  res.status(201).json({ invite });
});

app.delete("/api/household/invites/:id", requireAuth, (req, res) => {
  if (req.user!.role !== "admin") {
    return res.status(403).json({ error: "Only an admin can manage invites." });
  }
  const ok = deleteInvite(req.user!.householdId, req.params.id);
  if (!ok) return res.status(404).json({ error: "Invite not found" });
  res.status(204).end();
});

// ============================================================================
// Recipes (scoped to the signed-in user's household)
// ============================================================================

app.get("/api/recipes", requireAuth, (req, res) => {
  const { q, tag, category } = req.query;
  const recipes = listRecipes(req.user!.householdId, {
    q: typeof q === "string" ? q : undefined,
    tag: typeof tag === "string" ? tag : undefined,
    category: typeof category === "string" ? category : undefined,
  });
  res.json({ recipes });
});

app.get("/api/tags", requireAuth, (req, res) => {
  res.json({ tags: listTags(req.user!.householdId) });
});

app.get("/api/recipes/:id", requireAuth, (req, res) => {
  const recipe = getRecipe(req.user!.householdId, req.params.id);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  res.json({ recipe });
});

app.post("/api/recipes", requireAuth, (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "A recipe name is required" });
  const recipe = createRecipe(req.user!.householdId, req.body);
  res.status(201).json({ recipe });
});

app.put("/api/recipes/:id", requireAuth, (req, res) => {
  if ("name" in (req.body ?? {})) {
    const name = String(req.body.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "A recipe name is required" });
  }
  const recipe = updateRecipe(req.user!.householdId, req.params.id, req.body ?? {});
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  res.json({ recipe });
});

app.delete("/api/recipes/:id", requireAuth, (req, res) => {
  const ok = deleteRecipe(req.user!.householdId, req.params.id);
  if (!ok) return res.status(404).json({ error: "Recipe not found" });
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
