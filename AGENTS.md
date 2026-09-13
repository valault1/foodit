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
| Backend    | Express 4 (run by Bun)                  | Simple, well-understood HTTP server; Bun runs the TS directly. |
| Packaging  | Bun workspaces                          | Single `bun install`; one `bun run dev` runs both apps. |
| Database   | `bun:sqlite` (SQLite, built into Bun)   | Zero setup, no external service, ideal for starting. See ADR-001. |
| Styling    | Hand-written CSS design system          | Bespoke, clean look with minimal dependencies. See ADR-002. |

### Repo layout

```
foodit/
├── AGENTS.md              # this file
├── package.json           # workspace root; `bun run dev` runs client + server
├── client/                # Vite + React + TS frontend (port 3000)
│   └── src/
│       ├── pages/         # route-level views
│       ├── components/    # reusable UI
│       ├── api.ts         # typed fetch wrappers
│       └── types.ts       # shared domain types
└── server/                # Express + TS backend (port 3001)
    └── src/
        ├── index.ts       # express app + routes
        └── db.ts          # sqlite setup, schema, queries, seed
```

The Vite dev server proxies `/api/*` → `http://localhost:3001` (see
`client/vite.config.ts`), so the frontend calls same-origin `/api/...` in dev.

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
- [ ] **Slice 3** — Polish & extras: refinements driven by real use.

---

## Open questions (need a decision before the relevant slice)

- ~~Email provider for login codes~~ → **Resolved: Resend** (ADR-007). Key goes in
  `server/.env`. For emailing real household members, verify a domain in Resend.
- **Production hosting** for a long-running Express server (Vercel is serverless-
  oriented). Options: static client + serverless functions, or Railway/Render/Fly
  for the server. Ties into ADR-001 (Postgres migration).

---

## Conventions

- Domain types live in `client/src/types.ts`; keep the server's shapes in sync.
- API is REST under `/api`; JSON in/out; snake_case in the DB, camelCase over the wire.
- Record every non-obvious decision here as a new ADR (increment the number).
