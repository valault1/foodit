import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Category, Recipe } from "../types";
import { CATEGORIES, CATEGORY_LABELS } from "../types";
import { RecipeCard } from "../components/RecipeCard";

type CategoryFilter = Category | "all";

export function RecipeListPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  // Seed the tag filter from the URL (?tag=…) so links from a recipe work.
  const [activeTag, setActiveTag] = useState<string | null>(searchParams.get("tag"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the text query so we don't fetch on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listRecipes({
        q: debouncedQuery,
        category,
        tag: activeTag ?? undefined,
      })
      .then((data) => {
        if (!cancelled) {
          setRecipes(data);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, category, activeTag]);

  // Load the tag list once for the filter row.
  useEffect(() => {
    api.listTags().then(setTags).catch(() => {});
  }, []);

  const hasFilters = query || category !== "all" || activeTag;

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1 className="page-title">Recipes</h1>
          <p className="page-subtitle">
            {loading ? "Loading…" : `${recipes.length} recipe${recipes.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Link to="/recipes/new" className="btn btn-primary">
          + New recipe
        </Link>
      </div>

      <div className="search-bar">
        <SearchIcon />
        <input
          type="search"
          className="search-input"
          placeholder="Search by name, ingredient, source, or notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      <div className="filter-row">
        <button
          className={`chip${category === "all" ? " chip--active" : ""}`}
          onClick={() => setCategory("all")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`chip${category === c ? " chip--active" : ""}`}
            onClick={() => setCategory(c)}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="filter-row filter-row--tags">
          {tags.map((tag) => (
            <button
              key={tag}
              className={`tag tag--filter${activeTag === tag ? " tag--filter-active" : ""}`}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {error && <div className="alert alert--error">{error}</div>}

      {!loading && recipes.length === 0 ? (
        <div className="empty-state">
          {hasFilters ? (
            <>
              <p className="empty-title">No recipes match your search</p>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                  setActiveTag(null);
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p className="empty-title">No recipes yet</p>
              <p className="empty-subtitle">Add your first recipe to get started.</p>
              <Link to="/recipes/new" className="btn btn-primary">
                + New recipe
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="recipe-grid">
          {recipes.map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="search-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
