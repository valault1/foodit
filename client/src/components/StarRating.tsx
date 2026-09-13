interface StarRatingProps {
  value: number | null;
  /** When provided the stars are interactive. */
  onChange?: (value: number | null) => void;
  size?: number;
}

export function StarRating({ value, onChange, size = 18 }: StarRatingProps) {
  const readOnly = !onChange;
  const stars = [1, 2, 3, 4, 5];

  return (
    <div
      className={`star-rating${readOnly ? " star-rating--readonly" : ""}`}
      style={{ fontSize: size }}
      role={readOnly ? "img" : "radiogroup"}
      aria-label={value ? `Rated ${value} out of 5` : "Not rated"}
    >
      {stars.map((star) => {
        const filled = value != null && star <= value;
        if (readOnly) {
          return (
            <span key={star} className={`star${filled ? " star--filled" : ""}`}>
              ★
            </span>
          );
        }
        return (
          <button
            key={star}
            type="button"
            className={`star star--button${filled ? " star--filled" : ""}`}
            aria-label={`${star} star${star > 1 ? "s" : ""}`}
            // Click the current rating again to clear it.
            onClick={() => onChange?.(value === star ? null : star)}
          >
            ★
          </button>
        );
      })}
      {!readOnly && value != null && (
        <button
          type="button"
          className="star-clear"
          onClick={() => onChange?.(null)}
        >
          Clear
        </button>
      )}
    </div>
  );
}
