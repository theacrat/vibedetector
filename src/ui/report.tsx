import { Funnel, Hourglass, Zap } from "lucide-react";
import { useCallback } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

import { categories } from "@/domain";
import type { Category, ProviderId } from "@/domain";

import { useReportState, useReportWindow, useReportMutation } from "./report-session";
import type { ReportState } from "./report-session";

import "./report-dialog.css";

const icons = { broken: Zap, nerfed: Funnel, slow: Hourglass };
function ReportButtons({
  state,
  reportActions,
}: {
  state: ReportState;
  reportActions: (category: Category) => () => void;
}) {
  const { session, pending } = state;
  return (
    <fieldset className={`btns${session?.category ? " done" : ""}`} aria-label="Report an issue">
      {categories.map((category) => {
        const Icon = icons[category];
        return (
          <Button
            key={category}
            className={`vibe-btn ${category}`}
            aria-pressed={session?.category === category}
            isDisabled={pending || !session}
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

// React Aria's modal elements need their own styling hooks, not wrapper divs.
/* oxlint-disable react/forbid-component-props */
// oxlint-disable-next-line eslint/max-lines-per-function
function ReportDialog({
  state,
  retry,
  cancel,
}: {
  state: ReportState;
  retry: () => void;
  cancel: () => void;
}) {
  const { pending, phase, intent, setContainer, reportError } = state;
  const openChange = useCallback(
    (open: boolean) => {
      if (!open) {
        cancel();
      }
    },
    [cancel],
  );
  return (
    <ModalOverlay
      className="report-dialog-overlay"
      isOpen={pending}
      isKeyboardDismissDisabled={phase === "submitting"}
      onOpenChange={openChange}
    >
      <Modal className="report-dialog-modal">
        <Dialog className="report-dialog">
          <Heading slot="title">Verifying your report</Heading>
          <p>
            {intent?.category === null
              ? "Verifying before removing your report."
              : "A quick check before recording your report."}
          </p>
          {phase !== "error" && (
            <output className="report-dialog-status">
              <span className="report-dialog-spinner" aria-hidden="true" />
              {phase === "submitting"
                ? "Saving your report..."
                : "Verifying. Follow the check below if requested."}
            </output>
          )}
          <div className="report-dialog-challenge" ref={setContainer} />
          {phase === "error" && (
            <p className="error" role="alert">
              {reportError}
            </p>
          )}
          <div className="report-dialog-actions">
            {phase === "error" && (
              <Button className="plain-button" onPress={retry}>
                Retry verification
              </Button>
            )}
            <Button className="plain-button" isDisabled={phase === "submitting"} onPress={cancel}>
              Cancel
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
/* oxlint-enable react/forbid-component-props */

function Report({ id }: { id: ProviderId }) {
  const state = useReportState();
  useReportWindow(id, state);
  const { stage, retry, cancel } = useReportMutation(id, state);
  const { session, pending, phase, feedback, reportError, intent } = state;
  const pendingMessage =
    phase === "submitting" ? "Saving your report..." : "Verifying your report...";
  const reportActions = useCallback(
    (category: Category) => () => {
      stage(category);
    },
    [stage],
  );

  return (
    <section className="report" aria-labelledby="feels">
      <h2 id="feels">My AI feels...</h2>
      <ReportButtons state={state} reportActions={reportActions} />
      <output className="hint">
        {pending
          ? pendingMessage
          : feedback ||
            (session?.category
              ? "Your report is selected. Tap again to undo."
              : "Choose how your AI feels.")}
      </output>
      {reportError && !intent && (
        <div className="error" role="alert">
          <p>{reportError}</p>
        </div>
      )}
      <ReportDialog state={state} retry={retry} cancel={cancel} />
    </section>
  );
}

export { Report };
