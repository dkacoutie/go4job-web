import {
  JOBRADAR_FLOW_STEPS,
  type JobRadarOnboardingStep,
  getFlowStepIndex,
} from "../lib/jobradarOnboarding";
import "./OnboardingStepper.css";

type StepStatus = "done" | "current" | "upcoming";

export default function OnboardingStepper({
  currentStep,
  completedSteps = [],
  compact = false,
  showSummary = true,
}: {
  currentStep: Exclude<JobRadarOnboardingStep, "done">;
  completedSteps?: Array<Exclude<JobRadarOnboardingStep, "done">>;
  compact?: boolean;
  showSummary?: boolean;
}) {
  const currentIndex = getFlowStepIndex(currentStep);
  const totalSteps = JOBRADAR_FLOW_STEPS.length;

  return (
    <div className={`onbStepper${compact ? " onbStepper--compact" : ""}`}>
      {showSummary && (
        <div className="onbStepper__summary">
          <div className="onbStepper__summaryLabel">Parcours JobRadar</div>
          <div className="onbStepper__summaryProgress">
            Étape {currentIndex + 1} sur {totalSteps}
          </div>
        </div>
      )}

      <div className="onbStepper__track" aria-hidden="true">
        <span style={{ width: `${((currentIndex + 1) / totalSteps) * 100}%` }} />
      </div>

      <div className="onbStepper__items" aria-label="Étapes du parcours">
        {JOBRADAR_FLOW_STEPS.map((step, index) => {
          let status: StepStatus = "upcoming";
          if (completedSteps.includes(step.key) || index < currentIndex) status = "done";
          if (step.key === currentStep) status = "current";

          return (
            <div key={step.key} className={`onbStepper__item is-${status}`}>
              <div className="onbStepper__bullet">{status === "done" ? "✓" : index + 1}</div>
              <div className="onbStepper__label">{step.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
