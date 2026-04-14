import { useEffect } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { runPipeline } from '../../lib/pipeline.js';
import { buildPreviewPrompt } from '../../lib/providers.js';
import { useGeneration } from '../../lib/useGeneration.js';
import StepSource from './StepSource.jsx';
import StepCustomize from './StepCustomize.jsx';
import StepReview from './StepReview.jsx';
import StepResult from './StepResult.jsx';

export default function Builder() {
  const {
    step, setStep, source, uploaded, selections, freeText,
    resetCustomer, setLayerStatus, setSignals, setDecision,
  } = useApp();
  const { generate } = useGeneration();

  const nextEnabled = (() => {
    if (step === 1) return !!source && (source === 'generate' || !!uploaded);
    if (step === 2) {
      const { style, mood, color, background } = selections;
      return !!(style || mood || color || background) || !!freeText.trim();
    }
    return true;
  })();

  useEffect(() => {
    if (step !== 3) return;
    let cancelled = false;
    (async () => {
      setLayerStatus({
        L0: 'pending', L1: 'pending', L2: 'pending',
        L3: 'pending', L4: 'pending', L5: 'pending', L6: 'pending',
      });
      const previewPrompt = buildPreviewPrompt(selections, freeText);
      const imagePromise = generate();
      const { signals: sig, decision: dec } = await runPipeline({
        source, uploaded, freeText, previewPrompt,
        onStatus: (id, status) => {
          if (cancelled) return;
          setLayerStatus((cur) => ({ ...cur, [id]: status }));
        },
      });
      if (cancelled) return;
      setSignals(sig);
      setDecision(dec);
      await imagePromise;
      if (cancelled) return;
      setTimeout(() => { if (!cancelled) setStep(4); }, 400);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const onNext = () => {
    if (step < 4) setStep(step + 1);
    else resetCustomer();
  };
  const onPrev = () => { if (step > 1) setStep(step - 1); };

  const nextLabel =
    step === 4 ? 'Design another ↻' :
    step === 3 ? 'See the result →' :
    step === 1 ? 'Continue' :
    'Looks good →';

  // Step 3 is automated; hide manual controls while the review runs.
  const hideActions = step === 3;

  return (
    <div className="builder">
      <div className="step-body">
        {step === 1 && <StepSource />}
        {step === 2 && <StepCustomize />}
        {step === 3 && <StepReview />}
        {step === 4 && <StepResult />}
      </div>

      {!hideActions && (
        <div className="builder-actions sticky">
          {step > 1 && (
            <button className="btn ghost" onClick={onPrev}>Back</button>
          )}
          <button className="btn primary" onClick={onNext} disabled={!nextEnabled}>
            {nextLabel}
          </button>
        </div>
      )}
    </div>
  );
}
