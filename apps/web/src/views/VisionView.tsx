import React, { useEffect, useState } from 'react';
import { Eye, ImagePlus, AlertCircle, Microscope, ScanSearch } from 'lucide-react';
import { apiFetch } from '../api';

type VisionModel = { id: string; name: string; provider_id: string; privacy_class: string; cost_class: string };
type VisionStatus = { privacy_mode: string; models: VisionModel[] };
type VisionAnswer = { answer: string; model_id: string; provider_id: string; cost_usd: number | null };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const VisionView: React.FC = () => {
  const [status, setStatus] = useState<VisionStatus | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [modelId, setModelId] = useState('');
  const [question, setQuestion] = useState('Describe this image and read any visible text.');
  const [answer, setAnswer] = useState<VisionAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<VisionStatus>('/api/v1/vision/status').then(setStatus).catch((e: Error) => setError(e.message));
  }, []);

  const chosen = status?.models.find((model) => model.id === modelId);

  const chooseImage = (file?: File) => {
    setAnswer(null);
    setImageDataUrl(null);
    setFileName('');
    setError(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_IMAGE_BYTES) {
      setError('Choose a PNG, JPEG, or WebP image up to 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('The image could not be read.');
    reader.onload = () => {
      if (typeof reader.result !== 'string') { setError('The image could not be read.'); return; }
      setImageDataUrl(reader.result);
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const analyze = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!imageDataUrl || !modelId || !question.trim() || loading) return;
    setLoading(true);
    setAnswer(null);
    setError(null);
    try {
      const result = await apiFetch<VisionAnswer>('/api/v1/vision/analyze', {
        method: 'POST',
        body: JSON.stringify({ image_data_url: imageDataUrl, model_id: modelId, question: question.trim() }),
      });
      setAnswer(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="tj-research-room">
      <div className="tj-research-shell">
        <header className="tj-research-hero">
          <div className="tj-research-architecture" aria-hidden="true">
            <div className="tj-research-ceiling"><i/><i/></div>
            <div className="tj-research-wall tj-research-wall-left"><i/><i/><i/></div>
            <div className="tj-research-wall tj-research-wall-center"><i/><i/><i/></div>
            <div className="tj-research-wall tj-research-wall-right"><i/><i/><i/></div>
            <div className="tj-research-bench tj-research-bench-left" />
            <div className="tj-research-bench tj-research-bench-right" />
            <div className="tj-research-floor-display" />
          </div>
          <div className="tj-research-hero-copy">
            <span className="tj-room-eyebrow"><Microscope size={14} aria-hidden="true" /> TJ RESEARCH LAB / VISION</span>
            <h1>Image understanding</h1>
            <p>Bring an image into the lab. Choose a vision model and ask what you want TJ to examine.</p>
          </div>
        </header>

        <div className="tj-research-workspace">
          <form onSubmit={analyze} className="tj-research-panel" aria-label="Image analysis">
            <div className="tj-research-panel-heading"><Eye size={20} aria-hidden="true" /><div><span className="tj-room-eyebrow">WORKSTATION 01</span><h2>Analysis setup</h2></div></div>
            <label className="tj-research-field">
              <span>Image</span>
              <span className="tj-research-upload"><ImagePlus size={22} aria-hidden="true" />{fileName || 'Select PNG, JPEG, or WebP (8 MB max)'}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => chooseImage(e.target.files?.[0])} />
            </label>
            <label className="tj-research-field">
              <span>Question</span>
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={4000} rows={4} />
            </label>
            <label className="tj-research-field">
              <span>Vision model</span>
              <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                <option value="">Select a model</option>
                {status?.models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.provider_id} · {model.privacy_class} · {model.cost_class}</option>)}
              </select>
            </label>
            {status && status.models.length === 0 && <p className="tj-research-note">No configured vision model is available under {status.privacy_mode} privacy mode. Add a vision-capable provider in Models, or start a local vision model.</p>}
            {chosen && <p className="tj-research-note">{chosen.privacy_class === 'local' ? 'This image will be processed by your local model.' : `This image will be sent to ${chosen.provider_id} when you press Analyze.`} Your current privacy mode is {status?.privacy_mode}.</p>}
            <button className="tj-research-analyze" type="submit" disabled={!imageDataUrl || !chosen || !question.trim() || loading}><ScanSearch size={18} aria-hidden="true" />{loading ? 'Analyzing…' : 'Analyze image'}</button>
          </form>

          <div className="tj-research-results" aria-live="polite">
            <section className="tj-research-preview" aria-label="Selected image preview">
              <span className="tj-room-eyebrow">IMAGE BAY</span>
              {imageDataUrl ? <img src={imageDataUrl} alt={`Preview of ${fileName}`} /> : <div className="tj-research-preview-empty"><ImagePlus size={34} aria-hidden="true" /><p>Selected image appears here</p></div>}
              {fileName && <small>{fileName}</small>}
            </section>
            {error && <p role="alert" className="tj-room-error"><AlertCircle size={18} aria-hidden="true" />{error}</p>}
            {answer && <section className="tj-research-answer" aria-labelledby="vision-answer-title">
              <span className="tj-room-eyebrow">ANALYSIS RESULT</span>
              <h2 id="vision-answer-title">TJ sees</h2>
              <div>{answer.answer}</div>
              <small>Answered by {answer.model_id}{answer.cost_usd != null ? ` · estimated cost $${answer.cost_usd.toFixed(4)}` : ''}</small>
            </section>}
          </div>
        </div>
      </div>
    </main>
  );
};
