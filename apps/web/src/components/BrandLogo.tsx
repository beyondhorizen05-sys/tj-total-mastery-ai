import React from 'react';
import {
  siAnthropic, siBrave, siDeepseek, siGithub, siGmail, siGoogle, siGooglecalendar,
  siGooglegemini, siHomeassistant, siHuggingface, siLmstudio, siMistralai,
  siOllama, siOpenrouter, siPerplexity, siShopify, siVllm,
} from 'simple-icons';
import type { SimpleIcon } from 'simple-icons';
import './brand-logo.css';

type Brand = { icon: SimpleIcon; color?: string };

const brands: Record<string, Brand> = {
  anthropic: { icon: siAnthropic },
  brave: { icon: siBrave },
  brave_search: { icon: siBrave },
  deepseek: { icon: siDeepseek },
  github: { icon: siGithub },
  gmail: { icon: siGmail },
  google: { icon: siGoogle },
  google_calendar: { icon: siGooglecalendar },
  googlecalendar: { icon: siGooglecalendar },
  gemini: { icon: siGooglegemini },
  home_assistant: { icon: siHomeassistant },
  homeassistant: { icon: siHomeassistant },
  huggingface: { icon: siHuggingface },
  lmstudio: { icon: siLmstudio },
  mistral: { icon: siMistralai },
  ollama: { icon: siOllama },
  openrouter: { icon: siOpenrouter },
  perplexity: { icon: siPerplexity },
  shopify: { icon: siShopify },
  vllm: { icon: siVllm },
};

const initials: Record<string, string> = { openai: 'OA', chatgpt: 'GPT', xai: 'xAI', groq: 'G', microsoft365: 'MS', alpaca: 'A' };

const brandColors: Record<string, string> = {
  openai: '#10a37f', xai: '#f4f4f5', groq: '#f55036', together: '#6d4aff',
  fireworks: '#ff5c35', cohere: '#39594d', cerebras: '#5b8cff', sambanova: '#f36b3b',
  novita: '#6e73ff', hyperbolic: '#9c7cff', deepinfra: '#ff6b57', jan: '#6e8eff',
  textgen: '#e0a95b', localai: '#52b788', llamacpp: '#91a8d0', custom: '#9aa7bd',
  tavily: '#6857ff', openweather: '#f7a928', microsoft365: '#f25022',
  alpaca: '#4d88ff', slack: '#36c5f0', generic_webhook: '#8b9bb4',
};

function compactName(name: string) {
  const words = name.replace(/\([^)]*\)/g, '').trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return 'AI';
  return words.length === 1 ? words[0].slice(0, 2).toUpperCase() : `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export const BrandLogo: React.FC<{ id?: string | null; name: string; className?: string; fallback?: string }> = ({ id, name, className = '', fallback }) => {
  const candidates = [id, name].filter((value): value is string => Boolean(value));
  const normalized = candidates.map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const brand = normalized.map((key) => brands[key] ?? brands[key.replaceAll('_', '')]).find(Boolean);
  const key = normalized.find((value) => brandColors[value] || brandColors[value.replaceAll('_', '')]) ?? normalized[0] ?? 'custom';
  const color = brand?.color ?? brandColors[key] ?? brandColors[key.replaceAll('_', '')] ?? '#70dce8';
  const mark = normalized.map((value) => initials[value] ?? initials[value.replaceAll('_', '')]).find(Boolean) ?? fallback ?? compactName(name);

  return <span className={`tj-brand-logo ${className}`} style={{ '--brand-color': color } as React.CSSProperties} role="img" aria-label={`${name} logo`}>
    {brand ? <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={brand.icon.path} /></svg> : <span aria-hidden="true">{mark}</span>}
  </span>;
};
