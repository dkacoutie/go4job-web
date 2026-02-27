import { useNavigate } from "react-router-dom";
import "./GuidedUI.css";

type Action = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "primary" | "ghost";
};

type Tone = "info" | "success" | "neutral";

function ActionButton({ action }: { action: Action }) {
  const navigate = useNavigate();
  const cls = action.variant === "ghost" ? "ux-btn ux-btnGhost" : "ux-btn ux-btnPrimary";
  return (
    <button
      type="button"
      className={cls}
      onClick={() => {
        if (action.onClick) action.onClick();
        else if (action.to) navigate(action.to);
      }}
    >
      {action.label}
    </button>
  );
}

export function NextStepCard({
  title,
  message,
  primaryAction,
  secondaryAction,
  tone = "info",
}: {
  title: string;
  message: string;
  primaryAction: Action;
  secondaryAction?: Action;
  tone?: Tone;
}) {
  return (
    <div className={`ux-card ux-next ux-${tone}`}>
      <div className="ux-icon" aria-hidden="true">
        {tone === "success" ? "✓" : "→"}
      </div>
      <div className="ux-body">
        <div className="ux-title">{title}</div>
        <div className="ux-text">{message}</div>
        <div className="ux-actions">
          <ActionButton action={primaryAction} />
          {secondaryAction && <ActionButton action={{ ...secondaryAction, variant: "ghost" }} />}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  primaryAction,
  secondaryAction,
  tone = "neutral",
}: {
  title: string;
  description: string;
  primaryAction?: Action;
  secondaryAction?: Action;
  tone?: Tone;
}) {
  return (
    <div className={`ux-card ux-empty ux-${tone}`}>
      <div className="ux-icon" aria-hidden="true">
        {tone === "success" ? "✓" : "•"}
      </div>
      <div className="ux-body">
        <div className="ux-title">{title}</div>
        <div className="ux-text">{description}</div>
        {(primaryAction || secondaryAction) && (
          <div className="ux-actions">
            {primaryAction && <ActionButton action={primaryAction} />}
            {secondaryAction && <ActionButton action={{ ...secondaryAction, variant: "ghost" }} />}
          </div>
        )}
      </div>
    </div>
  );
}
