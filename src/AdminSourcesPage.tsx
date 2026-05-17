// src/AdminSourcesPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./AdminSourcesPage.css";
import {
  adminConfigureRssSource,
  adminImportNow,
  adminListSources,
  adminMarkSourceReady,
  adminRunIngest,
  adminSetSourceActive,
  adminTestSource,
  adminValidateImport,
  type AdminTestSourceSampleItem,
  type AdminValidateImportResult,
} from "./lib/adminApi";

type JobSourceRow = {
  id: string;
  code: string;
  name: string | null;
  ingest_method: string | null;
  ingest_status: string | null;
  is_active: boolean | null;
  ingest_config: any;
};

type Validation = { level: "info" | "warn" | "error"; message: string };

type VerifyDetail = {
  at: number;

  // Partie 1: réglages
  config_validations: Validation[];
  config_note?: string;

  // Partie 2: aperçu (simulation)
  ingest_status?: string | null;
  ingest_validations: Validation[];
  sample_items: AdminTestSourceSampleItem[];
  preview_note?: string;
};

type ToastKind = "success" | "error" | "info";
type ToastState = { kind: ToastKind; message: string } | null;

type LastAction = {
  at: number;
  action: "verify" | "import" | "toggle" | "discard" | "ready" | "save_rss";
  code?: string;
  ok: boolean;
  message: string;
  db?: AdminValidateImportResult["stats"] | null;
};

