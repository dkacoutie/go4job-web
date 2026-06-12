import { useMemo, useState, type FormEvent } from "react";

import capCarriereLogo from "./assets/capcarriere-logo.png";
import { supabase, supabaseConfigError } from "./lib/supabaseClient";
import { trackMetaCustomEvent } from "./lib/metaPixel";
import "./CvAtsLandingPage.css";

type QualificationStatus =
  | "active_search"
  | "new_graduate"
  | "employed_better_opportunity"
  | "career_change"
  | "watching_opportunities";

type QualificationResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
};

const OPTIONS: Array<{ value: QualificationStatus; label: string }> = [
  { value: "active_search", label: "Je cherche activement un emploi" },
  { value: "new_graduate", label: "Je suis jeune diplômé(e)" },
  { value: "employed_better_opportunity", label: "Je suis salarié(e) et je cherche une meilleure opportunité" },
  { value: "career_change", label: "Je suis en reconversion" },
  { value: "watching_opportunities", label: "Je regarde simplement les opportunités" },
];

const JOBRADAR_FEED_PATH = "/jobradar/feed";
const CVATS_BUILD_MARKER = "cv-ats-111d3c0-plus";
const SUPABASE_FRONTEND_CONFIG_MESSAGE =
  "Configuration momentanément indisponible. Vous pouvez continuer vers JobRadar.";

function getLeadId() {
  try {
    return sessionStorage.getItem("cv_ats_lead_id") || "";
  } catch {
    return "";
  }
}

function LogoMark() {
  return (
    <div className="cvats-brand" aria-label="CapCarrière par Go4Job">
      <img className="cvats-brand__logo" src={capCarriereLogo} alt="CapCarrière" />
      <span className="cvats-brand__fallback">CapCarrière</span>
      <span className="cvats-brand__by">par Go4Job</span>
    </div>
  );
}

export default function CvAtsThankYouPage() {
  const leadId = useMemo(() => getLeadId(), []);
  const [selected, setSelected] = useState<QualificationStatus | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (!leadId) {
      setStatus("error");
      setMessage("Votre réponse ne peut pas être enregistrée ici, mais vous pouvez continuer vers JobRadar.");
      return;
    }

    if (!selected) {
      setStatus("error");
      setMessage("Choisissez une réponse, ou continuez simplement vers JobRadar.");
      return;
    }

    if (supabaseConfigError) {
      setStatus("error");
      setMessage(SUPABASE_FRONTEND_CONFIG_MESSAGE);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke<QualificationResponse>(
        "update-cv-ats-lead-qualification",
        {
          body: {
            lead_id: leadId,
            job_search_status: selected,
          },
        },
      );

      if (error || !data?.ok) {
        throw new Error(data?.message || data?.error || error?.message || "qualification_failed");
      }

      setStatus("success");
      setMessage("Merci, votre réponse a bien été enregistrée.");
      trackMetaCustomEvent("CVATSQualificationCompleted", { job_search_status: selected });
    } catch {
      setStatus("error");
      setMessage("Impossible d'enregistrer la réponse pour le moment. Vous pouvez continuer vers JobRadar.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleJobRadarClick = () => {
    trackMetaCustomEvent("CVATSJobRadarClick", { destination: JOBRADAR_FEED_PATH });
  };

  return (
    <div className="cvats-page cvats-thanks" data-capcarriere-cvats-build={CVATS_BUILD_MARKER}>
      <header className="cvats-header">
        <LogoMark />
      </header>

      <main className="cvats-thanks__grid">
        <section className="cvats-thanks__intro">
          <div className="cvats-eyebrow">Inscription confirmée</div>
          <h1>Votre guide est en route !</h1>
          <p>Vérifiez votre boîte mail dans les prochaines minutes.</p>
        </section>

        <section className="cvats-qualification" aria-labelledby="cvats-qualification-title">
          <div className="cvats-section__header">
            <span className="cvats-section__eyebrow">Une dernière chose</span>
            <h2 id="cvats-qualification-title">Une dernière chose — ça nous aide beaucoup</h2>
            <p>
              Où en êtes-vous dans votre recherche ? Votre réponse nous permet de vous envoyer des conseils plus
              adaptés.
            </p>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="cvats-options">
              {OPTIONS.map((option) => (
                <label key={option.value} className="cvats-option">
                  <input
                    type="radio"
                    name="job_search_status"
                    value={option.value}
                    checked={selected === option.value}
                    onChange={() => setSelected(option.value)}
                    disabled={!leadId || status === "success"}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <button
              className="cvats-primaryBtn"
              type="submit"
              disabled={submitting || !leadId || status === "success" || supabaseConfigError}
            >
              {submitting ? "Validation..." : "Valider ma réponse"}
            </button>
            {supabaseConfigError && <div className="cvats-softNote">{SUPABASE_FRONTEND_CONFIG_MESSAGE}</div>}
            {!leadId && (
              <div className="cvats-softNote">
                La qualification est indisponible dans cette session, mais votre guide reste en route.
              </div>
            )}
            {message && (
              <div className={status === "success" ? "cvats-successBox" : "cvats-errorBox"} role="status">
                {message}
              </div>
            )}
          </form>
        </section>

        <section className="cvats-nextStep">
          <h2>Un CV plus clair, c'est une excellente base</h2>
          <p>
            La suite, c'est de repérer les bonnes opportunités au bon moment. JobRadar vous aide à centraliser les
            offres qui correspondent à votre profil.
          </p>
          <a className="cvats-secondaryBtn" href={JOBRADAR_FEED_PATH} onClick={handleJobRadarClick}>
            Découvrir JobRadar
          </a>
          <div className="cvats-tip">
            En attendant, posez-vous cette question simple : est-ce qu'un recruteur comprend ce que vous savez faire en
            moins de 30 secondes en lisant votre CV ?
          </div>
        </section>
      </main>
    </div>
  );
}
