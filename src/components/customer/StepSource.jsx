import { useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import ImageCropper from './ImageCropper.jsx';

export default function StepSource() {
  const {
    source, setSource, uploaded, setUploaded, uploadMeta, setUploadMeta, setStep,
    cardOrientation,
  } = useApp();
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  // Raw file awaiting a crop. Nothing reaches `uploaded` until the customer has
  // framed it, so the rest of the journey only ever sees a card-shaped photo.
  const [pendingCrop, setPendingCrop] = useState(null);

  const pick = (src) => {
    setSource(src);
    if (src === 'generate') setStep(2);
  };

  // Upload feedback is structured data, not an HTML string. The previous version
  // interpolated file.name into markup that was rendered with
  // dangerouslySetInnerHTML, so a file named `<img src=x onerror=...>.png`
  // executed script.
  const handleFile = (file) => {
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      setUploadMeta({ tone: 'red', title: "That file won't work.", detail: 'Please use a JPG or PNG photo.' });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadMeta({ tone: 'red', title: 'File too big.', detail: 'Please pick a photo under 15 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setUploadMeta({ tone: 'red', title: "That file couldn't be read.", detail: 'Please try another photo.' });
    };
    reader.onload = (e) => {
      // Hand off to the cropper rather than accepting the photo as-is.
      setPendingCrop({ name: file.name, size: file.size, dataURL: e.target.result });
      setUploadMeta(null);
    };
    reader.readAsDataURL(file);
  };

  const onCropApplied = (croppedDataURL) => {
    setUploaded({
      name: pendingCrop.name,
      size: pendingCrop.size,
      dataURL: croppedDataURL,
      // Kept so the customer can re-crop without re-picking the file.
      originalDataURL: pendingCrop.dataURL,
      cropped: true,
    });
    setUploadMeta({
      tone: 'green',
      title: '✓ Photo ready.',
      detail: `${pendingCrop.name} · cropped to card shape`,
    });
    setPendingCrop(null);
  };

  const recrop = () => {
    if (!uploaded) return;
    setPendingCrop({
      name: uploaded.name,
      size: uploaded.size,
      dataURL: uploaded.originalDataURL || uploaded.dataURL,
    });
  };

  // The cropper takes over the step: one decision at a time on a phone screen.
  if (pendingCrop) {
    return (
      <ImageCropper
        src={pendingCrop.dataURL}
        orientation={cardOrientation}
        onApply={onCropApplied}
        onCancel={() => {
          setPendingCrop(null);
          fileInputRef.current?.click();
        }}
      />
    );
  }

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
          <div className="upload-meta">
            <strong className={uploadMeta.tone === 'red' ? 'meta-bad' : 'meta-ok'}>
              {uploadMeta.title}
            </strong>{' '}
            {uploadMeta.detail}
            {uploaded?.cropped && (
              <button className="btn ghost small upload-recrop" onClick={recrop}>
                ⤢ Adjust crop
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
