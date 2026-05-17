import { useEffect, useMemo, useState, type ReactNode } from "react";
import "./AdminHealthPage.css";
import {
  fetchAdminHealthV1,
  type AdminHealthCron,
  type AdminHealthData,
  type AdminHealthRun,
  type AdminHealthSource,
  type HealthStatus,
} from "./lib/adminHealthApi";

type Severity = "ok" | "info" | "warning" | "critical";
type TabKey = "overview" | "sources" | "runs" | "crons" | "signals";

type PriorityItem = {
  level: Severity;
  title: string;
  evidence: string;
  zone: "Offres" | "Runs" | "Crons" | "Sources" | "Signaux";
};

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmtNumber(value: unknown) {
  return new Intl.NumberFormat("fr-FR").format(n(value));
}

function fmtPct(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value)}%`;
}

function fmtDate(value?: string | null) {
  if (!value) return "Jamais";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Inconnu";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(ms?: number | null) {
  if (!ms || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} min ${rest}s`;
}

function severityRank(level?: string | null) {
  if (level === "critical") return 0;
  if (level === "warning") return 1;
  if (level === "info") return 2;
  if (level === "ok") return 3;
  return 4;
}

function statusClass(status?: HealthStatus | Severity) {
  const s = String(status ?? "unknown").toLowerCase();
  if (s === "ok") return "is-ok";
  if (s === "info") return "is-info";
  if (s === "warning") return "is-warning";
  if (s === "critical") return "is-critical";
  return "is-muted";
}

function statusLabel(status: Severity) {
  if (status === "critical") return "Incident probable";
  if (status === "warning") return "Attention requise";
  if (status === "info") return "A surveiller";
  return "JobRadar tourne normalement";
}

function Pill({ status, children }: { status?: HealthStatus | Severity; children: ReactNode }) {
  return <span className={`adminHealth__pill ${statusClass(status)}`}>{children}</span>;
}

