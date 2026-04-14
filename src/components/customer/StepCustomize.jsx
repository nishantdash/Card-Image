import { useApp } from '../../context/AppContext.jsx';

const STYLES = ['watercolor', 'cyberpunk', 'anime', 'minimal', 'oil-painting', 'vintage-poster', '3d-render'];
const MOODS  = ['vibrant', 'calm', 'dark', 'dreamy', 'futuristic'];
const PALETTES = [
  { value: 'warm',       gradient: 'linear-gradient(90deg,#ff7a59,#ffb86b)' },
  { value: 'cool',       gradient: 'linear-gradient(90deg,#5b8cff,#62e2ff)' },
  { value: 'monochrome', gradient: 'linear-gradient(90deg,#222,#888)' },
  { value: 'pastel',     gradient: 'linear-gradient(90deg,#ffd1dc,#c4e0f9)' },
  { value: 'neon',       gradient: 'linear-gradient(90deg,#ff00d4,#00f0ff)' },
];
const BACKGROUNDS = [
  { value: 'city-skyline', label: 'City skyline' },
  { value: 'mountains',    label: 'Mountains' },
  { value: 'abstract',     label: 'Abstract gradient' },
  { value: 'cosmic',       label: 'Cosmic space' },
];

function label(v) { return v.charAt(0).toUpperCase() + v.slice(1).replace('-', ' '); }

export default function StepCustomize() {
  const { selections, setSelections, freeText, setFreeText } = useApp();

  const pick = (group, value) => {
    setSelections((cur) => ({
      ...cur,
      [group]: cur[group] === value ? null : value,
    }));
  };

  const Chip = ({ group, value, children }) => (
    <button
      className={`chip ${selections[group] === value ? 'active' : ''} ${group === 'color' ? 'palette' : ''}`}
      onClick={() => pick(group, value)}
    >
      {children}
    </button>
  );

  return (
    <>
      <h2>Pick a look you love</h2>
      <p className="muted">Tap any option to preview it on your card. Pick one or mix a few.</p>

      <div className="picker-block">
        <label>Style</label>
        <div className="chip-row">
          {STYLES.map(s => <Chip key={s} group="style" value={s}>{label(s)}</Chip>)}
        </div>
      </div>

      <div className="picker-block">
        <label>Colour palette</label>
        <div className="chip-row">
          {PALETTES.map(p => (
            <Chip key={p.value} group="color" value={p.value}>
              <i style={{ background: p.gradient }}></i>{label(p.value)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="picker-block">
        <label>Mood</label>
        <div className="chip-row">
          {MOODS.map(m => <Chip key={m} group="mood" value={m}>{label(m)}</Chip>)}
        </div>
      </div>

      <div className="picker-block">
        <label>Background</label>
        <div className="chip-row">
          {BACKGROUNDS.map(b => <Chip key={b.value} group="background" value={b.value}>{b.label}</Chip>)}
        </div>
      </div>

      <div className="advanced">
        <details>
          <summary>Describe it in your own words (optional)</summary>
          <p className="muted small">Tell us anything extra you'd like. We'll check it's safe before using it.</p>
          <textarea
            rows={2}
            placeholder="e.g. a peaceful sunset over the mountains"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
          />
        </details>
      </div>
    </>
  );
}
