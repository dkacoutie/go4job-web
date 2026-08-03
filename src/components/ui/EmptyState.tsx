import type { ReactNode } from "react";
import "./ui.css";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Remplace les blocs .jr-empty / .profile-loading / états vides
 * réécrits par page. Un seul patron visuel (bordure pointillée +
 * titre + sous-titre + actions), cohérent partout.
 */
export default function EmptyState({
  icon,
  title,
  subtitle,
  actions,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={["ui-emptyState", className].filter(Boolean).join(" ")}>
      {icon && <div className="ui-emptyState__icon">{icon}</div>}
      <div className="ui-emptyState__title">{title}</div>
      {subtitle && <div className="ui-emptyState__subtitle">{subtitle}</div>}
      {actions && <div className="ui-emptyState__actions">{actions}</div>}
    </div>
  );
}
