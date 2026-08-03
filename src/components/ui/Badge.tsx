import type { ReactNode } from "react";
import "./ui.css";

type Variant =
  | "default"
  | "strong"
  | "soft"
  | "success"
  | "warning"
  | "danger"
  | "accent"
  | "dashed";

export interface BadgeProps {
  children: ReactNode;
  variant?: Variant;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}

/**
 * Remplace les classes .pill / .chip / .jr-badge* / .jr-confidence*
 * dupliquées par page. Même rendu visuel que les variantes existantes
 * les plus fréquentes, mais une seule définition partagée.
 */
export default function Badge({
  children,
  variant = "default",
  onRemove,
  removeLabel = "Retirer",
  className = "",
}: BadgeProps) {
  const classes = [
    "ui-badge",
    `ui-badge--${variant}`,
    onRemove ? "ui-badge--removable" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {children}
      {onRemove && (
        <button
          type="button"
          className="ui-badge__remove"
          onClick={onRemove}
          aria-label={removeLabel}
        >
          ×
        </button>
      )}
    </span>
  );
}
