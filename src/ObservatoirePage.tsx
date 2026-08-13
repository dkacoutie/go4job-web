import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchObservatoireSnapshot,
  OBSERVATOIRE_MARKETS,
  type ObservatoireMarketKey,
  type ObservatoireSnapshot,
} from "./lib/publicObservatoire";
import { usePageMeta } from "./lib/usePageMeta";
import "./ObservatoirePage.css";

// JR-SEO, 13/08/2026 : Observatoire de l'emploi -- premier contenu
// statistique original du site (asset "linkable" pour la strategie de
// netlinking, voir le doc projet claude/netlinking-strategie-jobradar.md, et
// signal E-E-A-T complementaire a /qui-sommes-nous). Lit un snapshot
// precalcule (voir lib/publicObservatoire.ts) -- jamais d'agregation en
// direct sur cette page.
//
// Metriques choisies apres audit reel de la couverture des champs (pas
// supposees) : pas de statistique par ville (champ location trop
// heterogene), pas de salaire hors Royaume-Uni (donnees France melangeant
// taux horaire/mensuel/annuel sans champ periode fiable -- voir migration
// 20260813090000).

function isMarketKey(v: string | null): v is ObservatoireMarketKey {
  return v === "GLOBAL" || v === "FR" || v === "GB" || v === "US" || v === "CI";
}

function formatCount(n: number): string {
  return n.toLocaleString("fr-FR");
}