function asInt(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getExpireDays(r: JobSourceRow): number | null {
  const n = asInt(r?.ingest_config?.expire_after_days);
  return n ?? null;
}

function badgeForMethod(method: string | null) {
  const m = (method ?? "").toLowerCase();
  if (m === "rss" || m === "rss_generic") return { label: "RSS", cls: "badge--blue" };
  if (m === "scrape") return { label: "Scraping", cls: "badge--gray" };
  if (m === "api") return { label: "API", cls: "badge--purple" };
  return { label: method ?? "—", cls: "badge--info" };
}

function badgeForStatus(status: string | null) {
  const s = (status ?? "").toLowerCase();
  if (s === "ready") return { label: "Prête", cls: "badge--green" };
  if (s === "draft" || s === "") return { label: "À configurer", cls: "badge--yellow" };
  if (s.includes("error") || s.includes("fail")) return { label: "Erreur", cls: "badge--red" };
  if (!status) return { label: "—", cls: "badge--info" };
  return { label: status, cls: "badge--info" };
}

function formatWhen(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function isRssLike(row: JobSourceRow) {
  const m = String(row.ingest_method ?? "").toLowerCase();
  return m === "rss" || m === "rss_generic";
}

function hasValidationError(list: Validation[] | undefined) {
  return (list ?? []).some((v) => v.level === "error");
}

function isIngestOk(d: VerifyDetail) {
  const s = String(d.ingest_status ?? "").toLowerCase();
  const bad = !s || s.includes("error") || s.includes("fail") || s.includes("unauthorized");
  return !bad && (d.sample_items?.length ?? 0) > 0;
}

function errMsg(res: any): string {
  // AdminInvokeResponse<T>
  if (res?.error?.message) {
    const s = res?.error?.status ? ` (HTTP ${res.error.status})` : "";
    return `${res.error.message}${s}`;
  }
  // supabase.functions.invoke direct
  if (res?.error?.message) return res.error.message;
  return "Erreur serveur";
}

export default function AdminSourcesPage() {
  const formRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(false);

  // busy states
  const [savingRss, setSavingRss] = useState(false);
  const [togglingCode, setTogglingCode] = useState<string | null>(null);
  const [configuringCode, setConfiguringCode] = useState<string | null>(null);
  const [verifyingCode, setVerifyingCode] = useState<string | null>(null);
  const [importingCode, setImportingCode] = useState<string | null>(null);

  const [rows, setRows] = useState<JobSourceRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // ✅ toast + dernière action (persistante)
  const [toast, setToast] = useState<ToastState>(null);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);

  // results (persistent)
  const [details, setDetails] = useState<Record<string, VerifyDetail>>({});
  const [detailErr, setDetailErr] = useState<Record<string, string>>({});

  // Filtres
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);

  // Form RSS
  const [rssCode, setRssCode] = useState("jobicy_rss");
  const [rssName, setRssName] = useState("Jobicy (Remote) RSS");
  const [rssFeedUrl, setRssFeedUrl] = useState("https://jobicy.com/feed/job_feed");
  const [rssDefaultLocation, setRssDefaultLocation] = useState("Remote");
  const [rssExpireDays, setRssExpireDays] = useState<number>(7);
  const [rssActivate, setRssActivate] = useState<boolean>(true);

  const rowByCode = useMemo(() => {
    const m: Record<string, JobSourceRow> = {};
    for (const r of rows) m[String(r.code ?? "").toLowerCase()] = r;
    return m;
  }, [rows]);

  const counts = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => !!r.is_active).length;
    const rss = rows.filter((r) => ["rss", "rss_generic"].includes((r.ingest_method ?? "").toLowerCase())).length;
    const scrape = rows.filter((r) => (r.ingest_method ?? "").toLowerCase() === "scrape").length;
    const api = rows.filter((r) => (r.ingest_method ?? "").toLowerCase() === "api").length;
    return { total, active, rss, scrape, api };
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeOnly && !r.is_active) return false;
      if (!s) return true;
      return (r.code ?? "").toLowerCase().includes(s) || (r.name ?? "").toLowerCase().includes(s);
    });
  }, [rows, q, activeOnly]);

  function showToast(kind: ToastKind, message: string, ms = 6000) {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ kind, message });
    toastTimerRef.current = window.setTimeout(() => setToast(null), ms);
  }

  function dismissToast() {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(null);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  function scrollToResults() {
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function clearResults() {
    setDetails({});
    setDetailErr({});
    setLastAction(null);
    dismissToast();
    setErr(null);
  }

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const res = await adminListSources();

      if (res.error) {
        setErr(errMsg(res));
        return;
      }

      if (!res.data?.ok) {
        setErr(res.data?.message ?? "Réponse inattendue du serveur.");
        return;
      }

      setRows((res.data.sources ?? []) as JobSourceRow[]);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onVerify(codeRaw: string) {
    const code = String(codeRaw ?? "").trim().toLowerCase();
    if (!code) return;

    setVerifyingCode(code);
    setDetailErr((p) => ({ ...p, [code]: "" }));
    setErr(null);

    const at = Date.now();

    try {
      // 1) Réglages (admin_test_source)
      let config_validations: Validation[] = [];
      let config_note: string | undefined = undefined;

      const resCfg = await adminTestSource(code, 5);
      if (resCfg.error) {
        const msg = errMsg(resCfg);
        setDetailErr((p) => ({ ...p, [code]: msg }));
        setDetails((p) => ({
          ...p,
          [code]: {
            at,
            config_validations: [],
            config_note: "Impossible de vérifier les réglages.",
            ingest_status: null,
            ingest_validations: [],
            sample_items: [],
          },
        }));
        setLastAction({ at, action: "verify", code, ok: false, message: `Vérification KO: ${code}` });
        showToast("error", `Vérification KO: ${code}`);
        scrollToResults();
        return;
      }

      if (!resCfg.data?.ok) {
        const msg = resCfg.data?.message || (resCfg.data as any)?.error || "Vérification (réglages) échouée.";
        setDetailErr((p) => ({ ...p, [code]: msg }));
        setDetails((p) => ({
          ...p,
          [code]: {
            at,
            config_validations: [],
            config_note: "Impossible de vérifier les réglages.",
            ingest_status: null,
            ingest_validations: [],
            sample_items: [],
          },
        }));
        setLastAction({ at, action: "verify", code, ok: false, message: `Vérification KO: ${code}` });
        showToast("error", `Vérification KO: ${code}`);
        scrollToResults();
        return;
      }

      config_validations = (resCfg.data.validations ?? []) as Validation[];
      config_note = resCfg.data.note ?? undefined;

      // 2) Aperçu (simulation) via admin_run_ingest
      const resPrev = await adminRunIngest(code, 5);

      if (resPrev.error) {
        const msg = errMsg(resPrev);
        setDetailErr((p) => ({ ...p, [code]: msg }));
        setDetails((p) => ({
          ...p,
          [code]: {
            at,
            config_validations,
            config_note,
            ingest_status: "error",
            ingest_validations: [{ level: "error", message: "Aperçu impossible (erreur serveur)." }],
            sample_items: [],
            preview_note: "On a vérifié les réglages, mais l’aperçu a échoué.",
          },
        }));
        setLastAction({ at, action: "verify", code, ok: false, message: `Vérification partielle: ${code}` });
        showToast("info", `Vérification partielle: ${code}`);
        scrollToResults();
        return;
      }

      // ✅ FIX TS: resPrev.data peut être null
      const prevData = resPrev.data;
      if (!prevData) {
        const msg = "Aperçu (simulation) échoué: réponse vide.";
        setDetailErr((p) => ({ ...p, [code]: msg }));
        setDetails((p) => ({
          ...p,
          [code]: {
            at,
            config_validations,
            config_note,
            ingest_status: "failed",
            ingest_validations: [{ level: "error", message: msg }],
            sample_items: [],
            preview_note: "On a vérifié les réglages, mais l’aperçu n’est pas disponible.",
          },
        }));
        setLastAction({ at, action: "verify", code, ok: false, message: `Vérification partielle: ${code}` });
        showToast("info", `Vérification partielle: ${code}`);
        scrollToResults();
        return;
      }

      const ok = !!prevData.ok && !!prevData.ingest?.ok;
      if (!ok) {
        const msg =
          prevData.message ||
          prevData.error ||
          prevData.ingest?.message ||
          prevData.ingest?.error ||
          "Aperçu (simulation) échoué.";

        setDetailErr((p) => ({ ...p, [code]: msg }));
        setDetails((p) => ({
          ...p,
          [code]: {
            at,
            config_validations,
            config_note,
            ingest_status: prevData.ingest?.status ?? "failed",
            ingest_validations: [{ level: "error", message: "Aperçu impossible (simulation échouée)." }],
            sample_items: [],
            preview_note: "On a vérifié les réglages, mais l’aperçu n’est pas disponible.",
          },
        }));
        setLastAction({ at, action: "verify", code, ok: false, message: `Vérification partielle: ${code}` });
        showToast("info", `Vérification partielle: ${code}`);
        scrollToResults();
        return;
      }

      const ingest = prevData.ingest;
      const sample = (ingest?.sample ?? []) as any[];

      const ingest_validations: Validation[] = [
        { level: "info", message: `Aperçu: statut=${ingest?.status ?? "—"}` },
        { level: "info", message: "Aucun enregistrement : c’est une simulation." },
      ];
      if (ingest?.feed_url) ingest_validations.push({ level: "info", message: `feed_url=${ingest.feed_url}` });
      if (typeof ingest?.parsed !== "undefined")
        ingest_validations.push({ level: "info", message: `parsed=${JSON.stringify(ingest.parsed)}` });

      const sample_items: AdminTestSourceSampleItem[] = sample.map((x: any) => ({
        title: String(x.title ?? x.external_id ?? "(no title)"),
        url: String(x.url ?? x.source_url ?? x.apply_url ?? ""),
        published_at: x.published_at ? String(x.published_at) : undefined,
      }));

      setDetails((p) => ({
        ...p,
        [code]: {
          at,
          config_validations,
          config_note,
          ingest_status: ingest?.status ?? null,
          ingest_validations,
          sample_items,
          preview_note: "Aperçu des offres trouvé via une simulation d’import (sans écrire en base).",
        },
      }));

      const configOk = !hasValidationError(config_validations);
      const previewOk = sample_items.length > 0 && !String(ingest?.status ?? "").toLowerCase().includes("error");
      const allOk = configOk && previewOk;

      setLastAction({
        at,
        action: "verify",
        code,
        ok: allOk,
        message: allOk ? `Vérification OK: ${code} · ${sample_items.length} aperçu` : `Vérification partielle: ${code}`,
      });

      showToast(
        allOk ? "success" : "info",
        allOk ? `Vérification OK: ${code} · ${sample_items.length} aperçu` : `Vérification partielle: ${code}`,
        6000
      );
      scrollToResults();
    } finally {
      setVerifyingCode(null);
    }
  }

  async function toggleActive(row: JobSourceRow) {
    const next = !(row.is_active ?? false);
    const code = String(row.code ?? "").toLowerCase();

    setTogglingCode(code);
    setErr(null);

    try {
      const res = await adminSetSourceActive({ code, is_active: next });

      if (res.error) throw new Error(errMsg(res));
      if (!res.data?.ok || !res.data.source) throw new Error(res.data?.message ?? "Réponse inattendue du serveur.");

      await load();

      const at = Date.now();
      setLastAction({ at, action: "toggle", code, ok: true, message: `${code} → ${next ? "activée" : "désactivée"}` });
      showToast("success", `${code} → ${next ? "activée" : "désactivée"}`, 6000);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setLastAction({ at: Date.now(), action: "toggle", code, ok: false, message: `Toggle KO: ${code}` });
      showToast("error", `Toggle KO: ${code}`, 6000);
    } finally {
      setTogglingCode(null);
    }
  }

  async function discardSource(codeRaw: string) {
    const code = String(codeRaw ?? "").toLowerCase();
    const row = rowByCode[code];
    if (!row) return;

    setTogglingCode(code);
    setErr(null);

    try {
      const res = await adminSetSourceActive({ code, is_active: false });

      if (res.error) throw new Error(errMsg(res));
      if (!res.data?.ok || !res.data.source) throw new Error(res.data?.message ?? "Réponse inattendue du serveur.");

      await load();

      const at = Date.now();
      setLastAction({ at, action: "discard", code, ok: true, message: `${code} → désactivée (jetée)` });
      showToast("success", `${code} → désactivée (jetée)`, 6000);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setLastAction({ at: Date.now(), action: "discard", code, ok: false, message: `Jeter KO: ${code}` });
      showToast("error", `Jeter KO: ${code}`, 6000);
    } finally {
      setTogglingCode(null);
    }
  }

  async function importNow(codeRaw: string) {

    const code = String(codeRaw ?? "").trim().toLowerCase();
    if (!code) return;

    setImportingCode(code);
    setErr(null);
    setDetailErr((p) => ({ ...p, [code]: "" }));

    try {
      // 1) Import DB
      const res = await adminImportNow(code, 50);

      if (res.error) throw new Error(errMsg(res));
      if (!res.data?.ok) throw new Error(res.data?.message || res.data?.error || "Import impossible.");

      // 2) Reload list (statuts)
      await load();

      const inserted = res.data?.ingest?.inserted ?? res.data?.inserted;
      const updated = res.data?.ingest?.updated ?? res.data?.updated;
      const expired = res.data?.ingest?.expired ?? res.data?.expired;

      // 3) Validation DB (optionnelle)
      let dbStats: AdminValidateImportResult["stats"] | null = null;
      try {
        const v = await adminValidateImport(code);
        if (!v.error && v.data?.ok && v.data?.stats) dbStats = v.data.stats;
      } catch {
        // ignore
      }

      const at = Date.now();

      const baseMsg =
        typeof inserted === "number" || typeof updated === "number" || typeof expired === "number"
          ? `Import OK: ${code} · inserted=${inserted ?? 0} · updated=${updated ?? 0} · expired=${expired ?? 0}`
          : `Import OK: ${code}`;

      const dbMsg = dbStats ? ` · DB: seen10m=${dbStats.seen_last_10m} · total=${dbStats.total_jobs}` : "";

      setLastAction({
        at,
        action: "import",
        code,
        ok: true,
        message: baseMsg + dbMsg,
        db: dbStats,
      });

      showToast("success", baseMsg + dbMsg, 6000);
      scrollToResults();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      setLastAction({ at: Date.now(), action: "import", code, ok: false, message: `Import KO: ${code} · ${msg}` });
      showToast("error", `Import KO: ${code}`, 6000);
    } finally {
      setImportingCode(null);
    }
  }

  async function addOrUpdateRssSource(e: React.FormEvent) {
    e.preventDefault();

    const code = rssCode.trim().toLowerCase();
    const name = rssName.trim();
    const feed_url = rssFeedUrl.trim();
    const default_location = rssDefaultLocation.trim();

    if (!code) return setErr("👉 Le code source est obligatoire.");
    if (!name) return setErr("👉 Le nom affiché est obligatoire.");
    if (!feed_url.startsWith("http")) return setErr("👉 Le lien du feed doit commencer par http/https.");

    setSavingRss(true);
    setErr(null);

    try {
      const res = await adminConfigureRssSource({
        code,
        name,
        feed_url,
        default_location,
        expire_after_days: rssExpireDays,
        activate: rssActivate,
      });

      if (res.error) throw new Error(errMsg(res));
      if (!res.data?.ok || !res.data.source) throw new Error(res.data?.message ?? "Réponse inattendue du serveur.");

      await load();

      const at = Date.now();
      setLastAction({ at, action: "save_rss", code, ok: true, message: "Source RSS enregistrée" });
      showToast("success", "Source RSS enregistrée", 6000);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setLastAction({ at: Date.now(), action: "save_rss", code, ok: false, message: "Enregistrement RSS KO" });
      showToast("error", "Enregistrement RSS KO", 6000);
    } finally {
      setSavingRss(false);
    }
  }

  async function markReadyOneClick(row: JobSourceRow) {
    const code = String(row.code ?? "").toLowerCase();

    setConfiguringCode(code);
    setErr(null);

    try {
      const res = await adminMarkSourceReady({ code, activate: true });

      if (res.error) throw new Error(errMsg(res));
      if (!res.data?.ok || !res.data.source) throw new Error(res.data?.message ?? "Réponse inattendue du serveur.");

      await load();

      const at = Date.now();
      setLastAction({ at, action: "ready", code, ok: true, message: `${code} → validée & activée` });
      showToast("success", `${code} → validée & activée`, 6000);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setLastAction({ at: Date.now(), action: "ready", code, ok: false, message: `Valider & activer KO: ${code}` });
      showToast("error", `Valider & activer KO: ${code}`, 6000);
    } finally {
      setConfiguringCode(null);
    }
  }

  function prefillRssFromRow(r: JobSourceRow) {
    setRssCode(r.code);
    setRssName(r.name ?? "");
    setRssFeedUrl(r.ingest_config?.feed_url ?? "");
    setRssDefaultLocation(r.ingest_config?.default_location ?? "Remote");
    setRssExpireDays(asInt(r.ingest_config?.expire_after_days) ?? 7);
    setRssActivate(!!r.is_active);

    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  const anyBusy = loading || savingRss || !!togglingCode || !!configuringCode || !!verifyingCode || !!importingCode;

  const hasAny = Object.keys(details).length > 0 || !!lastAction;

  return (
    <div className="adminSources">
      <div className="adminSources__top">
        <div>
          <h1>Admin · Sources</h1>

          <div className="subtitle">
            Ici tu gères les “sites” qui alimentent JobRadar (RSS, scraping, API).
            <br />
            <strong>Parcours recommandé :</strong> ① Configurer → ② Vérifier → ③ Importer maintenant → (option) ④ Valider
            & activer (cron).
          </div>

          <div className="chips">
            <span className="chip">Total : {counts.total}</span>
            <span className="chip">Actives : {counts.active}</span>
            <span className="chip">RSS : {counts.rss}</span>
            <span className="chip">Scraping : {counts.scrape}</span>
            <span className="chip">API : {counts.api}</span>
          </div>
        </div>

        <div className="topActions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {hasAny ? (
            <button className="btn btn--ghost" onClick={clearResults} disabled={anyBusy} title="Efface le panneau Résultats">
              Effacer résultats
            </button>
          ) : null}

          <button className="btn btn--ghost" onClick={() => void load()} disabled={anyBusy}>
            {loading ? "Chargement…" : "Rafraîchir"}
          </button>
        </div>
      </div>

      {toast ? (
        <div
          className={`notice ${
            toast.kind === "success" ? "notice--success" : toast.kind === "error" ? "notice--error" : ""
          }`}
        >
          <div className="notice__row">
            <strong>{toast.kind === "success" ? "OK." : toast.kind === "error" ? "Oups." : "Info."}</strong>
            <button className="notice__close" type="button" onClick={dismissToast} aria-label="Fermer">
              ✕
            </button>
          </div>
          <div className="notice__text">{toast.message}</div>
        </div>
      ) : null}

      {err ? (
        <div className="notice notice--error">
          <div className="notice__row">
            <strong>Oups.</strong>
            <button className="notice__close" type="button" onClick={() => setErr(null)} aria-label="Fermer">
              ✕
            </button>
          </div>
          <div className="notice__text">{err}</div>
        </div>
      ) : null}

      {hasAny ? (
        <div className="testPanel" ref={resultsRef}>
          <div
            className="testPanel__title"
            style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}
          >
            <div>
              <h3>Résultats</h3>
              <div className="muted">
                <strong>Vérifier la source</strong> fait 2 choses : (1) contrôle des réglages (2) aperçu des offres
                (simulation).
              </div>

              {lastAction ? (
                <div className="lastAction">
                  <div className="muted">
                    <strong>Dernière action :</strong>{" "}
                    <span className={lastAction.ok ? "lastAction__ok" : "lastAction__ko"}>
                      {lastAction.action.toUpperCase()}
                      {lastAction.code ? ` · ${lastAction.code}` : ""}
                      {" · "}
                      {lastAction.ok ? "OK" : "KO"}
                      {" · "}
                      {formatTime(lastAction.at)}
                    </span>
                  </div>

                  <div className="muted" style={{ marginTop: 4 }}>
                    {lastAction.message}
                  </div>

                  {lastAction.action === "import" && lastAction.db ? (
                    <div className="muted" style={{ marginTop: 6 }}>
                      <strong>Preuve DB :</strong> total={lastAction.db.total_jobs} · actifs={lastAction.db.active_jobs} ·
                      seen10m={lastAction.db.seen_last_10m} · created10m={lastAction.db.created_last_10m}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Astuce : si c’est OK ✅ → clique <strong>Importer maintenant</strong>.
            </div>
          </div>

          {Object.entries(details)
            .sort((a, b) => b[1].at - a[1].at)
            .map(([code, d]) => {
              const row = rowByCode[String(code).toLowerCase()];
              const configOk = !hasValidationError(d.config_validations);
              const previewOk = isIngestOk(d);
              const allOk = configOk && previewOk;

              const needsReady = ((row?.ingest_status ?? "").toLowerCase() || "") !== "ready";
              const isRowBusy =
                importingCode === code ||
                togglingCode === code ||
                configuringCode === code ||
                verifyingCode === code ||
                savingRss;

              const canEdit = !!row && isRssLike(row);

              const nextActionText = allOk
                ? "✅ La source est prête. Tu peux importer maintenant (écrit en base)."
                : configOk && !previewOk
                ? "⚠️ Réglages OK, mais aperçu KO. Corrige puis re-vérifie."
                : "❌ Problème dans les réglages. Corrige puis re-vérifie.";

              return (
                <div key={code} style={{ marginTop: 12 }}>
                  <div className="inline" style={{ justifyContent: "space-between" }}>
                    <strong className="mono">{code}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {formatWhen(d.at)}
                    </span>
                  </div>

                  <div className="muted" style={{ marginTop: 6 }}>
                    <strong>Prochaine action :</strong> {nextActionText}
                  </div>

                  <div className="inline" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
                    {allOk ? (
                      <button
                        className="btn btn--primary"
                        type="button"
                        disabled={!!isRowBusy}
                        onClick={() => void importNow(code)}
                        title="Import immédiat (écrit en base)"
                      >
                        {importingCode === code ? "Import…" : "Importer maintenant"}
                      </button>
                    ) : null}

                    {row && needsReady ? (
                      <button
                        className="btn"
                        type="button"
                        disabled={!!isRowBusy}
                        onClick={() => void markReadyOneClick(row)}
                        title="Passe la source en 'ready' et l'active (cron)"
                      >
                        {configuringCode === row.code ? "…" : "Valider & activer"}
                      </button>
                    ) : null}

                    {!allOk && canEdit && row ? (
                      <button
                        className="btn"
                        type="button"
                        disabled={!!isRowBusy}
                        onClick={() => prefillRssFromRow(row)}
                        title="Ouvre le formulaire avec cette source"
                      >
                        Éditer
                      </button>
                    ) : null}

                    {row ? (
                      <button
                        className="btn"
                        type="button"
                        disabled={!!isRowBusy}
                        onClick={() => void discardSource(row.code)}
                        title="Désactive la source"
                      >
                        {togglingCode === row.code ? "…" : "Jeter (désactiver)"}
                      </button>
                    ) : null}

                    <button
                      className="btn"
                      type="button"
                      disabled={!!isRowBusy}
                      onClick={() => void onVerify(code)}
                      title="Relance la vérification."
                    >
                      {verifyingCode === code ? "Vérification..." : "Re-vérifier"}
                    </button>
                  </div>

                  {detailErr[code] ? (
                    <div className="notice notice--error" style={{ marginTop: 8 }}>
                      <div className="notice__text">{detailErr[code]}</div>
                    </div>
                  ) : null}

                  <div style={{ marginTop: 10 }}>
                    <div className="inline" style={{ gap: 8 }}>
                      <span className="badge badge--gray">1</span>
                      <strong>Réglages</strong>
                      <span className="muted">(droits + configuration)</span>
                    </div>

                    {d.config_note ? <div className="muted" style={{ marginTop: 6 }}>{d.config_note}</div> : null}

                    {d.config_validations?.length ? (
                      <ul className="valList" style={{ marginTop: 8 }}>
                        {d.config_validations.map((v, i) => (
                          <li key={i} className="val">
                            <span
                              className={`badge badge--${
                                v.level === "error" ? "red" : v.level === "warn" ? "yellow" : "gray"
                              }`}
                            >
                              {v.level}
                            </span>
                            <span>{v.message}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted" style={{ marginTop: 8 }}>
                        (Pas d’infos réglages.)
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div className="inline" style={{ gap: 8 }}>
                      <span className="badge badge--gray">2</span>
                      <strong>Aperçu des offres</strong>
                      <span className="muted">(simulation : n’enregistre rien)</span>
                    </div>

                    {d.preview_note ? <div className="muted" style={{ marginTop: 6 }}>{d.preview_note}</div> : null}

                    {d.ingest_validations?.length ? (
                      <ul className="valList" style={{ marginTop: 8 }}>
                        {d.ingest_validations.map((v, i) => (
                          <li key={i} className="val">
                            <span
                              className={`badge badge--${
                                v.level === "error" ? "red" : v.level === "warn" ? "yellow" : "gray"
                              }`}
                            >
                              {v.level}
                            </span>
                            <span>{v.message}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {d.sample_items?.length ? (
                      <div style={{ marginTop: 10 }}>
                        <div className="muted" style={{ marginBottom: 6 }}>
                          Aperçu (sample)
                        </div>
                        <ul className="valList">
                          {d.sample_items.slice(0, 5).map((it, idx) => (
                            <li key={idx} className="val" style={{ alignItems: "flex-start" }}>
                              <span className="badge badge--gray">item</span>
                              <span>
                                <div style={{ fontWeight: 600 }}>{it.title}</div>
                                {it.url ? (
                                  <a href={it.url} target="_blank" rel="noreferrer" className="mono">
                                    {it.url}
                                  </a>
                                ) : (
                                  <div className="muted">(no url)</div>
                                )}
                                {it.published_at ? <div className="muted">{it.published_at}</div> : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="muted" style={{ marginTop: 10 }}>
                        Aucun aperçu disponible (pour cette source / méthode).
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      ) : null}

      <div className="grid">
        <section className="card" ref={formRef}>
          <div className="card__titleRow">
            <h2>Ajouter / mettre à jour une source RSS</h2>
            <span className="badge badge--blue">Simple</span>
          </div>
          <div className="muted">
            Une source RSS = un lien “feed” qui publie des offres. JobRadar va le lire et créer/mettre à jour les offres.
          </div>

          <form className="form" onSubmit={addOrUpdateRssSource}>
            <div className="formRow">
              <label>Code source (unique)</label>
              <input value={rssCode} onChange={(e) => setRssCode(e.target.value)} placeholder="ex: jobicy_rss" />
              <small>Astuce : minuscules + underscore (ex: jobicy_rss, weworkremotely_rss).</small>
            </div>

            <div className="formRow">
              <label>Nom affiché</label>
              <input value={rssName} onChange={(e) => setRssName(e.target.value)} placeholder="Ex: Jobicy (Remote) RSS" />
              <small>Ce nom est affiché dans l’interface admin (obligatoire).</small>
            </div>

            <div className="formRow">
              <label>Feed URL</label>
              <input value={rssFeedUrl} onChange={(e) => setRssFeedUrl(e.target.value)} placeholder="https://.../feed" />
            </div>

            <div className="formRow">
              <label>Localisation par défaut</label>
              <input
                value={rssDefaultLocation}
                onChange={(e) => setRssDefaultLocation(e.target.value)}
                placeholder="Ex: Remote, Abidjan…"
              />
              <small>Si le flux ne donne pas de pays/ville, on mettra ceci.</small>
            </div>

            <div className="formRow inline">
              <div style={{ flex: 1 }}>
                <label>Durée avant expiration (jours)</label>
                <input
                  className="w120"
                  type="number"
                  min={1}
                  value={rssExpireDays}
                  onChange={(e) => setRssExpireDays(asInt(e.target.value) ?? 7)}
                />
                <small>Après X jours sans être revue, l’offre peut être marquée “expirée”.</small>
              </div>
            </div>

            <div className="formRow inline" style={{ alignItems: "center", gap: 10 }}>
              <label className="toggleLabel" style={{ margin: 0 }}>
                <input type="checkbox" checked={rssActivate} onChange={(e) => setRssActivate(e.target.checked)} />
                Activer la source après sauvegarde
              </label>
            </div>

            <div className="formRow">
              <button className="btn btn--primary" type="submit" disabled={savingRss}>
                {savingRss ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
          </form>

          <div className="hint">
            <strong>Astuce :</strong> tu peux aussi cliquer “Éditer” sur une source RSS dans la liste pour remplir le formulaire automatiquement.
          </div>
        </section>

        <section className="card">
          <div className="card__titleRow">
            <h2>Sources existantes</h2>
            <div className="filters">
              <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (nom ou code)…" />
              <label className="toggleLabel">
                <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
                Actives seulement
              </label>
            </div>
          </div>

          {loading ? (
            <div className="muted">Chargement…</div>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Code</th>
                    <th>Méthode</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={4}>
                        Aucune source trouvée.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => {
                      const method = badgeForMethod(r.ingest_method);
                      const status = badgeForStatus(r.ingest_status);
                      const exp = getExpireDays(r);

                      const statusLower = (r.ingest_status ?? "").toLowerCase();
                      const needsReady = statusLower !== "ready";

                      const code = String(r.code ?? "").toLowerCase();

                      const isRowBusy =
                        togglingCode === code ||
                        configuringCode === code ||
                        verifyingCode === code ||
                        importingCode === code ||
                        savingRss;

                      const last = details[code];
                      const lastOk = last ? !hasValidationError(last.config_validations) && isIngestOk(last) : false;

                      return (
                        <tr key={r.id}>
                          <td>
                            <div className="inline" style={{ gap: 8, flexWrap: "wrap" }}>
                              <span>{r.name ?? "—"}</span>
                              <span className={`badge ${status.cls}`}>{status.label}</span>
                              {typeof exp === "number" ? <span className="badge badge--gray">Expire: {exp}j</span> : null}
                              {last ? (
                                <span className={`badge ${lastOk ? "badge--green" : "badge--yellow"}`}>
                                  {lastOk ? "Vérif OK" : "Vérif KO"}
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td className="codeCell">
                            <span className="mono">{r.code}</span>
                            {isRssLike(r) && r.ingest_config?.feed_url ? (
                              <span className="sub">{r.ingest_config.feed_url}</span>
                            ) : null}
                          </td>

                          <td>
                            <span className={`badge ${method.cls}`}>{method.label}</span>
                          </td>

                          <td className="right">
                            <div className="inline" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                              <button
                                className={`switch ${r.is_active ? "switch--on" : ""}`}
                                onClick={() => void toggleActive(r)}
                                disabled={!!isRowBusy}
                                type="button"
                                title={r.is_active ? "Désactiver cette source" : "Activer cette source"}
                              >
                                <span className="switch__dot" />
                                <span className="switch__label">
                                  {togglingCode === code ? "…" : r.is_active ? "ON" : "OFF"}
                                </span>
                              </button>

                              {isRssLike(r) ? (
                                <button className="btn" type="button" onClick={() => prefillRssFromRow(r)} disabled={!!isRowBusy}>
                                  Éditer
                                </button>
                              ) : null}

                              {lastOk ? (
                                <button
                                  className="btn btn--primary"
                                  type="button"
                                  onClick={() => void importNow(r.code)}
                                  disabled={!!isRowBusy}
                                  title="Import immédiat (écrit en base)"
                                >
                                  {importingCode === code ? "Import…" : "Importer maintenant"}
                                </button>
                              ) : null}

                              {needsReady ? (
                                <button
                                  className="btn btn--primary"
                                  onClick={() => void markReadyOneClick(r)}
                                  disabled={!!isRowBusy}
                                  type="button"
                                  title="Passe la source en 'ready' et l'active"
                                >
                                  {configuringCode === code ? "…" : "Valider & activer"}
                                </button>
                              ) : null}

                              <button
                                className="btn"
                                onClick={() => void onVerify(r.code)}
                                disabled={!!isRowBusy}
                                type="button"
                                title="Contrôle les réglages + montre un aperçu (simulation)."
                              >
                                {verifyingCode === code ? "Vérification..." : "Vérifier la source"}
                              </button>
                            </div>

                            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                              Prochaine action :{" "}
                              {lastOk ? (
                                <strong>Importer maintenant</strong>
                              ) : needsReady ? (
                                <strong>Valider & activer</strong>
                              ) : (
                                <strong>Vérifier</strong>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
