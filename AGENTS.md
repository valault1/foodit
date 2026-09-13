# foodit — Agent & Architecture Notes

This file is the running memory of **why** the project is built the way it is.
Whenever we make a design decision, we record it here so the reasoning isn't lost.

> Audience: future contributors (human or AI). Keep it concise, decision-focused,
> and update it in the same change that alters the code.

---

## What foodit is

A household recipe app. Core goals:

1. **Add recipes very easily.** Each recipe has: name, a link back to the original
   source, an ingredients list, a category (dessert / side / entree / other), an
   editable notes section, an optional rating, and free-text tags for later search.
2. **Find recipes easily** — search/filter by name, source, ingredients, or tag.
3. **Households + auth.** A central admin invites other users by email. Login is
   passwordless (email code, not passwords). Sessions last ~90 days with automatic
   token refresh on activity/login.
4. **A modern, polished, simple look** — slick and clean, never cluttered.

---

## Tech stack

| Layer      | Choice                                  | Why |
|------------|-----------------------------------------|-----|
| Frontend   | React 19 + TypeScript + Vite            | Fast dev server, first-class TS, simple build. |
| Routing    | react-router-dom v7                     | Standard client routing for list/detail/form views. |
| Backend    | Express 4 (Bun locally, Node on Vercel) | Same app runs as a long-lived process in dev and as a serverless function in prod. See ADR-009. |
| Packaging  | Bun workspaces                          | Single `bun install`; one `bun run dev` runs both apps. |
| Database   | Vercel Postgres (Neon) via `@vercel/postgres` | Hosted Postgres, works on serverless with no persistent disk. Async data layer. See ADR-008 (was `bun:sqlite`, ADR-001). |
| Hosting    | Vercel — static client + serverless API | Static `client/dist` + Express-as-a-Function at `/api`. See ADR-009. |
| Styling    | Hand-written CSS design system          | Bespoke, clean look with minimal dependencies. See ADR-002. |

### Repo layout

```
foodit/
├── AGENTS.md              # this file
├── vercel.json            # Vercel build/output + /api function + SPA rewrites
├── api/
│   └── index.ts           # Vercel serverless entrypoint: `export default app`
├── package.json           # workspace root; `bun run dev` / `bun run migrate`
├── client/                # Vite + React + TS frontend (port 3000)
│   └── src/
│       ├── pages/         # route-level views
│       ├── components/    # reusable UI
│       ├── api.ts         # typed fetch wrappers
│       └── types.ts       # shared domain types
└── server/                # Express + TS backend (port 3001 in local dev)
    ├── scripts/
    │   └── migrate.ts     # one-time schema creation (`bun run migrate`)
    └── src/
        ├── app.ts         # builds + exports the Express app (routes) — importable
        ├── index.ts       # local Bun dev entrypoint: `import app; app.listen()`
        ├── schema.ts      # Postgres DDL: `migrate(pool)` (CREATE TABLE IF NOT EXISTS)
        ├── db.ts          # Postgres pool + async queries (households/users/recipes/invites)
        └── auth.ts        # login codes, sessions, Resend email (async)
```

The Vite dev server proxies `/api/*` → `http://localhost:3001` (see
`client/vite.config.ts`), so the frontend calls same-origin `/api/...` in dev.
In production the client and API are both served from `foodit.valault.com`, so
the same-origin `/api/...` calls (and the session cookie) work unchanged.

---

## Decision log (ADRs)

### ADR-001 — SQLite via `bun:sqlite` to start
**Decision:** Persist to a local SQLite file (`server/data/foodit.db`) using Bun's
built-in driver.
**Why:** No external service to provision, no ORM to learn, and it's plenty for a
household-scale dataset (hundreds of recipes). Keeps the "start now, build from
there" momentum.
**Trade-off / revisit when:** Deploying to a platform without a persistent
filesystem (e.g. Vercel serverless) — then migrate to Postgres. Schema is plain
SQL so the move is mechanical.

### ADR-002 — Hand-written CSS design system (no Tailwind / component lib)
**Decision:** Build a small CSS system (design tokens as CSS variables, a few
composable classes) instead of adding Tailwind or a component library.
**Why:** The look needs to feel bespoke, "slick and clean." Fewer dependencies,
full control, and light/dark support via `color-scheme` + tokens.
**Revisit when:** The component surface grows enough that a headless library
(e.g. Radix) would save real time.

