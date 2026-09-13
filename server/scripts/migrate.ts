// One-time schema creation. Run against the target database with:
//
//   bun run migrate        (from the repo root — loads POSTGRES_URL from server/.env)
//
// It creates every table + index if missing and is safe to re-run (all DDL is
// `IF NOT EXISTS`). Never run this on the request path. See A3 / Part B step 4.
import { createPool } from "@vercel/postgres";
import { migrate } from "../src/schema.js";

async function main() {
  if (!process.env.POSTGRES_URL) {
    console.error(
      "POSTGRES_URL is not set. Pull it with `vercel env pull server/.env` " +
        "(or add it from the Neon dashboard), then re-run `bun run migrate`."
    );
    process.exit(1);
  }

  const pool = createPool();
  console.log("Running migrations…");
  await migrate(pool);
  await pool.end();
  console.log(
    "✓ Schema is up to date (households, users, household_members, recipes, " +
      "login_codes, sessions, invites, app_invites)."
  );
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
