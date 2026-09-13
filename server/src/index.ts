import express from "express";
import cors from "cors";
import {
  DEFAULT_HOUSEHOLD_ID,
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  listTags,
} from "./db.ts";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Until real auth lands (ADR-004), every request acts as the default household.
function householdId(): string {
  return DEFAULT_HOUSEHOLD_ID;
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// List / search recipes: ?q=&tag=&category=
app.get("/api/recipes", (req, res) => {
  const { q, tag, category } = req.query;
  const recipes = listRecipes(householdId(), {
    q: typeof q === "string" ? q : undefined,
    tag: typeof tag === "string" ? tag : undefined,
    category: typeof category === "string" ? category : undefined,
  });
  res.json({ recipes });
});

// Distinct tags for filter UI
app.get("/api/tags", (_req, res) => {
  res.json({ tags: listTags(householdId()) });
});

app.get("/api/recipes/:id", (req, res) => {
  const recipe = getRecipe(householdId(), req.params.id);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  res.json({ recipe });
});

app.post("/api/recipes", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "A recipe name is required" });
  const recipe = createRecipe(householdId(), req.body);
  res.status(201).json({ recipe });
});

app.put("/api/recipes/:id", (req, res) => {
  if ("name" in (req.body ?? {})) {
    const name = String(req.body.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "A recipe name is required" });
  }
  const recipe = updateRecipe(householdId(), req.params.id, req.body ?? {});
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  res.json({ recipe });
});

app.delete("/api/recipes/:id", (req, res) => {
  const ok = deleteRecipe(householdId(), req.params.id);
  if (!ok) return res.status(404).json({ error: "Recipe not found" });
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
