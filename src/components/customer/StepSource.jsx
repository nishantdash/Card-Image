import { useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';

export default function StepSource() {
  const { source, setSource, uploaded, setUploaded, uploadMeta, setUploadMeta, setStep } = useApp();
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = (src) => {
    setSource(src);
    if (src === 'generate') setStep(2);
  };

  const handleFile = (file) => {
    if (!/image\/(jpeg|png)/.test(file.type)) {
      setUploadMeta({ tone: 'red', html: '<strong style="color:var(--red)">That file won\'t work.</strong> Please use a JPG or PNG photo.' });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadMeta({ tone: 'red', html: '<strong style="color:var(--red)">File too big.</strong> Please pick a photo under 15&nbsp;MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploaded({ name: file.name, size: file.size, dataURL: e.target.result });
      setUploadMeta({
        tone: 'green',
        html: `<strong style="color:var(--green)">✓ Looks good.</strong> ${file.name} · ${(file.size/1024).toFixed(0)} KB`,
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <h2>How would you like to start?</h2>
      <p className="muted">Pick one — you can always change your mind later.</p>

      <div className="source-grid">
        <button className={`source-card ${source === 'upload' ? 'active' : ''}`} onClick={() => pick('upload')}>
          <div className="source-icon">📷</div>
          <h3>Use my photo</h3>
          <p>A selfie, your pet, or a favourite memory</p>
        </button>
        <button className={`source-card ${source === 'generate' ? 'active' : ''}`} onClick={() => pick('generate')}>
          <div className="source-icon">✦</div>
          <h3>Design with AI</h3>
          <p>Pick a style and we'll create it for you</p>
        </button>
      </div>

      <div className={`upload-zone ${source === 'upload' ? '' : 'hidden'}`}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }}
        />
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          <div className="dz-icon">📷</div>
          <strong>Tap to choose a photo</strong>
          <span className="muted">JPG or PNG · up to 15 MB</span>
        </div>
        {uploadMeta && (
          <div className="upload-meta" dangerouslySetInnerHTML={{ __html: uploadMeta.html }} />
        )}
      </div>
    </>
  );
}