function KpiCard({
  label,
  value,
  note,
  severity = "ok",
}: {
  label: string;
  value: ReactNode;
  note?: string;
  severity?: Severity;
}) {
  return (
    <div className={`adminHealth__kpi ${statusClass(severity)}`}>
      <div className="adminHealth__kpiLabel">{label}</div>
      <div className="adminHealth__kpiValue">{value}</div>
      {note ? <div className="adminHealth__kpiNote">{note}</div> : null}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="adminHealth__empty">{children}</div>;
}

export default function AdminHealthPage() {
  const [data, setData] = useState<AdminHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const nextData = await fetchAdminHealthV1();
        if (!cancelled) setData(nextData);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const overview = data?.overview;
  const runs24h = n(overview?.runs?.ingest_runs_24h);
  const success24h = n(overview?.runs?.ingest_success_24h);
  const successRate = runs24h > 0 ? (success24h / runs24h) * 100 : 0;
  const activeJobs = n(overview?.jobs?.active_not_expired);
  const createdToday = n(overview?.jobs?.created_today);
  const runningOver30m = n(overview?.runs?.running_over_30m);

  const crons = useMemo(() => data?.crons ?? [], [data?.crons]);
  const activeCrons = useMemo(() => crons.filter((cron) => cron.active), [crons]);
  const activeCronErrors = useMemo(
    () => activeCrons.filter((cron) => Boolean(cron.recent_error_summary)),
    [activeCrons]
  );
  const hardcodedDigestCrons = useMemo(
    () => crons.filter((cron) => cron.hardcoded_user_id_detected),
    [crons]
  );

  const watchSources = useMemo(() => {
    const rows = data?.sources ?? [];
    return rows
      .filter((source) => String(source.watch_level ?? "ok") !== "ok")
      .sort((a, b) => {
        const severityDelta = severityRank(a.watch_level) - severityRank(b.watch_level);
        if (severityDelta !== 0) return severityDelta;
        return String(a.code ?? "").localeCompare(String(b.code ?? ""));
      });
  }, [data?.sources]);

  const sortedRuns = useMemo(() => {
    const rows = [...(data?.runs ?? [])];
    return rows.sort((a, b) => {
      const aBad = a.ok === false ? 0 : 1;
      const bBad = b.ok === false ? 0 : 1;
      if (aBad !== bBad) return aBad - bBad;
      return new Date(b.started_at ?? 0).getTime() - new Date(a.started_at ?? 0).getTime();
    });
  }, [data?.runs]);

  const redFlags = overview?.red_flags ?? [];
  const events = overview?.health_events_7d ?? [];

  const priorityItems = useMemo<PriorityItem[]>(() => {
    const items: PriorityItem[] = [];

    if (activeJobs === 0) {
      items.push({
        level: "critical",
        zone: "Offres",
        title: "Aucune offre active",
        evidence: "active_not_expired = 0",
      });
    }

    if (runs24h === 0) {
      items.push({
        level: "critical",
        zone: "Runs",
        title: "Aucune ingestion sur 24h",
        evidence: "ingest_runs_24h = 0",
      });
    } else if (successRate < 95) {
      items.push({
        level: "critical",
        zone: "Runs",
        title: "Taux de succes ingestion sous 95%",
        evidence: `${success24h}/${runs24h} succes (${fmtPct(successRate)})`,
      });
    }

    if (runningOver30m > 0) {
      items.push({
        level: "critical",
        zone: "Runs",
        title: "Run bloque depuis plus de 30 min",
        evidence: `${fmtNumber(runningOver30m)} run(s) en cours trop longtemps`,
      });
    }

    for (const cron of activeCronErrors.slice(0, 3)) {
      items.push({
        level: "critical",
        zone: "Crons",
        title: `Cron actif en erreur: ${cron.jobname ?? "sans nom"}`,
        evidence: cron.recent_error_summary ?? "Erreur recente",
      });
    }

    if (createdToday > 0 && createdToday <= 5) {
      items.push({
        level: "warning",
        zone: "Offres",
        title: "Peu de nouvelles offres aujourd'hui",
        evidence: `${fmtNumber(createdToday)} offre(s) creee(s) aujourd'hui`,
      });
    }

    const autoDisabled = n(overview?.sources?.auto_disabled);
    const staleSources = n(overview?.sources?.without_success_24h);
    if (autoDisabled >= 10) {
      items.push({
        level: "warning",
        zone: "Sources",
        title: "Nombre eleve de sources auto-disabled",
        evidence: `${fmtNumber(autoDisabled)} source(s) auto-disabled`,
      });
    } else if (staleSources >= 25) {
      items.push({
        level: "info",
        zone: "Sources",
        title: "Sources historiques sans succes recent",
        evidence: `${fmtNumber(staleSources)} source(s) sans succes 24h`,
      });
    }

    if (hardcodedDigestCrons.length > 0) {
      items.push({
        level: "info",
        zone: "Crons",
        title: "Digest avec user_id fixe",
        evidence: "Tolere en V1, a normaliser plus tard.",
      });
    }

    return items.sort((a, b) => severityRank(a.level) - severityRank(b.level)).slice(0, 5);
  }, [
    activeCronErrors,
    activeJobs,
    createdToday,
    hardcodedDigestCrons.length,
    overview?.sources?.auto_disabled,
    overview?.sources?.without_success_24h,
    runningOver30m,
    runs24h,
    success24h,
    successRate,
  ]);

  const uxSeverity = useMemo<Severity>(() => {
    if (
      activeJobs === 0 ||
      runs24h === 0 ||
      (runs24h > 0 && successRate < 95) ||
      runningOver30m > 0 ||
      activeCronErrors.length > 0
    ) {
      return "critical";
    }

    if (priorityItems.some((item) => item.level === "warning")) return "warning";
    if (priorityItems.some((item) => item.level === "info")) return "info";
    return "ok";
  }, [activeCronErrors.length, activeJobs, priorityItems, runningOver30m, runs24h, successRate]);

  const diagnostic = useMemo(() => {
    if (uxSeverity === "critical") return "Un signal operationnel actif demande une verification immediate.";
    if (uxSeverity === "warning") return "La machine tourne, avec quelques points a surveiller aujourd'hui.";
    if (uxSeverity === "info") return "La machine tourne; quelques dettes connues restent visibles.";
    return "Ingestion, crons actifs et volume d'offres sont dans une zone normale.";
  }, [uxSeverity]);

  if (loading) {
    return (
      <div className="adminHealth">
        <div className="adminHealth__panel">
          <h1>Health JobRadar</h1>
          <p className="adminHealth__muted">Lecture de l'etat operationnel...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="adminHealth">
        <div className="adminHealth__notice adminHealth__notice--error">
          <strong>Health indisponible.</strong>
          <div>{error}</div>
        </div>
      </div>
    );
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "overview", label: "Vue generale" },
    { key: "sources", label: "Sources" },
    { key: "runs", label: "Runs" },
    { key: "crons", label: "Crons" },
    { key: "signals", label: "Signaux" },
  ];

  return (
    <div className="adminHealth">
      {/* V1 scope: Est-ce que la machine JobRadar tourne normalement aujourd'hui ? */}
      <header className={`adminHealth__decision ${statusClass(uxSeverity)}`}>
        <div className="adminHealth__decisionMain">
          <div className="adminHealth__eyebrow">Health JobRadar</div>
          <h1>{statusLabel(uxSeverity)}</h1>
          <p>{diagnostic}</p>
          <div className="adminHealth__summaryLine">
            {fmtNumber(runs24h)} runs / {fmtNumber(success24h)} succes · {fmtNumber(activeJobs)} offres actives ·{" "}
            {fmtNumber(activeCrons.length)} crons actifs
          </div>
        </div>
        <div className="adminHealth__decisionMeta">
          <Pill status={uxSeverity}>{uxSeverity}</Pill>
          <span>Derniere lecture: {fmtDate(overview?.as_of)}</span>
        </div>
      </header>

      <nav className="adminHealth__tabs" aria-label="Sections health">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`adminHealth__tab${activeTab === tab.key ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <OverviewPanel
          activeCronErrors={activeCronErrors}
          activeCronsCount={activeCrons.length}
          activeJobs={activeJobs}
          createdToday={createdToday}
          hardcodedDigestCrons={hardcodedDigestCrons}
          overview={overview}
          priorityItems={priorityItems}
          runningOver30m={runningOver30m}
          runs24h={runs24h}
          success24h={success24h}
          successRate={successRate}
          watchSources={watchSources}
        />
      ) : null}

      {activeTab === "sources" ? <SourcesPanel rows={watchSources} /> : null}
      {activeTab === "runs" ? <RunsPanel rows={sortedRuns} /> : null}
      {activeTab === "crons" ? <CronsPanel rows={crons} /> : null}
      {activeTab === "signals" ? <SignalsPanel redFlags={redFlags} events={events} /> : null}
    </div>
  );
}

function OverviewPanel({
  activeCronErrors,
  activeCronsCount,
  activeJobs,
  createdToday,
  hardcodedDigestCrons,
  overview,
  priorityItems,
  runningOver30m,
  runs24h,
  success24h,
  successRate,
  watchSources,
}: {
  activeCronErrors: AdminHealthCron[];
  activeCronsCount: number;
  activeJobs: number;
  createdToday: number;
  hardcodedDigestCrons: AdminHealthCron[];
  overview: AdminHealthData["overview"] | undefined;
  priorityItems: PriorityItem[];
  runningOver30m: number;
  runs24h: number;
  success24h: number;
  successRate: number;
  watchSources: AdminHealthSource[];
}) {
  return (
    <div className="adminHealth__tabPanel">
      <section className="adminHealth__priority" aria-label="A traiter en priorite">
        <div className="adminHealth__sectionHead">
          <h2>A traiter en priorite</h2>
          <span className="adminHealth__muted">Max 5 signaux decisionnels</span>
        </div>
        {priorityItems.length === 0 ? (
          <Empty>Aucun point prioritaire. Les signaux V1 sont dans une zone normale.</Empty>
        ) : (
          <div className="adminHealth__priorityGrid">
            {priorityItems.map((item) => (
              <PriorityCard key={`${item.zone}-${item.title}`} item={item} />
            ))}
          </div>
        )}
      </section>

      <section className="adminHealth__kpiGrid" aria-label="KPI principaux">
        <KpiCard label="Offres actives" value={fmtNumber(activeJobs)} severity={activeJobs === 0 ? "critical" : "ok"} />
        <KpiCard
          label="Creees aujourd'hui"
          value={fmtNumber(createdToday)}
          severity={createdToday > 0 && createdToday <= 5 ? "warning" : "ok"}
        />
        <KpiCard
          label="Runs 24h"
          value={`${fmtNumber(runs24h)} / ${fmtPct(successRate)}`}
          note={`${fmtNumber(success24h)} succes`}
          severity={runs24h === 0 || successRate < 95 ? "critical" : "ok"}
        />
        <KpiCard
          label="Crons actifs en erreur"
          value={fmtNumber(activeCronErrors.length)}
          note={`${fmtNumber(activeCronsCount)} actifs`}
          severity={activeCronErrors.length > 0 ? "critical" : "ok"}
        />
        <KpiCard
          label="Sources a surveiller"
          value={fmtNumber(watchSources.length)}
          note={`${fmtNumber(n(overview?.sources?.auto_disabled))} auto-disabled`}
          severity={watchSources.length > 0 ? "warning" : "ok"}
        />
      </section>

      {hardcodedDigestCrons.length > 0 ? (
        <div className="adminHealth__infoNotice">
          Digest: user_id fixe detecte. Tolere en V1, a normaliser plus tard.
        </div>
      ) : null}

      <section className="adminHealth__overviewGrid">
        <MiniPanel title="Pays principaux">
          <div className="adminHealth__countryList">
            {(overview?.jobs?.active_by_country ?? []).slice(0, 5).map((row) => (
              <div className="adminHealth__country" key={row.country}>
                <span>{row.country}</span>
                <strong>{fmtNumber(row.count)}</strong>
              </div>
            ))}
          </div>
        </MiniPanel>

        <MiniPanel title="Runs">
          <MetricLine label="Succes 24h" value={`${fmtNumber(success24h)} / ${fmtNumber(runs24h)}`} />
          <MetricLine label="Taux succes" value={fmtPct(successRate)} />
          <MetricLine label="Bloques > 30 min" value={fmtNumber(runningOver30m)} />
        </MiniPanel>

        <MiniPanel title="Sources">
          <MetricLine label="Ready actives" value={fmtNumber(overview?.sources?.ready_active)} />
          <MetricLine label="Sans succes 24h" value={fmtNumber(overview?.sources?.without_success_24h)} />
          <MetricLine label="Auto-disabled" value={fmtNumber(overview?.sources?.auto_disabled)} />
        </MiniPanel>

        <MiniPanel title="Crons">
          <MetricLine label="Actifs" value={fmtNumber(activeCronsCount)} />
          <MetricLine label="Erreurs recentes" value={fmtNumber(activeCronErrors.length)} />
          <MetricLine label="user_id fixe" value={fmtNumber(hardcodedDigestCrons.length)} />
        </MiniPanel>
      </section>
    </div>
  );
}

function PriorityCard({ item }: { item: PriorityItem }) {
  return (
    <article className={`adminHealth__priorityItem ${statusClass(item.level)}`}>
      <div>
        <Pill status={item.level}>{item.level}</Pill>
        <span className="adminHealth__zone">{item.zone}</span>
      </div>
      <strong>{item.title}</strong>
      <p>{item.evidence}</p>
    </article>
  );
}

function MiniPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="adminHealth__miniPanel">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="adminHealth__metricLine">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SourcesPanel({ rows }: { rows: AdminHealthSource[] }) {
  const visible = rows.slice(0, 5);
  return (
    <section className="adminHealth__section adminHealth__tabPanel" aria-label="Sources a surveiller">
      <div className="adminHealth__sectionHead">
        <h2>Sources a surveiller</h2>
        <span className="adminHealth__muted">
          {fmtNumber(visible.length)} affichees sur {fmtNumber(rows.length)}
          {rows.length > visible.length ? ` · +${fmtNumber(rows.length - visible.length)} autres masquees` : ""}
        </span>
      </div>
      <SourcesTable rows={visible} />
    </section>
  );
}

function RunsPanel({ rows }: { rows: AdminHealthRun[] }) {
  const visible = rows.slice(0, 5);
  return (
    <section className="adminHealth__section adminHealth__tabPanel" aria-label="Derniers runs">
      <div className="adminHealth__sectionHead">
        <h2>Derniers runs</h2>
        <span className="adminHealth__muted">
          Erreurs remontees avant succes · {fmtNumber(visible.length)} affiche(s)
        </span>
      </div>
      <RunsTable rows={visible} />
    </section>
  );
}

function CronsPanel({ rows }: { rows: AdminHealthCron[] }) {
  const watch = rows.filter((row) => row.active && (row.recent_error_summary || row.hardcoded_user_id_detected));
  const ok = rows.filter((row) => row.active && !row.recent_error_summary && !row.hardcoded_user_id_detected);
  const inactive = rows.filter((row) => !row.active);
  const fixedUserId = rows.some((row) => row.hardcoded_user_id_detected);

  return (
    <div className="adminHealth__tabPanel">
      {fixedUserId ? (
        <div className="adminHealth__infoNotice">
          Digest: user_id fixe detecte. Tolere en V1, a normaliser plus tard.
        </div>
      ) : null}

      <section className="adminHealth__section">
        <div className="adminHealth__sectionHead">
          <h2>Crons a surveiller</h2>
          <span className="adminHealth__muted">{fmtNumber(Math.min(watch.length, 5))} affiches</span>
        </div>
        <CronsTable rows={watch.slice(0, 5)} />
      </section>

      <section className="adminHealth__section">
        <div className="adminHealth__sectionHead">
          <h2>Crons actifs OK</h2>
          <span className="adminHealth__muted">
            {fmtNumber(Math.min(ok.length, 5))} affiches sur {fmtNumber(ok.length)}
          </span>
        </div>
        <CronsTable rows={ok.slice(0, 5)} />
      </section>

      <section className="adminHealth__section">
        <div className="adminHealth__sectionHead">
          <h2>Crons inactifs / anciens</h2>
          <span className="adminHealth__muted">
            {fmtNumber(Math.min(inactive.length, 5))} affiches sur {fmtNumber(inactive.length)}
          </span>
        </div>
        <CronsTable rows={inactive.slice(0, 5)} />
      </section>
    </div>
  );
}

function SignalsPanel({
  redFlags,
  events,
}: {
  redFlags: string[];
  events: NonNullable<AdminHealthData["overview"]["health_events_7d"]>;
}) {
  const signalRows = [
    ...redFlags.map((flag) => ({
      key: `flag-${flag}`,
      level: "critical" as Severity,
      title: flag,
      detail: "Signal global actif",
    })),
    ...events.map((event) => ({
      key: `${event.level}-${event.code}`,
      level: (event.level === "critical" || event.level === "warning" ? event.level : "info") as Severity,
      title: event.code,
      detail: `${event.level} · ${fmtNumber(event.count_7d)} sur 7j · dernier ${fmtDate(event.latest_at)}`,
    })),
  ].slice(0, 5);

  return (
    <section className="adminHealth__section adminHealth__tabPanel" aria-label="Signaux rouges techniques">
      <div className="adminHealth__sectionHead">
        <h2>Signaux</h2>
        <span className="adminHealth__muted">{fmtNumber(signalRows.length)} visibles</span>
      </div>
      <div className="adminHealth__signals">
        {signalRows.length === 0 ? <Empty>Aucun signal bloquant remonte par la V1.</Empty> : null}
        {signalRows.map((row) => (
          <div className={`adminHealth__signal ${statusClass(row.level)}`} key={row.key}>
            <strong>{row.title}</strong>
            <span>{row.detail}</span>
          </div>
        ))}
      </div>
      <p className="adminHealth__muted adminHealth__scope">
        Hors V1: paiements detailles, partenaires detailles, messages detailles, actions admin, imports,
        relances cron et envois.
      </p>
    </section>
  );
}

function SourcesTable({ rows }: { rows: AdminHealthSource[] }) {
  if (rows.length === 0) return <Empty>Aucune source a surveiller.</Empty>;

  return (
    <div className="adminHealth__tableWrap">
      <table className="adminHealth__table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Etat</th>
            <th>Dernier succes</th>
            <th>Dernier run</th>
            <th>Flux</th>
            <th>Erreur resumee</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source_id ?? row.code}>
              <td>
                <strong>{row.code ?? "-"}</strong>
                <span>{row.name ?? "-"}</span>
              </td>
              <td>
                <Pill status={row.watch_level}>{row.watch_level ?? "ok"}</Pill>
              </td>
              <td>{fmtDate(row.last_success_at)}</td>
              <td>
                {fmtDate(row.last_run_at)}
                <span>{row.last_run_status ?? "-"}</span>
              </td>
              <td>
                {fmtNumber(row.last_run_fetched)} / +{fmtNumber(row.last_run_inserted)} / ~
                {fmtNumber(row.last_run_updated)}
              </td>
              <td>{row.last_error_summary ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsTable({ rows }: { rows: AdminHealthRun[] }) {
  if (rows.length === 0) return <Empty>Aucun run recent.</Empty>;

  return (
    <div className="adminHealth__tableWrap">
      <table className="adminHealth__table adminHealth__table--compact">
        <thead>
          <tr>
            <th>Source</th>
            <th>Statut</th>
            <th>Demarre</th>
            <th>Duree</th>
            <th>Fetched</th>
            <th>Inserted</th>
            <th>Updated</th>
            <th>Erreur resumee</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.run_id}>
              <td>
                <strong>{row.source_code ?? "-"}</strong>
                <span>{row.source_name ?? "-"}</span>
              </td>
              <td>
                <Pill status={row.ok ? "ok" : "warning"}>{row.status ?? "-"}</Pill>
              </td>
              <td>{fmtDate(row.started_at)}</td>
              <td>{fmtDuration(row.duration_ms)}</td>
              <td>{fmtNumber(row.fetched_count)}</td>
              <td>{fmtNumber(row.inserted_count)}</td>
              <td>{fmtNumber(row.updated_count)}</td>
              <td>{row.error_summary ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CronsTable({ rows }: { rows: AdminHealthCron[] }) {
  if (rows.length === 0) return <Empty>Aucun cron visible.</Empty>;

  return (
    <div className="adminHealth__tableWrap">
      <table className="adminHealth__table adminHealth__table--compact">
        <thead>
          <tr>
            <th>Cron</th>
            <th>Actif</th>
            <th>Schedule</th>
            <th>Cible</th>
            <th>Flags</th>
            <th>Dernier run</th>
            <th>Erreur resumee</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.jobid ?? row.jobname}>
              <td>
                <strong>{row.jobname ?? "-"}</strong>
                <span>{row.jobid ? `#${row.jobid}` : "-"}</span>
              </td>
              <td>
                <Pill status={row.active ? "ok" : "warning"}>{row.active ? "oui" : "non"}</Pill>
              </td>
              <td>{row.schedule ?? "-"}</td>
              <td>{row.target_summary ?? "-"}</td>
              <td>
                <div className="adminHealth__flags">
                  {row.dry_run_false_detected ? <span>dry_run=false</span> : null}
                  {row.allow_send_detected ? <span>allow_send</span> : null}
                  {row.allow_import_detected ? <span>allow_import</span> : null}
                  {row.hardcoded_user_id_detected ? <span className="is-info">user_id fixe</span> : null}
                  {!row.dry_run_false_detected &&
                  !row.allow_send_detected &&
                  !row.allow_import_detected &&
                  !row.hardcoded_user_id_detected ? (
                    <span>-</span>
                  ) : null}
                </div>
              </td>
              <td>
                {fmtDate(row.last_run_at)}
                <span>{row.last_run_status ?? "-"}</span>
              </td>
              <td>{row.recent_error_summary ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