### ADR-003 — Ingredients & tags stored as JSON columns (for now)
**Decision:** `recipes.ingredients` and `recipes.tags` are JSON-encoded text
columns; search is done in the server after loading rows.
**Why:** Simplest thing that works at household scale; avoids join tables and
keeps the write path trivial (a recipe is one row).
**Trade-off / revisit when:** Datasets grow or we need fast tag facets / full-text
search — then normalize into `tags` / `ingredients` tables and/or add SQLite FTS5.

### ADR-004 — Passwordless email-code auth (implemented in slice 2)
**Decision:** No passwords. Login = enter email → server emails a 6-digit code →
verify → issue a session. Implemented in `server/src/auth.ts`.
**Details:**
- Codes: 6 digits, hashed (sha256) in `login_codes`, 10-minute expiry, max 5
  attempts, single outstanding code per email (a new request burns the old one).
- Sessions: opaque 32-byte token, sha256-hashed in `sessions`; the raw token
  lives in an httpOnly `foodit_session` cookie (`sameSite=lax`, `secure` in prod).
- 90-day **sliding** expiry (ADR-006): every authenticated request pushes the
  expiry to now+90d, so active users stay logged in and inactive ones lapse.

### ADR-005 — Household creation on first login
**Decision:** On a verified login, an email with no account gets a **new
household** with itself as **admin**. An email with a pending household invite
joins the inviter's household (with the invited role). Existing users just sign
in.
**Why:** Someone has to be the first admin; this avoids a manual seeding step and
makes the app multi-tenant (each household is isolated).
**Superseded in part by ADR-010:** this is no longer *self-serve* — an unknown
email must hold an app invite (or be a super admin) to get a household at all.

### ADR-006 — Sliding 90-day sessions (see ADR-004 for mechanics)
**Decision:** Sessions expire 90 days after last use, refreshed on every
authenticated request, rather than a fixed 90-day-from-login window.
**Why:** Matches the "keep users logged in for a long time with automatic
refresh" requirement — regular users effectively never get logged out.

### ADR-007 — Resend for email, with a console fallback
**Decision:** Send transactional email via Resend's HTTP API (no SDK dependency —
a plain `fetch` in the shared `sendEmail` helper in `auth.ts`). If
`RESEND_API_KEY` is unset, the server logs to the console instead of sending.
Two emails exist: **login codes** (`sendLoginCodeEmail`) and **household
invites** (`sendInviteEmail`, linking to `FOODIT_APP_URL`).
**Why:** Zero-dependency, and the console fallback means local dev works with no
key. Config lives in `server/.env` (git-ignored); see `server/.env.example`.
**Note:** The shared `onboarding@resend.dev` sender is fine for testing but
Resend restricts who it can email; sending to real household members needs a
verified domain in Resend (set `FOODIT_FROM_EMAIL`).
**Failure handling differs by email.** A login code is useless undelivered, so
`POST /api/auth/request-code` returns **502** if the send fails. An invite is
still valid undelivered — ADR-005 resolves the pending invite on first login —
so `POST /api/household/invites` keeps the row and returns **201** with
`{ emailed: false, warning }`, which the household page shows to the admin.

### ADR-010 — Invite-only signup, with a super-admin role
**Decision:** Signing up requires an invitation. `resolveUserOnLogin` admits an
email only if it (a) already has an account, (b) holds a pending household invite
(→ joins that household), (c) holds a pending **app invite** (→ gets its own new
household as admin), or (d) is a **super admin**. Anything else is rejected with
`SignupNotAllowedError`.
**The `super_admin` role** is app-level and lives in `users.role` alongside
`admin`/`member`. It *implies* household admin — compare with `isHouseholdAdmin()`
from `db.ts`, never `role === "admin"` — and additionally grants
`/api/app-invites` (invite someone to foodit itself; they get their own
household, not yours).
**Membership is env-driven, not database-driven.** `FOODIT_SUPER_ADMINS`
(comma-separated, defaults to `valault1@gmail.com`) is the source of truth, and
each login reconciles the stored role against it. This is what makes the gate
bootstrappable: on an empty database nobody exists to issue the first invite, so
without an allowlist that bypasses the check, a fresh deploy locks everyone out.
Demotion targets `admin`, never `member`, so removing someone from the allowlist
can only take away app-level power — never change their standing in a household.
**Two tables, deliberately.** App invites are a separate `app_invites` table
rather than `invites` rows with a null `household_id`: they mean a different
thing (may sign up vs. join this household) and `invites` is keyed on
`UNIQUE(household_id, email)`, which a null household would defeat.
**The gate runs at `request-code`, not just `verify`,** so an uninvited address
never receives a code or leaves a `login_codes` row.
**Trade-off:** rejecting at `request-code` reveals whether an address is known to
the app. Accepted deliberately — for a household recipe app, telling an invited
user they typo'd their address beats resisting enumeration.
**Revisit when:** super admins need to be managed in the UI, or the enumeration
leak starts to matter.

