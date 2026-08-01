import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "./components/GuidedUI";
import {
  fetchUserNotifications,
  isSafeNotificationPath,
  markAllNotificationsRead,
  type JobRadarNotification,
  type JobRadarNotificationKind,
} from "./lib/jobradarNotifications";
import { useSession } from "./lib/useSession";
import "./NotificationsPage.css";

const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";

function kindLabel(kind: JobRadarNotificationKind) {
  switch (kind) {
    case "new_matches":
      return "Offres";
    case "alert_active":
      return "Alerte";
    case "saved_job_expiring":
      return "Échéance";
    case "subscription_status":
      return "Accès";
    default:
      return "Info";
  }
}

function groupLabel(date: Date, now: Date) {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);

  if (date >= startToday) return "Aujourd'hui";
  if (date >= startYesterday) return "Hier";

  const sevenDaysAgo = new Date(startToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  if (date >= sevenDaysAgo) return "Cette semaine";

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatRelativeTime(value: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";

  const diffSeconds = Math.round((time - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

  if (abs < 60) return rtf.format(diffSeconds, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  return rtf.format(Math.round(diffSeconds / 86400), "day");
}

function groupNotifications(rows: JobRadarNotification[]) {
  const now = new Date();
  const groups = new Map<string, JobRadarNotification[]>();

  for (const row of rows) {
    const date = new Date(row.created_at);
    const label = Number.isNaN(date.getTime()) ? "Plus ancien" : groupLabel(date, now);
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const userId = session?.user?.id ?? null;

  const [rows, setRows] = useState<JobRadarNotification[]>([]);
  const [busy, setBusy] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  const load = useCallback(async () => {
    if (!userId) return;

    setBusy(true);
    setErrorMsg(null);

    const result = await fetchUserNotifications(userId);
    setRows(result.data);
    setUnavailable(result.unavailable);
    setErrorMsg(result.error ? GENERIC_SERVER_ERROR : null);
    setBusy(false);

    if (!result.unavailable && result.data.some((row) => !row.read_at)) {
      const readResult = await markAllNotificationsRead(userId);
      if (readResult.ok) {
        setRows((current) =>
          current.map((row) => (row.read_at ? row : { ...row, read_at: readResult.readAt })),
        );
      }
    }
  }, [userId]);

  useEffect(() => {
    if (!loading && userId) {
      const timer = window.setTimeout(() => {
        void load();
      }, 0);

      return () => {
        window.clearTimeout(timer);
      };
    }
  }, [loading, userId, load]);

  const unreadCount = useMemo(() => rows.filter((row) => !row.read_at).length, [rows]);
  const groups = useMemo(() => groupNotifications(rows), [rows]);

  const onOpenNotification = (row: JobRadarNotification) => {
    const target = isSafeNotificationPath(row.cta_path) ? row.cta_path : "/jobradar/feed";
    navigate(target);
  };

  return (
    <div className="notifications-shell">
      <section className="notifications-hero">
        <div>
          <div className="notifications-eyebrow">JobRadar</div>
          <h1>Notifications</h1>
          <p>
            Les signaux importants de ton espace : nouvelles offres, alertes,
            candidatures et accès JobRadar.
          </p>
        </div>
        <div className="notifications-summary" aria-label="Notifications non lues">
          <span>{busy ? "..." : unreadCount}</span>
          <small>non lues</small>
        </div>
      </section>

      {errorMsg && <div className="notifications-error">{errorMsg}</div>}

      {busy ? (
        <div className="notifications-panel">
          <div className="notifications-loading">Chargement des notifications...</div>
        </div>
      ) : unavailable ? (
        <EmptyState
          title="Centre en cours d'activation"
          description="La page est prête. Il reste à appliquer la migration Supabase pour commencer à recevoir les notifications internes."
          primaryAction={{ label: "Retour aux offres", to: "/jobradar/feed" }}
          secondaryAction={{ label: "Voir mes alertes", to: "/jobradar/alerts" }}
          tone="info"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Tu es à jour"
          description="Aucune nouvelle notification pour l'instant. Les prochaines alertes importantes apparaîtront ici."
          primaryAction={{ label: "Voir mes offres", to: "/jobradar/feed" }}
          secondaryAction={{ label: "Gérer mes alertes", to: "/jobradar/alerts" }}
          tone="success"
        />
      ) : (
        <div className="notifications-list" aria-live="polite">
          {groups.map((group) => (
            <section key={group.label} className="notifications-group">
              <h2>{group.label}</h2>
              <div className="notifications-items">
                {group.items.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`notifications-item${row.read_at ? "" : " is-unread"}`}
                    onClick={() => onOpenNotification(row)}
                  >
                    <span className={`notifications-kind notifications-kind--${row.kind}`} aria-hidden="true" />
                    <span className="notifications-content">
                      <span className="notifications-rowTop">
                        <span className="notifications-kindLabel">{kindLabel(row.kind)}</span>
                        <span className="notifications-time">{formatRelativeTime(row.created_at)}</span>
                      </span>
                      <span className="notifications-title">{row.title}</span>
                      <span className="notifications-body">{row.body}</span>
                      {row.cta_label && <span className="notifications-cta">{row.cta_label}</span>}
                    </span>
                    {!row.read_at && <span className="notifications-unreadDot" aria-label="Non lue" />}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
