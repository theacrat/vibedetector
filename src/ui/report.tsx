import { Funnel, Hourglass, Zap } from "lucide-react";
import { useCallback } from "react";
import { Button } from "react-aria-components";

import { categories } from "@/domain";
import type { Category, ProviderId } from "@/domain";

import {
  useReportState,
  useReportWindow,
  useReportVerification,
  useReportMutation,
} from "./report-session";
import type { ReportState } from "./report-session";

const icons = { broken: Zap, nerfed: Funnel, slow: Hourglass };
function ReportButtons({
  state,
  reportActions,
}: {
  state: ReportState;
  reportActions: (category: Category) => () => void;
}) {
  const { session, pending, token } = state;
  return (
    <fieldset className={`btns${session?.category ? " done" : ""}`} aria-label="Report an issue">
      {categories.map((category) => {
        const Icon = icons[category];
        return (
          <Button
            key={category}
            className={`vibe-btn ${category}`}
            aria-pressed={session?.category === category}
            isDisabled={pending || !session || !token}
            onPress={reportActions(category)}
          >
            <Icon aria-hidden="true" />
            <span>{category}</span>
          </Button>
        );
      })}
    </fieldset>
  );
}

function Report({ id }: { id: ProviderId }) {
  const state = useReportState();
  useReportWindow(id, state);
  useReportVerification(id, state);
  const report = useReportMutation(id, state);
  const { session, pending, feedback, container, reportError, setToken, setAttempt } = state;
  const reportActions = useCallback(
    (category: Category) => () => {
      void report(category);
    },
    [report],
  );
  const retryVerification = useCallback(() => {
    setToken("");
    setAttempt((value) => value + 1);
  }, [setToken, setAttempt]);

  return (
    <section className="report" aria-labelledby="feels">
      <h2 id="feels">My AI feels...</h2>
      <ReportButtons state={state} reportActions={reportActions} />
      <output className="hint">
        {pending
          ? "Saving your report..."
          : feedback ||
            (session?.category
              ? "Your report is selected. Tap again to undo."
              : "One report per AI per hour. Switch or undo anytime.")}
      </output>
      <div className="verification" ref={container} />
      {reportError && (
        <div className="error" role="alert">
          <p>{reportError}</p>
          <Button className="plain-button" isDisabled={pending} onPress={retryVerification}>
            Retry verification
          </Button>
        </div>
      )}
    </section>
  );
}

export { Report };
