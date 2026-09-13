import { useState, type KeyboardEvent } from "react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

/** A chip-style input: type a tag, press Enter or comma to add it. */
export function TagInput({ tags, onChange, placeholder }: TagInputProps) {
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const value = raw.trim();
    if (!value) return;
    // Case-insensitive de-dupe.
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...tags, value]);
    setDraft("");
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  }

  return (
    <div className="tag-input">
      {tags.map((tag, i) => (
        <span key={`${tag}-${i}`} className="tag tag--removable">
          {tag}
          <button
            type="button"
            className="tag-remove"
            aria-label={`Remove ${tag}`}
            onClick={() => removeTag(i)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-input-field"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => addTag(draft)}
        placeholder={tags.length === 0 ? placeholder : ""}
      />
    </div>
  );
}
