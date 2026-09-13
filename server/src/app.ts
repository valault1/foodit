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
  getUserById,
  isHouseholdAdmin,
  isSuperAdmin,
  listMemberships,
  isMember,
  addMembership,
  setActiveHousehold,
  createHouseholdFor,
  listPendingInvitesForEmail,
  getInviteById,
  markInviteAccepted,
  getMembership,
  renameHousehold,
  deleteHousehold,
  countRecipes,
  listPendingAppInvites,
  createAppInvite,
  deleteAppInvite,
  getPendingAppInviteByEmail,
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
  sendAppInviteEmail,
  canSignIn,
  SignupNotAllowedError,
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
    // Invite-only (ADR-010). Checked here as well as on verify so we never mail
    // a code to someone who could not use it.
    if (!(await canSignIn(email))) {
      return res.status(403).json({
        error: "You need an invite to use foodit. Ask someone to invite you.",
      });
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

    let result;
    try {
      result = await verifyLoginCode(email, code);
    } catch (e) {
      // The invite could have been revoked between requesting and verifying.
      if (e instanceof SignupNotAllowedError) {
        return res.status(403).json({ error: e.message });
      }
      throw e;
    }
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
    isSuperAdmin: user.isSuperAdmin,
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
      invites: isHouseholdAdmin(req.user!) ? await listPendingInvites(hid) : [],
      memberships: await listMemberships(req.user!.id),
      recipeCount: await countRecipes(hid),
      // Invites to *other* households awaiting this user's decision (ADR-011).
      pendingForMe: (await listPendingInvitesForEmail(req.user!.email)).filter(
        (i) => i.householdId !== hid
      ),
    });
  })
);

app.post(
  "/api/household/invites",
  requireAuth,
  wrap(async (req, res) => {
    if (!isHouseholdAdmin(req.user!)) {
      return res.status(403).json({ error: "Only an admin can invite people." });
    }
    const email = String(req.body?.email ?? "").trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    const role = req.body?.role === "admin" ? "admin" : "member";

    // An existing account may join a second household (ADR-011) — only an
    // existing *membership* is a conflict.
    const existing = await getUserByEmail(email);
    if (existing && (await isMember(req.user!.householdId, existing.id))) {
      return res
        .status(409)
        .json({ error: "That person is already in your household." });
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
    if (!isHouseholdAdmin(req.user!)) {
      return res.status(403).json({ error: "Only an admin can manage invites." });
    }
    const ok = await deleteInvite(req.user!.householdId, req.params.id);
    if (!ok) return res.status(404).json({ error: "Invite not found" });
    res.status(204).end();
  })
);

// ============================================================================
// Households a user belongs to: switch, create, accept an invite. See ADR-011.
// ============================================================================

app.get(
  "/api/households",
  requireAuth,
  wrap(async (req, res) => {
    res.json({
      memberships: await listMemberships(req.user!.id),
      activeHouseholdId: req.user!.householdId,
    });
  })
);

// Switch which household the rest of the API reads and writes.
app.post(
  "/api/households/:id/activate",
  requireAuth,
  wrap(async (req, res) => {
    if (!(await isMember(req.params.id, req.user!.id))) {
      return res.status(403).json({ error: "You're not a member of that household." });
    }
    await setActiveHousehold(req.user!.id, req.params.id);
    res.json({ household: await getHousehold(req.params.id) });
  })
);

// Start a brand-new household; the creator is its admin and it becomes active.
app.post(
  "/api/households",
  requireAuth,
  wrap(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "A household name is required." });
    const membership = await createHouseholdFor(req.user!.id, name);
    res.status(201).json({ membership });
  })
);

/**
 * Admin of *this* household — not of whichever one happens to be active. These
 * routes take an id, so authorization has to follow that id.
 */
async function adminOf(householdId: string, userId: string): Promise<boolean> {
  const membership = await getMembership(householdId, userId);
  return membership?.role === "admin";
}

app.patch(
  "/api/households/:id",
  requireAuth,
  wrap(async (req, res) => {
    if (!(await adminOf(req.params.id, req.user!.id))) {
      return res
        .status(403)
        .json({ error: "Only an admin of that household can rename it." });
    }
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "A household name is required." });

    const household = await renameHousehold(req.params.id, name);
    if (!household) return res.status(404).json({ error: "Household not found" });
    res.json({ household });
  })
);

app.delete(
  "/api/households/:id",
  requireAuth,
  wrap(async (req, res) => {
    if (!(await adminOf(req.params.id, req.user!.id))) {
      return res
        .status(403)
        .json({ error: "Only an admin of that household can delete it." });
    }

    await deleteHousehold(req.params.id);
    // Their active household may have just been deleted; the session layer
    // resolves the fallback, so report where they actually landed.
    const after = await getUserById(req.user!.id);
    res.json({ activeHouseholdId: after?.householdId ?? null });
  })
);

// Accept an invite addressed to you — this is how an existing account picks up
// an additional household.
app.post(
  "/api/household/invites/:id/accept",
  requireAuth,
  wrap(async (req, res) => {
    const invite = await getInviteById(req.params.id);
    if (!invite || invite.acceptedAt) {
      return res.status(404).json({ error: "That invite is no longer available." });
    }
    // Addressed to someone else — don't confirm it exists.
    if (invite.email !== req.user!.email.toLowerCase()) {
      return res.status(404).json({ error: "That invite is no longer available." });
    }

    await addMembership(invite.householdId, req.user!.id, invite.role);
    await markInviteAccepted(invite.householdId, invite.email);
    await setActiveHousehold(req.user!.id, invite.householdId);
    res.json({ household: await getHousehold(invite.householdId) });
  })
);

// ============================================================================
// App invites (super admin only) — who may sign up at all. See ADR-010.
// ============================================================================

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ error: "Only a super admin can do that." });
  }
  next();
}

app.get(
  "/api/app-invites",
  requireSuperAdmin,
  wrap(async (_req, res) => {
    res.json({ appInvites: await listPendingAppInvites() });
  })
);

app.post(
  "/api/app-invites",
  requireSuperAdmin,
  wrap(async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    if (await getUserByEmail(email)) {
      return res.status(409).json({ error: "That email already has an account." });
    }
    if (await getPendingAppInviteByEmail(email)) {
      return res.status(409).json({ error: "That email is already invited." });
    }

    const appInvite = await createAppInvite(email, req.user!.id);

    // Same rationale as household invites: the invite is what unlocks signup, so
    // a failed send is a warning, not a failed request.
    let emailed = true;
    let warning: string | undefined;
    try {
      await sendAppInviteEmail(email, req.user!.email);
    } catch (e) {
      console.error("[foodit] App invite email failed:", e);
      emailed = false;
      warning =
        "They can now sign up, but we couldn't email them. Send them the link yourself.";
    }

    res.status(201).json({ appInvite, emailed, warning });
  })
);

app.delete(
  "/api/app-invites/:id",
  requireSuperAdmin,
  wrap(async (req, res) => {
    const ok = await deleteAppInvite(req.params.id);
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