### ADR-008 — Vercel Postgres (Neon) replaces local SQLite
**Decision:** Persist to hosted **Postgres** (Vercel Postgres, backed by Neon)
via `@vercel/postgres`, replacing `bun:sqlite`. This realizes ADR-001's stated
"revisit when deploying to a platform without a persistent filesystem."
**Details:**
- `server/src/db.ts` holds a module-scoped pool (`createPool()`, which reads
  `POSTGRES_URL` from the env) and all queries. **The whole data layer is now
  async** — every query function returns a `Promise`, and `auth.ts` and the
  route handlers `await` them. Postgres uses `$1,$2,…` placeholders (not `?`)
  and `result.rowCount` (not `.changes`).
- Schema DDL moved out of the request path: `server/src/schema.ts` exports
  `migrate(pool)` (all `CREATE TABLE IF NOT EXISTS` + indexes) and is run once
  via `bun run migrate` (`server/scripts/migrate.ts`). DDL never runs per request.
- Column types mirror the old SQLite schema: IDs and timestamps stay `text`
  (app-generated UUIDs / ISO strings); `ingredients`/`tags` stay `text` holding
  a JSON array (still `JSON.stringify` on write, `JSON.parse` on read — ADR-003
  is unchanged); `rating`/`attempts` are `integer`.
- The `createHouseholdWithAdmin` multi-statement write uses a real transaction
  on a dedicated client (`BEGIN`/`COMMIT`/`ROLLBACK`) instead of
  `db.transaction()`. The invites `ON CONFLICT (household_id, email)` upsert is
  valid Postgres and kept as-is.
**Why:** Vercel's serverless functions have no persistent disk and no Bun
runtime, so a local SQLite file can't survive there. `@vercel/postgres` is
built for serverless connection reuse and needs zero extra provisioning inside
the Vercel ecosystem. **No data migration:** the old SQLite data was disposable
test data; the Postgres schema is created fresh.
**Local dev:** `bun run dev` still runs Vite + the Bun Express server, but now
points at Neon via `POSTGRES_URL` in `server/.env` (there is no local SQLite
anymore). `@vercel/postgres` connects to Neon over a WebSocket, so it needs the
real Neon endpoint — a plain local Postgres won't work; use a Neon dev branch to
keep experiments off prod data.
**Revisit when:** query volume or shape wants a query builder / migrations tool
(e.g. Drizzle, Kysely) instead of hand-written SQL, or JSON columns need
`jsonb` + indexing (ties into ADR-003).

### ADR-009 — Deploy on Vercel (static client + Express-as-a-Function)
**Decision:** Host on **Vercel** at `foodit.valault.com`. The client is a static
build (`client/dist`); the entire Express app is exported from
`server/src/app.ts` and run as a **single serverless function** via
`api/index.ts` (`export default app`). `vercel.json` routes `/api/*` to the
function and falls back all other paths to `index.html` (SPA routing).
**Details:**
- `app.ts` builds and exports the app; `server/src/index.ts` (`app.listen`) is
  now **local dev only**. `app.set("trust proxy", 1)` so `secure` session
  cookies work behind Vercel's TLS edge.
- **Production runtime is Node**, not Bun. Vercel auto-detects `api/index.ts` as
  a Node function — do **not** set `functions.runtime` in `vercel.json` to
  `nodejs20.x` (that field wants an npm runtime package like `@vercel/node@x` and
  errors on the version string: "Function Runtimes must have a valid version").
  The Node major is pinned via `engines.node` in the root `package.json` instead.
  Server code therefore avoids Bun-only APIs.
