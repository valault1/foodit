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
} from "./db.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createLoginCode,
  verifyLoginCode,
  createSession,
  getSessionUser,
  destroySession,
  sendLoginCodeEmail,
  sendInviteEmail,
} from "./auth.js";

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
const isProd = process.env.NODE_ENV === "production";

// Behind Vercel's TLS proxy, so `secure` cookies work (the request reaches the
// function over HTTP but was HTTPS at the edge). See VERCEL_MIGRATION_PLAN.md A1.
app.set("trust proxy", 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Resolve the session (if any) on every request.
app.use(async (req, _res, next) => {
  try {
    req.user = (await getSessionUser(req.cookies?.[SESSION_COOKIE])) ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  next();
}

// Wrap an async route handler so rejected promises reach Express' error handler
// instead of crashing the request. (Express 4 doesn't await handlers itself.)
function wrap(
  handler: (req: Request, res: Response) => Promise<unknown>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
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
app.post(
  "/api/auth/request-code",
  wrap(async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    const code = await createLoginCode(email);
    try {
      await sendLoginCodeEmail(email, code);
    } catch (e) {
      return res
        .status(502)
        .json({ error: e instanceof Error ? e.message : "Could not send the code." });
    }
    res.json({ ok: true });
  })
);

// Step 2: verify the code, create a session, set the cookie.
app.post(
  "/api/auth/verify",
  wrap(async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    const code = String(req.body?.code ?? "").trim();
    if (!EMAIL_RE.test(email) || !code) {
      return res.status(400).json({ error: "Email and code are required." });
    }

    const result = await verifyLoginCode(email, code);
    if (!result.ok) {
      const messages: Record<string, string> = {
        no_code: "That code has expired or was already used. Request a new one.",
        expired: "That code has expired. Request a new one.",
        too_many_attempts: "Too many attempts. Request a new code.",
        wrong_code: "That code isn't right. Check it and try again.",
      };
      return res.status(400).json({ error: messages[result.reason] });
    }

    const token = await createSession(result.user.id);
    setSessionCookie(res, token);
    res.json({ user: publicUser(result.user) });
  })
);

app.post(
  "/api/auth/logout",
  wrap(async (req, res) => {
    await destroySession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  })
);

// Current user + their household.
app.get(
  "/api/me",
  wrap(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    const household = await getHousehold(req.user.householdId);
    res.json({ user: publicUser(req.user), household });
  })
);

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

app.get(
  "/api/household",
  requireAuth,
  wrap(async (req, res) => {
    const hid = req.user!.householdId;
    res.json({
      household: await getHousehold(hid),
      members: (await listHouseholdMembers(hid)).map(publicUser),
      invites: req.user!.role === "admin" ? await listPendingInvites(hid) : [],
    });
  })
);

app.post(
  "/api/household/invites",
  requireAuth,
  wrap(async (req, res) => {
    if (req.user!.role !== "admin") {
      return res.status(403).json({ error: "Only an admin can invite people." });
    }
    const email = String(req.body?.email ?? "").trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    const role = req.body?.role === "admin" ? "admin" : "member";

    const existing = await getUserByEmail(email);
    if (existing) {
      if (existing.householdId === req.user!.householdId) {
        return res
          .status(409)
          .json({ error: "That person is already in your household." });
      }
      return res
        .status(409)
        .json({ error: "That email already belongs to another household." });
    }

    const invite = await createInvite(req.user!.householdId, email, role, req.user!.id);

    // The invite is already valid without the email — on first login the pending
    // invite is what puts them in the household (ADR-005). So a delivery failure
    // is reported as a warning rather than failing the request and stranding a
    // row the admin can't see the outcome of.
    let emailed = true;
    let warning: string | undefined;
    try {
      const household = await getHousehold(req.user!.householdId);
      await sendInviteEmail(email, {
        householdName: household?.name ?? "your household",
        invitedByEmail: req.user!.email,
      });
    } catch (e) {
      console.error("[foodit] Invite email failed:", e);
      emailed = false;
      warning =
        "The invite was created, but we couldn't email them. Ask them to sign in with this address.";
    }

    res.status(201).json({ invite, emailed, warning });
  })
);

app.delete(
  "/api/household/invites/:id",
  requireAuth,
  wrap(async (req, res) => {
    if (req.user!.role !== "admin") {
      return res.status(403).json({ error: "Only an admin can manage invites." });
    }
    const ok = await deleteInvite(req.user!.householdId, req.params.id);
    if (!ok) return res.status(404).json({ error: "Invite not found" });
    res.status(204).end();
  })
);

// ============================================================================
// Recipes (scoped to the signed-in user's household)
// ============================================================================

app.get(
  "/api/recipes",
  requireAuth,
  wrap(async (req, res) => {
    const { q, tag, category } = req.query;
    const recipes = await listRecipes(req.user!.householdId, {
      q: typeof q === "string" ? q : undefined,
      tag: typeof tag === "string" ? tag : undefined,
      category: typeof category === "string" ? category : undefined,
    });
    res.json({ recipes });
  })
);

app.get(
  "/api/tags",
  requireAuth,
  wrap(async (req, res) => {
    res.json({ tags: await listTags(req.user!.householdId) });
  })
);

app.get(
  "/api/recipes/:id",
  requireAuth,
  wrap(async (req, res) => {
    const recipe = await getRecipe(req.user!.householdId, req.params.id);
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });
    res.json({ recipe });
  })
);

app.post(
  "/api/recipes",
  requireAuth,
  wrap(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "A recipe name is required" });
    const recipe = await createRecipe(req.user!.householdId, req.body);
    res.status(201).json({ recipe });
  })
);

app.put(
  "/api/recipes/:id",
  requireAuth,
  wrap(async (req, res) => {
    if ("name" in (req.body ?? {})) {
      const name = String(req.body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "A recipe name is required" });
    }
    const recipe = await updateRecipe(req.user!.householdId, req.params.id, req.body ?? {});
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });
    res.json({ recipe });
  })
);

app.delete(
  "/api/recipes/:id",
  requireAuth,
  wrap(async (req, res) => {
    const ok = await deleteRecipe(req.user!.householdId, req.params.id);
    if (!ok) return res.status(404).json({ error: "Recipe not found" });
    res.status(204).end();
  })
);

// JSON error handler — anything thrown/rejected in a handler lands here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[foodit] Unhandled error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

export default app;
