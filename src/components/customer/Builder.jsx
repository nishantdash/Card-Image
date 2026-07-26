import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { runPreflight, finalizeLayers, initialLayerStatus } from '../../lib/pipeline.js';
import { validateCardholderName } from '../../../shared/guardrails/index.js';
import { useGeneration } from '../../lib/useGeneration.js';
import StepSource from './StepSource.jsx';
import StepCustomize from './StepCustomize.jsx';
import StepReview from './StepReview.jsx';
import StepResult from './StepResult.jsx';

// Where "Back" goes from each step.
//
// Step 3 is an automated processing screen, not a destination — going "back" from
// the result page returns to the style/prompt editor so the customer can change
// something and re-run. Landing on step 3 instead would immediately re-trigger a
// generation they did not ask for.
const BACK_TARGET = { 2: 1, 3: 2, 4: 2 };

export default function Builder() {
  const {
    step, setStep, source, uploaded, selections, freeText, cardholderName,
    cardOrientation, resetCustomer, setLayerStatus, setSignals, setDecision,
    setAiLoading, showToast,
  } = useApp();
  const { generate } = useGeneration();

  // A run is only started by an explicit customer action, never as a side effect
  // of `step` becoming 3. Previously the effect keyed on `step`, so any
  // navigation back onto the review screen silently regenerated.
  const [runId, setRunId] = useState(0);
  const [running, setRunning] = useState(false);
  const abortRef = useRef(null);

  const nameCheck = useMemo(() => validateCardholderName(cardholderName), [cardholderName]);

  const nextEnabled = (() => {
    if (step === 1) return !!source && (source === 'generate' || !!uploaded);
    if (step === 2) {
      const { style, mood, color, background } = selections;
      const hasDesign = !!(style || mood || color || background) || !!freeText.trim();
      // The name is part of what gets moderated, so it must be present and not
      // hard-blocked before a provider call is spent. A name that merely needs
      // human review may proceed.
      return hasDesign && !nameCheck.empty && nameCheck.severity !== 'block';
    }
    return true;
  })();

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setAiLoading(false);
    setLayerStatus(initialLayerStatus());
    setStep(2);
    showToast('warn', 'Generation cancelled — your design is unchanged.');
  }, [setAiLoading, setLayerStatus, setStep, showToast]);

  useEffect(() => {
    if (runId === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    let disposed = false;
    // Because this effect keys on `runId`, navigating away does NOT tear it down.
    // Every await is therefore followed by a stop check, otherwise a cancelled run
    // would still march on and push the customer to step 4.
    const shouldStop = () => disposed || controller.signal.aborted;

    (async () => {
      setRunning(true);
      setLayerStatus(initialLayerStatus());
      const onStatus = (id, status) => {
        if (!shouldStop()) setLayerStatus(cur => ({ ...cur, [id]: status }));
      };

      // 1. Client preflight — instant feedback, and a cheap stop for anything
      //    obviously blocked.
      const pre = await runPreflight({
        source, uploaded, freeText, cardholderName, selections,
        orientation: cardOrientation, onStatus, shouldStop,
      });
      if (shouldStop() || pre.stopped) return;

      // 2. Generation. The only place artwork is requested, and only after
      //    moderation has had its say.
      let server = null;
      if (!pre.blocked) {
        const result = await generate({ signal: controller.signal });
        if (shouldStop() || result?.cancelled) return;
        // The server's verdict supersedes the client's — it recomputed the
        // decision from the raw inputs and is the binding one.
        server = result?.verdict ?? null;
      }

      // 3. Fold the authoritative verdict into the remaining layers.
      const { signals, decision, stopped } = await finalizeLayers({
        server, clientVerdict: pre.verdict, signals: pre.signals, onStatus, shouldStop,
      });
      if (shouldStop() || stopped) return;

      setSignals(signals);
      setDecision(decision);
      setRunning(false);
      setTimeout(() => { if (!shouldStop()) setStep(4); }, 400);
    })();

    return () => { disposed = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const onNext = () => {
    if (step === 2) {
      // Explicit request for a fresh run.
      setRunId(n => n + 1);
      setStep(3);
      return;
    }
    if (step < 4) setStep(step + 1);
    else resetCustomer();
  };

  const onPrev = () => {
    if (step === 3) { cancelRun(); return; }
    const target = BACK_TARGET[step];
    if (target) setStep(target);
  };

  const nextLabel =
    step === 4 ? 'Design another ↻' :
    step === 2 ? 'Looks good →' :
    'Continue';

  const backLabel = step === 3 ? '✕ Cancel' : step === 4 ? '← Change design' : 'Back';

  // Explain a disabled Next rather than leaving it inert.
  const blockHint = step === 2 && !nextEnabled
    ? (nameCheck.empty
        ? 'Enter the name to print on your card to continue.'
        : nameCheck.severity === 'block'
          ? 'Please fix the name on the card to continue.'
          : 'Pick at least one style option to continue.')
    : null;

  return (
    <div className="builder">
      <div className="step-body">
        {step === 1 && <StepSource />}
        {step === 2 && <StepCustomize />}
        {step === 3 && <StepReview />}
        {step === 4 && <StepResult />}
      </div>

      <div className="builder-actions sticky">
        {/* Back is available on every step except the first, including during a
            run — where it doubles as Cancel. */}
        {step > 1 && (
          <button className="btn ghost" onClick={onPrev}>{backLabel}</button>
        )}
        {/* Step 3 drives itself; Cancel is the only control offered. */}
        {step !== 3 && (
          <button className="btn primary" onClick={onNext} disabled={!nextEnabled}>
            {nextLabel}
          </button>
        )}
        {blockHint && <p className="muted small center block-hint">{blockHint}</p>}
        {step === 3 && running && (
          <p className="muted small center block-hint">
            You can cancel and change your design — nothing is saved until you submit.
          </p>
        )}
      </div>
    </div>
  );
}