- Relative imports in the function's module graph (`api/index.ts` and everything
  under `server/src`) must carry an explicit **`.js` extension**
  (`from "./db.js"`). Vercel does **not** bundle this function — it transpiles each
  `.ts` to `.js` and lets **native Node ESM** resolve them at runtime, and Node's
  ESM resolver never probes for extensions. An extensionless specifier throws
  `ERR_MODULE_NOT_FOUND` in production (it happened to work under CommonJS, which
  is why the pre-ESM guidance said "extensionless"). The `.js` names the compiled
  output even though the source is `.ts` — the standard TypeScript-ESM convention.
  Bun (local dev) and `tsc` (`moduleResolution: "bundler"`) both resolve the `.js`
  specifier back to the `.ts` source, so one spelling works everywhere. Never use
  explicit `.ts` specifiers — the Node build rejects them.
- The root `package.json` must declare **`"type": "module"`** (both `client/` and
  `server/` already do). Vercel/esbuild picks each transpiled function's module
  format from the nearest `package.json`'s `type`. `api/index.ts` lives in the
  **root** scope, so without this the entrypoint compiled to CommonJS and its
  `require()` of the ESM `server/src/app.js` (server is `type: module`) failed at
  runtime with `ERR_REQUIRE_ESM`. Declaring the root ESM makes the whole workspace
  consistent so the function imports the app as ESM.
- Same-origin in prod (client + API both on `foodit.valault.com`), so the
  `foodit_session` cookie needs no cross-site handling.
- Vercel detects `bun.lock` and uses Bun for install/build (`bun run build`);
  the function still executes on the Node runtime.
**Why:** Keeps everything in one ecosystem alongside Postgres (ADR-008) and
Resend, with no always-on server to operate. Exporting the app (rather than
rewriting routes as individual functions) keeps a single, familiar Express
codebase that runs identically in local dev.
**Revisit when:** cold starts or the single-function model become limiting, or
a route needs an always-on process (e.g. websockets) — then split functions or
move the server to a long-running host (Railway/Render/Fly).

---

## Build sequence

- [x] **Slice 0** — Wipe legacy Next.js app; scaffold Bun + React/TS + Express monorepo.
- [x] **Slice 1** — Recipe core: schema, CRUD + search API, polished add/search/view/edit UI.
  - API: `GET/POST /api/recipes`, `GET/PUT/DELETE /api/recipes/:id`, `GET /api/tags`.
  - UI: list/search (`RecipeListPage`), add/edit (`RecipeFormPage`), detail with
    inline-editable notes (`RecipeDetailPage`); `StarRating`, `TagInput`, `RecipeCard`.
- [x] **Slice 2** — Auth: passwordless email-code login, households, invites,
      90-day sliding sessions. Server: `auth.ts`, `/api/auth/*`, `/api/household*`,
      recipes now scoped to the signed-in user's household. Client: `auth.tsx`
      context, `LoginPage`, `HouseholdPage`, header user menu; app gated on login.
- [x] **Slice 2.5** — Deploy prep: migrate data layer to Vercel Postgres (async,
      ADR-008) and make the app Vercel-deployable (static client + Express-as-a-
      function, ADR-009). `app.ts`/`schema.ts`/`api/index.ts`/`vercel.json` added;
      `bun run migrate` creates the schema. Manual Vercel/DNS/Resend setup is
      tracked in `VERCEL_MIGRATION_PLAN.md` Part B.
- [ ] **Slice 3** — Polish & extras: refinements driven by real use.

---

## Open questions (need a decision before the relevant slice)

- ~~Email provider for login codes and invites~~ → **Resolved: Resend** (ADR-007).
  Key goes in `server/.env`. For emailing real household members, verify a domain
  in Resend.
- ~~**Production hosting** for a long-running Express server~~ → **Resolved:
  Vercel** (ADR-009) — static client + Express exported as a single serverless
  function; database moved to Vercel Postgres (ADR-008). Remaining work is the
  manual Vercel/DNS/Resend setup in `VERCEL_MIGRATION_PLAN.md` Part B.

---

## Conventions

- Domain types live in `client/src/types.ts`; keep the server's shapes in sync.
- API is REST under `/api`; JSON in/out; snake_case in the DB, camelCase over the wire.
- Record every non-obvious decision here as a new ADR (increment the number).
