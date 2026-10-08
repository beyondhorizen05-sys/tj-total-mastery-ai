import React, { useEffect, useState } from 'react';
import { Eye, ImagePlus, AlertCircle } from 'lucide-react';
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
    <div style={{ maxWidth: 1050, margin: '0 auto', padding: 24, color: 'var(--text-main)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Eye size={26} color="var(--accent-cyan)" /><h1 style={{ margin: 0 }}>Image understanding</h1>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>Choose an image, ask a question, and select the model that will analyze it. TJ sends the image only when you press Analyze.</p>

      <form onSubmit={analyze} style={{ display: 'grid', gap: 16, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20 }}>
        <label style={{ display: 'grid', gap: 8, cursor: 'pointer' }}>
          <span style={{ fontWeight: 600 }}>Image</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: '1px dashed var(--border-strong)', borderRadius: 8, padding: 18, color: 'var(--text-muted)' }}><ImagePlus size={22} />{fileName || 'Select PNG, JPEG, or WebP (8 MB max)'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => chooseImage(e.target.files?.[0])} style={{ width: '100%' }} />
        </label>
        {imageDataUrl && <img src={imageDataUrl} alt="Selected image preview" style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain', background: 'var(--bg-card)', borderRadius: 8 }} />}

        <label style={{ display: 'grid', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Question</span>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={4000} rows={3} style={{ resize: 'vertical', padding: 12, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-main)', font: 'inherit' }} />
        </label>

        <label style={{ display: 'grid', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Vision model</span>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} style={{ padding: 12, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-main)' }}>
            <option value="">Select a model</option>
            {status?.models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.provider_id} · {model.privacy_class} · {model.cost_class}</option>)}
          </select>
        </label>
        {status && status.models.length === 0 && <p style={{ color: 'var(--text-muted)', margin: 0 }}>No configured vision model is available under {status.privacy_mode} privacy mode. Add a vision-capable provider in Models, or start a local vision model.</p>}
        {chosen && <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>{chosen.privacy_class === 'local' ? 'This image will be processed by your local model.' : `This image will be sent to ${chosen.provider_id} when you press Analyze.`} Your current privacy mode is {status?.privacy_mode}.</p>}

        <button type="submit" disabled={!imageDataUrl || !chosen || !question.trim() || loading} style={{ justifySelf: 'start', padding: '11px 20px', border: 0, borderRadius: 8, background: 'var(--accent-cyan)', color: '#000', fontWeight: 700, cursor: 'pointer', opacity: !imageDataUrl || !chosen || !question.trim() || loading ? 0.5 : 1 }}>{loading ? 'Analyzing…' : 'Analyze image'}</button>
      </form>

      {error && <p role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fb7185', background: 'rgba(244,63,94,.1)', padding: 14, borderRadius: 8 }}><AlertCircle size={18} />{error}</p>}
      {answer && <section style={{ marginTop: 18, padding: 20, borderRadius: 12, border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <h2 style={{ marginTop: 0 }}>TJ sees</h2>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{answer.answer}</div>
        <small style={{ display: 'block', marginTop: 14, color: 'var(--text-muted)' }}>Answered by {answer.model_id}{answer.cost_usd != null ? ` · estimated cost $${answer.cost_usd.toFixed(4)}` : ''}</small>
      </section>}
    </div>
  );
};
