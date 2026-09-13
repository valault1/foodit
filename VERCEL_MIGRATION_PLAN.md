# foodit → Vercel migration & deploy plan

**Purpose:** deploy foodit to **Vercel** at **`foodit.valault.com`**, with all data in
**Vercel Postgres (Neon)** and email via **Resend** — everything hosted in the Vercel
ecosystem.

This document is a self-contained handoff. A fresh session should be able to execute
**Part A** (code) from this file alone, then hand the user **Part B** (clicks + DNS).
Read `AGENTS.md` first for the project's architecture and decision log.

---

## 0. Context snapshot (so a new session needs no prior chat)

- **Repo:** `github.com/valault1/foodit`, branch `master` (latest work already pushed).
- **Stack today:** Bun workspace monorepo.
  - `client/` — Vite + React + TypeScript SPA. Calls the API at relative `/api/*`.
  - `server/` — Express + **`bun:sqlite`** (synchronous), run by Bun.
- **Key files:**
  - `server/src/db.ts` — SQLite connection, schema, and all query functions (**synchronous**).
  - `server/src/auth.ts` — login codes, sessions, Resend email (uses `db.ts`, synchronous).
  - `server/src/index.ts` — Express app + all routes; calls `app.listen()` at the bottom.
  - `client/src/*` — `auth.tsx` (auth context), `api.ts` (fetch wrappers), `pages/`.
- **Domain model / tables:** `households`, `users`, `recipes`, `login_codes`, `sessions`,
  `invites`. Auth is passwordless email codes; sessions are an httpOnly cookie
  `foodit_session` with a **90-day sliding expiry**. See `AGENTS.md` ADR-004..007.
- **Env (local):** `server/.env` (git-ignored) already has a working `RESEND_API_KEY`,
  plus `FOODIT_FROM_EMAIL` and `FOODIT_APP_URL`. `server/.env.example` documents them.
- **Data to migrate:** **none.** The local SQLite DB is disposable test data — the
  Postgres schema is created fresh. No data export/import needed.
- **Resend status:** key verified working. The default sender `onboarding@resend.dev`
  only delivers to the Resend *account owner's* address until a domain is verified
  (Part B, step 6).

### Why this migration is needed (the core constraint)

Vercel runs **stateless serverless functions on Node** — no always-on server, no
persistent disk, and no Bun runtime in production. The current app relies on all three
(a long-running Express process reading a local SQLite file via `bun:sqlite`). So three
things must change: the **frontend** becomes a static build, the **backend** becomes a
serverless function, and the **database** moves to hosted Postgres.

---

## Part A — Code changes (the new session does these)

> Goal: keep the app runnable locally (`bun run dev`) **and** deployable to Vercel.
> Production runtime is **Node** (Vercel); local dev can stay **Bun**. Avoid Bun-only
> APIs in shared server code.

### A1. Make the Express app importable (split app vs. listen)

- Create `server/src/app.ts` that builds and **exports** the Express `app`
  (move everything from `index.ts` except the `app.listen(...)` call).