export default function ObservatoirePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const marketParam = searchParams.get("marche");
  const market: ObservatoireMarketKey = isMarketKey(marketParam) ? marketParam : "GLOBAL";

  const [snapshot, setSnapshot] = useState<ObservatoireSnapshot | null>(null);
  const [error, setError] = useState(false);

  const marketConfig = OBSERVATOIRE_MARKETS.find((m) => m.key === market) ?? OBSERVATOIRE_MARKETS[0];

  usePageMeta({
    title:
      market === "GLOBAL"
        ? "Observatoire de l'emploi"
        : `Observatoire de l'emploi - ${marketConfig.label}`,
    description: `Statistiques sur les offres d'emploi suivies par JobRadar${
      market === "GLOBAL" ? " dans le monde" : ` en ${marketConfig.label}`
    } : types de contrat, télétravail, entreprises qui recrutent le plus.`,
    path: market === "GLOBAL" ? "/observatoire-emploi" : `/observatoire-emploi?marche=${market}`,
  });

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setError(false);
    fetchObservatoireSnapshot(market)
      .then((data) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [market]);

  function selectMarket(key: ObservatoireMarketKey) {
    if (key === "GLOBAL") {
      setSearchParams({});
    } else {
      setSearchParams({ marche: key });
    }
  }

  const contractTotal = snapshot
    ? snapshot.contract_type_breakdown.reduce((sum, b) => sum + b.n, 0)
    : 0;
  const remoteCovered = snapshot?.remote_breakdown.covered ?? 0;
  const remoteCoveragePct =
    snapshot && snapshot.total_active > 0 ? Math.round((remoteCovered / snapshot.total_active) * 100) : 0;

  return (
    <div className="app-narrow observatoire">
      <h1>Observatoire de l'emploi</h1>
      <p className="observatoire__lead">
        Des statistiques calculées à partir des offres suivies par JobRadar, mises à jour chaque jour.
        Pas un sondage, pas une estimation externe : ce sont les offres réellement présentes dans notre
        catalogue au jour le jour.
      </p>

      <nav className="observatoire__marketTabs" aria-label="Choisir un marché">
        {OBSERVATOIRE_MARKETS.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`observatoire__marketTab${m.key === market ? " is-active" : ""}`}
            onClick={() => selectMarket(m.key)}
            aria-current={m.key === market ? "true" : undefined}
          >
            {m.label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="observatoire__error">
          Les statistiques ne sont pas disponibles pour le moment. Réessaie dans quelques instants, ou{" "}
          <Link to="/offres">consulte les offres</Link> directement.
        </p>
      )}

      {!error && snapshot === null && (
        <div className="observatoire__skeleton" aria-busy="true">
          Chargement des statistiques…
        </div>
      )}

      {!error && snapshot !== null && (
        <>
          <div className="observatoire__headline">
            <div className="observatoire__stat">
              <span className="observatoire__statValue">{formatCount(snapshot.total_active)}</span>
              <span className="observatoire__statLabel">offres actives{market !== "GLOBAL" ? ` — ${marketConfig.label}` : ""}</span>
            </div>
            <div className="observatoire__stat">
              <span className="observatoire__statValue">{formatCount(snapshot.new_last_7d)}</span>
              <span className="observatoire__statLabel">nouvelles offres sur 7 jours</span>
            </div>
            <div className="observatoire__stat">
              <span className="observatoire__statValue">{formatCount(snapshot.new_last_30d)}</span>
              <span className="observatoire__statLabel">nouvelles offres sur 30 jours</span>
            </div>
          </div>

          {snapshot.contract_type_breakdown.length > 0 && (
            <section className="observatoire__section">
              <h2>Types de contrat</h2>
              <p className="observatoire__caveat">
                Sur les {formatCount(contractTotal)} offres où le type de contrat est précisé
                {snapshot.total_active > 0
                  ? ` (${Math.round((contractTotal / snapshot.total_active) * 100)}% du catalogue ${marketConfig.label !== "Monde" ? marketConfig.label : ""})`
                  : ""}
                .
              </p>
              <ul className="observatoire__bars">
                {snapshot.contract_type_breakdown.map((b) => {
                  const pct = contractTotal > 0 ? Math.round((b.n / contractTotal) * 100) : 0;
                  return (
                    <li key={b.bucket} className="observatoire__barRow">
                      <span className="observatoire__barLabel">{b.bucket}</span>
                      <span className="observatoire__barTrack">
                        <span className="observatoire__barFill" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="observatoire__barValue">{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {remoteCovered > 0 && (
            <section className="observatoire__section">
              <h2>Télétravail</h2>
              <p className="observatoire__caveat">
                Sur les {formatCount(remoteCovered)} offres où le mode de travail est précisé
                {snapshot.total_active > 0 ? ` (${remoteCoveragePct}% du catalogue)` : ""}.
              </p>
              <ul className="observatoire__bars">
                {[
                  { label: "Télétravail", n: snapshot.remote_breakdown.remote },
                  { label: "Hybride", n: snapshot.remote_breakdown.hybrid },
                  { label: "Sur site", n: snapshot.remote_breakdown.on_site },
                ]
                  .filter((r) => r.n > 0)
                  .map((r) => {
                    const pct = Math.round((r.n / remoteCovered) * 100);
                    return (
                      <li key={r.label} className="observatoire__barRow">
                        <span className="observatoire__barLabel">{r.label}</span>
                        <span className="observatoire__barTrack">
                          <span className="observatoire__barFill" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="observatoire__barValue">{pct}%</span>
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}

          {snapshot.salary_stats && (
            <section className="observatoire__section">
              <h2>Salaires</h2>
              <p className="observatoire__caveat">
                Médiane calculée sur les {formatCount(snapshot.salary_stats.covered)} offres où un salaire est
                affiché.
              </p>
              <p className="observatoire__salaryRange">
                {Math.round(snapshot.salary_stats.median_min ?? 0).toLocaleString("fr-FR")} —{" "}
                {Math.round(snapshot.salary_stats.median_max ?? 0).toLocaleString("fr-FR")}{" "}
                {snapshot.salary_stats.currency} / an
              </p>
            </section>
          )}

          {snapshot.top_companies.length > 0 && (
            <section className="observatoire__section">
              <h2>Entreprises qui recrutent le plus</h2>
              <ol className="observatoire__companies">
                {snapshot.top_companies.map((c) => (
                  <li key={c.name}>
                    <span>{c.name}</span>
                    <span className="observatoire__companyCount">{formatCount(c.n)} offres</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <p className="observatoire__generatedAt">
            Statistiques mises à jour le{" "}
            {new Date(snapshot.generated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.
          </p>

          <div className="observatoire__cta">
            {marketConfig.offersPath ? (
              <Link className="btn btnPrimary" to={marketConfig.offersPath}>
                Voir les offres {marketConfig.label !== "Monde" ? `— ${marketConfig.label}` : ""}
              </Link>
            ) : (
              <Link className="btn btnPrimary" to="/offres">
                Voir les offres
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
