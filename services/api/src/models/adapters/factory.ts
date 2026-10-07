import type { ProviderKind } from '@tj/schemas';
import type { ProviderAdapter, ProviderCredentials } from '../types.js';
import { OpenAICompatibleAdapter } from './openai-compatible.js';
import { AnthropicAdapter } from './anthropic.js';
import { GoogleAdapter } from './google.js';
import { OllamaAdapter } from './ollama.js';
import { TestProviderAdapter } from './test-provider.js';

export function createAdapter(kind: ProviderKind, creds: ProviderCredentials, preset: string | null): ProviderAdapter {
  switch (kind) {
    case 'openai': return new OpenAICompatibleAdapter(creds, 'openai', preset);
    case 'openai-compatible': return new OpenAICompatibleAdapter(creds, 'openai-compatible', preset);
    case 'anthropic': return new AnthropicAdapter(creds);
    case 'google': return new GoogleAdapter(creds);
    case 'ollama': return new OllamaAdapter(creds);
    case 'test': return new TestProviderAdapter();
    default: throw new Error(`Unsupported provider kind ${kind}`);
  }
}
