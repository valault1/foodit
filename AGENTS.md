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

### ADR-005 — Self-serve household creation on first login
**Decision:** On a verified login, an unknown email creates a **new household**
with that user as its **admin**. An email with a pending invite joins the
inviter's household (with the invited role). Existing users just sign in.
**Why:** Someone has to be the first admin; self-serve bootstrapping avoids a
manual seeding step and makes the app multi-tenant (each household is isolated).
**Revisit when:** We want invite-only signup — then reject unknown emails that
have no pending invite instead of creating a household.

### ADR-006 — Sliding 90-day sessions (see ADR-004 for mechanics)
**Decision:** Sessions expire 90 days after last use, refreshed on every
authenticated request, rather than a fixed 90-day-from-login window.
**Why:** Matches the "keep users logged in for a long time with automatic
refresh" requirement — regular users effectively never get logged out.

### ADR-007 — Resend for email, with a console fallback
**Decision:** Send login codes via Resend's HTTP API (no SDK dependency — a plain
`fetch`). If `RESEND_API_KEY` is unset, the server logs the code to the console.
**Why:** Zero-dependency, and the console fallback means local dev works with no
key. Config lives in `server/.env` (git-ignored); see `server/.env.example`.
**Note:** The shared `onboarding@resend.dev` sender is fine for testing but
Resend restricts who it can email; sending to real household members needs a
verified domain in Resend (set `FOODIT_FROM_EMAIL`).

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
  Server code therefore avoids Bun-only APIs and uses **extensionless imports**
  (`from "./db"`), which the Vercel/esbuild Node build requires (Bun tolerated `.ts`).
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

- ~~Email provider for login codes~~ → **Resolved: Resend** (ADR-007). Key goes in
  `server/.env`. For emailing real household members, verify a domain in Resend.
- ~~**Production hosting** for a long-running Express server~~ → **Resolved:
  Vercel** (ADR-009) — static client + Express exported as a single serverless
  function; database moved to Vercel Postgres (ADR-008). Remaining work is the
  manual Vercel/DNS/Resend setup in `VERCEL_MIGRATION_PLAN.md` Part B.

---

## Conventions

- Domain types live in `client/src/types.ts`; keep the server's shapes in sync.
- API is REST under `/api`; JSON in/out; snake_case in the DB, camelCase over the wire.
- Record every non-obvious decision here as a new ADR (increment the number).
