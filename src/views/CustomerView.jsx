import { useApp } from '../context/AppContext.jsx';
import Builder from '../components/customer/Builder.jsx';
import Preview from '../components/customer/Preview.jsx';

const STEP_LABELS = ['Start', 'Style', 'Review', 'Done'];

export default function CustomerView() {
  const { step } = useApp();

  return (
    <div className="cj">
      <div className="cj-head">
        <div className="cj-greeting">
          <span className="cj-hello">Design Your Card</span>
          <span className="cj-sub">{STEP_LABELS[step - 1]} · Step {step} of 4</span>
        </div>
        <div className="cj-dots" aria-label={`Step ${step} of 4`}>
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={`cj-dot ${step === n ? 'active' : ''} ${step > n ? 'done' : ''}`}
            />
          ))}
        </div>
      </div>

      <Preview />
      <Builder />
    </div>
  );
}