- Add `app.set("trust proxy", 1);` (needed so secure cookies work behind Vercel's TLS).
- `server/src/index.ts` becomes just: `import app from "./app"; app.listen(PORT, ...)`
  — this is the **local Bun dev** entrypoint only.

### A2. Replace the data layer: `bun:sqlite` → Vercel Postgres

- Add dependency: `@vercel/postgres` (in `server/package.json`).
- Rewrite `server/src/db.ts`:
  - Remove `bun:sqlite`, the `PRAGMA` lines, `mkdirSync`, and the `import.meta.dir`
    file-path logic (all Bun/SQLite-specific).
  - Use a pooled client: `import { createPool } from "@vercel/postgres";` then
    `const pool = createPool();` — it reads `POSTGRES_URL` from the environment
    automatically (Vercel sets it; locally you pull it — see A6).
  - Convert every query from the synchronous `bun:sqlite` API to async Postgres:
    - `db.query(sql).get(params)`  → `(await pool.query(sql, [params])).rows[0] ?? null`
    - `db.query(sql).all(params)`  → `(await pool.query(sql, [params])).rows`
    - `db.query(sql).run(params)`  → `await pool.query(sql, [params])`
      (use `result.rowCount` where the code currently reads `.changes`)
  - Change SQL placeholders from `?` to `$1, $2, …` (Postgres style).
  - **Make every exported function `async`** and update return types to `Promise<…>`.
  - Column types (keep changes minimal — mirror current behavior):
    - IDs stay `text` (app generates `crypto.randomUUID()`).
    - Timestamps stay `text` storing ISO strings (`new Date().toISOString()`).
    - `ingredients` / `tags` stay `text` holding JSON — keep the existing
      `JSON.stringify` on write and `safeJsonArray`/`JSON.parse` on read.
      *(Optional upgrade: use `jsonb` and drop the stringify. Not required.)*
    - `rating` → `integer`; `attempts` → `integer`.
  - The invites upsert (`INSERT … ON CONFLICT(household_id, email) DO UPDATE …`) is
    valid Postgres — keep it, just renumber placeholders.
  - Replace `db.transaction(() => { … })` (used in `createHouseholdWithAdmin`) with a
    real transaction on a dedicated client: `BEGIN` / `COMMIT` / `ROLLBACK` via
    `const client = await pool.connect(); try { await client.query("BEGIN"); … }`.
- Rewrite `server/src/auth.ts`:
  - Make its functions `async` and `await` the now-async `db.ts` calls.
  - `node:crypto` (`createHash`, `randomBytes`, `timingSafeEqual`) works on Node — keep.
  - The Resend `fetch` sender is unchanged.
- Update `server/src/app.ts` (formerly index.ts) route handlers:
  - `await` all db/auth calls. Make the session-resolving middleware `async`
    (resolve `req.user` with `await getSessionUser(...)`).

### A3. Schema creation / migration

- Add `server/src/schema.ts` exporting `async function migrate(pool)` that runs
  `CREATE TABLE IF NOT EXISTS …` for all six tables (Postgres types per A2) plus the
  indexes. Add a runnable script `scripts/migrate.ts` that creates a pool and calls it.
- Add an npm script, e.g. `"migrate": "bun scripts/migrate.ts"` (root or server).
- This is run **once** against the Neon database (Part B, step 4). Do **not** run DDL
  on every request.

### A4. Vercel serverless entrypoint

- Create **`/api/index.ts`** at the **repo root** (this is the Vercel Function):
  ```ts
  import app from "../server/src/app";
  export default app; // an Express app is a valid (req, res) handler
  ```
- **Gotcha:** Vercel builds functions with esbuild on Node. Remove explicit **`.ts`
  extensions** from import specifiers in server code (Bun allows them; the Vercel/Node
  build generally does not). Use extensionless imports (`from "./db"`).
- Keep the server `tsconfig` valid for Node builds (module resolution, no
  `allowImportingTsExtensions` reliance for the Vercel path).

### A5. `vercel.json` (repo root)

```json
{
  "buildCommand": "bun run build",
  "outputDirectory": "client/dist",
  "functions": { "api/index.ts": { "runtime": "nodejs20.x" } },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```
- `bun run build` already builds the client (`bun run --cwd client build` → `client/dist`).
- The first rewrite routes all `/api/*` to the Express function; the second is the SPA
  fallback for client-side routes. **Verify** after first deploy that (a) deep links like
  `/recipes/new` load the app and (b) `/api/health` hits the function.
- Confirm Vercel uses Bun for install/build (a `bun.lock` is present, which Vercel
  detects). Functions still run on the Node runtime regardless.

### A6. Local development after the migration

- Local dev no longer has SQLite. Point it at the Neon database:
  - `vercel env pull server/.env` (after the Vercel project + Postgres exist) pulls
    `POSTGRES_URL` etc. into `server/.env`, or add `POSTGRES_URL=` manually from Neon.
  - `bun run dev` still runs Vite + the Bun Express server; `@vercel/postgres` works on
    Bun and connects to Neon. (Alternatively use `vercel dev`.)
- Tip: Neon supports branches — a dev branch keeps local experiments off prod data.

### A7. Verify before handing off Part B

- `bunx tsc --noEmit -p client/tsconfig.json` and `-p server/tsconfig.json` are clean.
- Run `migrate` against a dev Neon DB, then `bun run dev` and confirm end-to-end:
  request a login code (printed to console if `RESEND_API_KEY` unset in that shell),
  verify, create/search/edit a recipe, invite a member, sign out.
- `bun run build` succeeds and emits `client/dist`.

### A8. Update `AGENTS.md`

- Add ADRs:
  - **ADR-008 — Vercel Postgres (Neon) replaces local SQLite** (realizes ADR-001's
    "revisit when deploying without a persistent filesystem"). Data layer is now async.
  - **ADR-009 — Deploy on Vercel:** static client + Express-as-serverless-function;
    production runtime is Node (local dev remains Bun).
- Update the stack table and check off a new slice in the build sequence.

---

## Part B — Manual steps for the user (in order)

1. **Create the Vercel project.**
   - vercel.com → **Add New → Project** → import `valault1/foodit` from GitHub.
   - Framework preset: **Other**. Leave build/output to `vercel.json`.
     (Build Command `bun run build`, Output Directory `client/dist`.)
   - Deploy once (it may partially work before the DB exists — that's fine).

2. **Add Vercel Postgres.**
   - Project → **Storage** tab → **Create Database** → **Postgres (Neon)** → connect it
     to this project. Vercel injects `POSTGRES_URL` (and friends) as env vars
     automatically. No separate account or login.

3. **Add the remaining environment variables** (Project → Settings → Environment
   Variables, Production + Preview):
   - `RESEND_API_KEY` — the Resend key (same one in `server/.env`).
   - `FOODIT_FROM_EMAIL` — e.g. `foodit <login@valault.com>` (after step 6; until then
     `foodit <onboarding@resend.dev>`).
   - `FOODIT_APP_URL` — `https://foodit.valault.com`.
   - (`NODE_ENV=production` is set by Vercel automatically; `POSTGRES_URL` came from step 2.)

4. **Create the database schema (one time).**
   - Easiest: locally run `vercel env pull server/.env` to fetch `POSTGRES_URL`, then
     `bun run migrate` (the script from A3). Or run the migration however the new
     session wired it. Confirm the six tables exist.

5. **Add the custom domain.**
   - Project → **Settings → Domains** → add **`foodit.valault.com`**.
   - Vercel shows a DNS record — for a subdomain it's a **CNAME**:
     `foodit` → `cname.vercel-dns.com`.
   - Add that record at whoever hosts DNS for `valault.com`. (If `valault.com` is already
     on Vercel, this is automatic.) Wait for Vercel to verify + issue SSL.

6. **Verify a domain in Resend (so household members can receive codes).**
   - resend.com/domains → **Add Domain** → `valault.com` (or `mail.valault.com`).
   - Add the DNS records Resend provides (SPF `TXT`, DKIM `TXT`/`CNAME`, MX, optional
     DMARC) at the `valault.com` DNS host → click **Verify**.
   - Once verified, set `FOODIT_FROM_EMAIL` (step 3) to an address on that domain and
     redeploy. Until this is done, only *your own* Resend-account email receives codes.

7. **Redeploy & test.**
   - Trigger a redeploy (or push to `master`). Visit `https://foodit.valault.com`,
     sign in with your email, add a recipe, invite a housemate.

---

## Gotchas & decisions (don't relearn these the hard way)

- **Everything DB becomes async.** The biggest churn is threading `await` through
  `db.ts` → `auth.ts` → route handlers. Do it in that order.
- **Placeholders:** Postgres uses `$1,$2`; there is no `?`. `.changes` → `rowCount`.
- **Serverless connections:** use `@vercel/postgres`'s pool (built for serverless);
  don't hold a long-lived global connection or run `PRAGMA`.
- **Import extensions:** drop `.ts` from server imports for the Vercel/Node build (A4).
- **Cookies:** same-origin in prod (client + API both on `foodit.valault.com`), so the
  `foodit_session` cookie "just works"; keep `secure` in prod + `app.set('trust proxy',1)`.
- **No prod data migration** — schema is created fresh; the old SQLite data is disposable.
- **Resend** only emails the account owner until the domain is verified (Part B step 6).

---

## Kickoff prompt for the new conversation

Paste this to start the new session:

> Read `VERCEL_MIGRATION_PLAN.md` and `AGENTS.md`, then execute **Part A** (the code
> changes to migrate foodit from bun:sqlite to Vercel Postgres and make it deployable as
> a Vercel serverless app). Keep `bun run dev` working locally against Neon. Typecheck
> and verify end-to-end as described in A7, update `AGENTS.md` with the new ADRs, and
> commit. Then walk me through **Part B** (the Vercel/DNS/Resend steps) one at a time.
