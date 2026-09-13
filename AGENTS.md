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

### ADR-004 — Auth is passwordless email codes, deferred to slice 2
**Decision:** Households + users are modeled in the schema from the start, but the
first slice runs against a single seeded default household with no login wall.
Real auth (email one-time codes, invites, 90-day refreshing sessions) lands next.
**Why:** The recipe core is the primary value and is fully testable without auth.
Email-code login also needs an email provider decision (see Open questions).
**How it will work (planned):**
- Admin invites an email → invite row created → invitee receives a code/link.
- Login: enter email → server emails a 6-digit code → verify → issue a session
  token (httpOnly cookie), valid ~90 days, refreshed (sliding expiry) on use.
- No passwords stored, ever.

---

## Build sequence

- [x] **Slice 0** — Wipe legacy Next.js app; scaffold Bun + React/TS + Express monorepo.
- [x] **Slice 1** — Recipe core: schema, CRUD + search API, polished add/search/view/edit UI.
  - API: `GET/POST /api/recipes`, `GET/PUT/DELETE /api/recipes/:id`, `GET /api/tags`.
  - UI: list/search (`RecipeListPage`), add/edit (`RecipeFormPage`), detail with
    inline-editable notes (`RecipeDetailPage`); `StarRating`, `TagInput`, `RecipeCard`.
- [ ] **Slice 2** — Auth: households, email-code login, invites, 90-day sliding sessions.
- [ ] **Slice 3** — Polish & extras: refinements driven by real use.

---

## Open questions (need a decision before the relevant slice)

- **Email provider** for login codes (Resend / Postmark / SES / …). Until chosen,
  slice 2 will log codes to the server console (dev stub).
- **Production hosting** for a long-running Express server (Vercel is serverless-
  oriented). Options: static client + serverless functions, or Railway/Render/Fly
  for the server. Ties into ADR-001 (Postgres migration).

---

## Conventions

- Domain types live in `client/src/types.ts`; keep the server's shapes in sync.
- API is REST under `/api`; JSON in/out; snake_case in the DB, camelCase over the wire.
- Record every non-obvious decision here as a new ADR (increment the number).
