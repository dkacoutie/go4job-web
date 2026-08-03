import type { HTMLAttributes, ReactNode } from "react";
import "./ui.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  children?: ReactNode;
}

/**
 * Surface générique (panel + bordure + radius) qui remplace les
 * .profile-card / .profile-section / .jr-gateCard / .app-narrow
 * dupliqués. `interactive` ajoute le survol + press feedback
 * (voir ui.css) pour les cartes cliquables (ex: offre d'emploi).
 */
export default function Card({
  size = "md",
  interactive = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  const classes = [
    "ui-card",
    size === "lg" ? "ui-card--lg" : "",
    size === "sm" ? "ui-card--sm" : "",
    interactive ? "ui-card--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} tabIndex={interactive ? 0 : undefined} {...rest}>
      {children}
    </div>
  );
}
