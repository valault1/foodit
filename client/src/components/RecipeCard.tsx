import { Link } from "react-router-dom";
import type { Recipe } from "../types";
import { CATEGORY_LABELS } from "../types";
import { StarRating } from "./StarRating";

export function RecipeCard({ recipe }: { recipe: Recipe }) {
  return (
    <Link to={`/recipes/${recipe.id}`} className="recipe-card">
      <div className="recipe-card-top">
        <span className={`badge badge--${recipe.category}`}>
          {CATEGORY_LABELS[recipe.category]}
        </span>
        {recipe.rating != null && <StarRating value={recipe.rating} size={14} />}
      </div>

      <h3 className="recipe-card-title">{recipe.name}</h3>

      {recipe.ingredients.length > 0 && (
        <p className="recipe-card-meta">
          {recipe.ingredients.length} ingredient
          {recipe.ingredients.length === 1 ? "" : "s"}
        </p>
      )}

      {recipe.tags.length > 0 && (
        <div className="tag-list">
          {recipe.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
          {recipe.tags.length > 4 && (
            <span className="tag tag--more">+{recipe.tags.length - 4}</span>
          )}
        </div>
      )}
    </Link>
  );
}
