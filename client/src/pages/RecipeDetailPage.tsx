import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Recipe } from "../types";
import { CATEGORY_LABELS } from "../types";
import { StarRating } from "../components/StarRating";

export function RecipeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    api
      .getRecipe(id)
      .then((r) => !cancelled && setRecipe(r))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function saveNotes() {
    if (!recipe) return;
    setSavingNotes(true);
    try {
      const updated = await api.updateRecipe(recipe.id, { notes: notesDraft });
      setRecipe(updated);
      setEditingNotes(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save notes");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleDelete() {
    if (!recipe) return;
    if (!confirm(`Delete "${recipe.name}"? This can't be undone.`)) return;
    try {
      await api.deleteRecipe(recipe.id);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete recipe");
    }
  }

  if (loading) return <div className="container"><p className="muted">Loading…</p></div>;
  if (error && !recipe)
    return (
      <div className="container">
        <div className="alert alert--error">{error}</div>
        <Link to="/" className="back-link">← Back to recipes</Link>
      </div>
    );
  if (!recipe) return null;

  return (
    <div className="container container--narrow">
      <Link to="/" className="back-link">← Back to recipes</Link>

      <div className="detail-head">
        <div>
          <span className={`badge badge--${recipe.category}`}>
            {CATEGORY_LABELS[recipe.category]}
          </span>
          <h1 className="detail-title">{recipe.name}</h1>
          {recipe.rating != null && <StarRating value={recipe.rating} size={20} />}
        </div>
        <div className="detail-actions">
          <Link to={`/recipes/${recipe.id}/edit`} className="btn btn-ghost">
            Edit
          </Link>
          <button className="btn btn-danger-ghost" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      {recipe.sourceUrl && (
        <a
          className="source-link"
          href={recipe.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          View original source ↗
        </a>
      )}

      {error && <div className="alert alert--error">{error}</div>}

      <div className="detail-grid">
        <section className="card">
          <h2 className="section-title">Ingredients</h2>
          {recipe.ingredients.length > 0 ? (
            <ul className="ingredient-list">
              {recipe.ingredients.map((ing, i) => (
                <li key={i}>{ing}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No ingredients listed.</p>
          )}
        </section>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Notes</h2>
            {!editingNotes && (
              <button
                className="link-button"
                onClick={() => {
                  setNotesDraft(recipe.notes);
                  setEditingNotes(true);
                }}
              >
                {recipe.notes ? "Edit" : "Add notes"}
              </button>
            )}
          </div>

          {editingNotes ? (
            <div className="notes-editor">
              <textarea
                className="input textarea"
                rows={5}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                autoFocus
                placeholder="Tweaks, substitutions, what worked…"
              />
              <div className="form-actions">
                <button className="btn btn-primary" onClick={saveNotes} disabled={savingNotes}>
                  {savingNotes ? "Saving…" : "Save notes"}
                </button>
                <button className="btn btn-ghost" onClick={() => setEditingNotes(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : recipe.notes ? (
            <p className="notes-text">{recipe.notes}</p>
          ) : (
            <p className="muted">No notes yet.</p>
          )}
        </section>
      </div>

      {recipe.tags.length > 0 && (
        <div className="detail-tags">
          {recipe.tags.map((tag) => (
            <Link key={tag} to={`/?tag=${encodeURIComponent(tag)}`} className="tag">
              {tag}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
