import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { JobRadarAdvisorCopy, JobRadarAdvisorTone } from "./jobRadarAdvisorContent";
import "./JobRadarAdvisor.css";

type JobRadarAdvisorAction = {
  label: string;
  to?: string;
  onClick?: () => void;
};

type JobRadarAdvisorProps = JobRadarAdvisorCopy & {
  cta?: JobRadarAdvisorAction | null;
  variant?: "inline" | "compact";
  dismissible?: boolean;
  dismissKey?: string;
  imageSrc?: string;
  imageAlt?: string;
  className?: string;
};

function joinClasses(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function JobRadarAdvisor({
  eyebrow,
  title,
  description,
  cta,
  tone = "neutral",
  variant = "inline",
  dismissible = false,
  dismissKey,
  imageSrc = "/conseiller.png",
  imageAlt = "Conseiller JobRadar",
  className,
}: JobRadarAdvisorProps) {
  const navigate = useNavigate();
  const storageKey = useMemo(
    () => (dismissible && dismissKey ? `jobradar-advisor:${dismissKey}` : null),
    [dismissible, dismissKey]
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (dismissed) return null;

  const handleDismiss = () => {
    if (storageKey && typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, "1");
    }
    setDismissed(true);
  };

  const handleAction = () => {
    if (!cta) return;
    if (cta.onClick) {
      cta.onClick();
      return;
    }
    if (cta.to) navigate(cta.to);
  };

  return (
    <aside
      className={joinClasses([
        "jrAdvisor",
        `jrAdvisor--${variant}`,
        `jrAdvisor--${tone as JobRadarAdvisorTone}`,
        className,
      ])}
    >
      <div className="jrAdvisor__avatarWrap">
        <img className="jrAdvisor__avatar" src={imageSrc} alt={imageAlt} loading="lazy" />
      </div>

      <div className="jrAdvisor__content">
        {eyebrow ? <div className="jrAdvisor__eyebrow">{eyebrow}</div> : null}
        <div className="jrAdvisor__titleRow">
          <h2 className="jrAdvisor__title">{title}</h2>
          {dismissible ? (
            <button className="jrAdvisor__dismiss" type="button" onClick={handleDismiss}>
              Masquer
            </button>
          ) : null}
        </div>
        {description ? <p className="jrAdvisor__description">{description}</p> : null}
      </div>

      {(cta || dismissible) && (
        <div className="jrAdvisor__actions">
          {cta ? (
            <button className="jrAdvisor__cta" type="button" onClick={handleAction}>
              {cta.label}
            </button>
          ) : null}
        </div>
      )}
    </aside>
  );
}
