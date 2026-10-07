import type { ProviderKind } from '@tj/schemas';
import { MODEL_HINTS } from './model-hints.js';

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url: string | null;
  requires_api_key: boolean;
  privacy_class: 'local' | 'cloud';
  supports_model_discovery: boolean;
  env_key: string | null;
  docs: string;
  notes?: string;
}

const C = (id: string, name: string, base_url: string, env_key: string, docs: string): ProviderPreset =>
  ({ id, name, kind: 'openai-compatible', base_url, requires_api_key: true, privacy_class: 'cloud', supports_model_discovery: true, env_key, docs });
const L = (id: string, name: string, base_url: string, docs: string, notes: string): ProviderPreset =>
  ({ id, name, kind: 'openai-compatible', base_url, requires_api_key: false, privacy_class: 'local', supports_model_discovery: true, env_key: null, docs, notes });

/** Well-known providers (Spec §5). Anything OpenAI-compatible uses the generic adapter. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', kind: 'openai', base_url: 'https://api.openai.com/v1', requires_api_key: true, privacy_class: 'cloud', supports_model_discovery: true, env_key: 'OPENAI_API_KEY', docs: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', base_url: 'https://api.anthropic.com', requires_api_key: true, privacy_class: 'cloud', supports_model_discovery: true, env_key: 'ANTHROPIC_API_KEY', docs: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', name: 'Google Gemini', kind: 'google', base_url: 'https://generativelanguage.googleapis.com/v1beta', requires_api_key: true, privacy_class: 'cloud', supports_model_discovery: true, env_key: 'GOOGLE_API_KEY', docs: 'https://aistudio.google.com/app/apikey' },
  C('xai', 'xAI (Grok)', 'https://api.x.ai/v1', 'XAI_API_KEY', 'https://console.x.ai'),
  C('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'DEEPSEEK_API_KEY', 'https://platform.deepseek.com/api_keys'),
  C('mistral', 'Mistral', 'https://api.mistral.ai/v1', 'MISTRAL_API_KEY', 'https://console.mistral.ai/api-keys'),
  C('groq', 'Groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', 'https://console.groq.com/keys'),
  C('together', 'Together AI', 'https://api.together.xyz/v1', 'TOGETHER_API_KEY', 'https://api.together.xyz/settings/api-keys'),
  C('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 'https://openrouter.ai/keys'),
  C('huggingface', 'Hugging Face Inference', 'https://router.huggingface.co/v1', 'HF_TOKEN', 'https://huggingface.co/settings/tokens'),
  { id: 'ollama', name: 'Ollama (local)', kind: 'ollama', base_url: 'http://127.0.0.1:11434', requires_api_key: false, privacy_class: 'local', supports_model_discovery: true, env_key: null, docs: 'https://ollama.com/download', notes: 'Install Ollama and run `ollama pull llama3.2` (or any model).' },
  L('lmstudio', 'LM Studio (local)', 'http://127.0.0.1:1234/v1', 'https://lmstudio.ai', 'Start the LM Studio local server (Developer tab).'),
  L('llamacpp', 'llama.cpp server (local)', 'http://127.0.0.1:8080/v1', 'https://github.com/ggml-org/llama.cpp', 'Run `llama-server -m model.gguf`.'),
  L('vllm', 'vLLM (local/self-hosted)', 'http://127.0.0.1:8000/v1', 'https://docs.vllm.ai', 'Start vLLM with the OpenAI-compatible server.'),
  { id: 'custom', name: 'Custom OpenAI-compatible endpoint', kind: 'openai-compatible', base_url: null, requires_api_key: false, privacy_class: 'cloud', supports_model_discovery: true, env_key: null, docs: '' },
];

export function presetById(id: string | null | undefined) {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function hintFor(modelId: string) {
  const base = modelId.toLowerCase();
  const keys = Object.keys(MODEL_HINTS).sort((a, b) => b.length - a.length);
  const k = keys.find((key) => base === key || base.startsWith(key + '-') || base.includes(key));
  return k ? MODEL_HINTS[k] : null;
}
