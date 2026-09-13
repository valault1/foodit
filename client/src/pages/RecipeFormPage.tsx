import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../api";
import type { Category, RecipeInput } from "../types";
import { CATEGORIES, CATEGORY_LABELS } from "../types";
import { StarRating } from "../components/StarRating";
import { TagInput } from "../components/TagInput";

const EMPTY: RecipeInput = {
  name: "",
  sourceUrl: "",
  category: "entree",
  ingredients: [],
  notes: "",
  rating: null,
  tags: [],
};

export function RecipeFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<RecipeInput>(EMPTY);
  // Ingredients are edited as free text (one per line) — fastest way to type or paste.
  const [ingredientsText, setIngredientsText] = useState("");
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .getRecipe(id)
      .then((r) => {
        if (cancelled) return;
        setForm({
          name: r.name,
          sourceUrl: r.sourceUrl ?? "",
          category: r.category,
          ingredients: r.ingredients,
          notes: r.notes,
          rating: r.rating,
          tags: r.tags,
        });
        setIngredientsText(r.ingredients.join("\n"));
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  function update<K extends keyof RecipeInput>(key: K, value: RecipeInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name?.trim()) {
      setError("Please give the recipe a name.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload: RecipeInput = {
      ...form,
      ingredients: ingredientsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };

    try {
      const saved = isEdit
        ? await api.updateRecipe(id!, payload)
        : await api.createRecipe(payload);
      navigate(`/recipes/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  if (loading) return <div className="container"><p className="muted">Loading…</p></div>;

  return (
    <div className="container container--narrow">
      <Link to={isEdit ? `/recipes/${id}` : "/"} className="back-link">
        ← Back
      </Link>

      <h1 className="page-title">{isEdit ? "Edit recipe" : "New recipe"}</h1>

      {error && <div className="alert alert--error">{error}</div>}

      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            className="input"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Grandma's lasagna"
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="source">
            Source link <span className="label-hint">optional</span>
          </label>
          <input
            id="source"
            className="input"
            type="url"
            value={form.sourceUrl ?? ""}
            onChange={(e) => update("sourceUrl", e.target.value)}
            placeholder="https://…"
          />
        </div>

        <div className="field">
          <span className="label">Category</span>
          <div className="segmented">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c}
                className={`segmented-option${form.category === c ? " segmented-option--active" : ""}`}
                onClick={() => update("category", c as Category)}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="ingredients">
            Ingredients <span className="label-hint">one per line</span>
          </label>
          <textarea
            id="ingredients"
            className="input textarea"
            rows={6}
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
            placeholder={"2 cups flour\n1 tsp salt\n3 eggs"}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="notes">
            Notes <span className="label-hint">optional</span>
          </label>
          <textarea
            id="notes"
            className="input textarea"
            rows={4}
            value={form.notes ?? ""}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="Tweaks, substitutions, what worked…"
          />
        </div>

        <div className="field field--row">
          <div>
            <span className="label">Rating <span className="label-hint">optional</span></span>
            <StarRating value={form.rating ?? null} onChange={(v) => update("rating", v)} size={24} />
          </div>
        </div>

        <div className="field">
          <span className="label">Tags</span>
          <TagInput
            tags={form.tags ?? []}
            onChange={(tags) => update("tags", tags)}
            placeholder="Add a tag and press Enter"
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create recipe"}
          </button>
          <Link to={isEdit ? `/recipes/${id}` : "/"} className="btn btn-ghost">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
