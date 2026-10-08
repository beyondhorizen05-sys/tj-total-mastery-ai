/**
 * Known public pricing ($ per 1M tokens) and capability hints for popular models.
 * Used only for cost ESTIMATES; unknown models get null (never fabricated).
 * Last reviewed: 2025. Update as vendors change pricing.
 */
export interface ModelHint { in: number; out: number; ctx?: number; quality?: 'frontier' | 'strong' | 'standard' | 'light'; vision?: boolean; tools?: boolean }

export const MODEL_HINTS: Record<string, ModelHint> = {
  'gpt-4o': { in: 2.5, out: 10, ctx: 128000, quality: 'frontier', vision: true, tools: true },
  'gpt-4o-mini': { in: 0.15, out: 0.6, ctx: 128000, quality: 'standard', vision: true, tools: true },
  'gpt-4.1': { in: 2, out: 8, ctx: 1047576, quality: 'frontier', vision: true, tools: true },
  'gpt-4.1-mini': { in: 0.4, out: 1.6, ctx: 1047576, quality: 'strong', vision: true, tools: true },
  'gpt-4.1-nano': { in: 0.1, out: 0.4, ctx: 1047576, quality: 'light', vision: true, tools: true },
  'gpt-5': { in: 1.25, out: 10, ctx: 400000, quality: 'frontier', vision: true, tools: true },
  'gpt-5-mini': { in: 0.25, out: 2, ctx: 400000, quality: 'strong', vision: true, tools: true },
  'gpt-5-nano': { in: 0.05, out: 0.4, ctx: 400000, quality: 'light', vision: true, tools: true },
  'o3': { in: 2, out: 8, ctx: 200000, quality: 'frontier', vision: true, tools: true },
  'o4-mini': { in: 1.1, out: 4.4, ctx: 200000, quality: 'strong', vision: true, tools: true },
  'claude-opus-4': { in: 15, out: 75, ctx: 200000, quality: 'frontier', vision: true, tools: true },
  'claude-sonnet-4': { in: 3, out: 15, ctx: 200000, quality: 'frontier', vision: true, tools: true },
  'claude-3-7-sonnet': { in: 3, out: 15, ctx: 200000, quality: 'strong', vision: true, tools: true },
  'claude-3-5-haiku': { in: 0.8, out: 4, ctx: 200000, quality: 'standard', vision: true, tools: true },
  'claude-haiku-4': { in: 1, out: 5, ctx: 200000, quality: 'standard', vision: true, tools: true },
  'gemini-2.5-pro': { in: 1.25, out: 10, ctx: 1048576, quality: 'frontier', vision: true, tools: true },
  'gemini-2.5-flash': { in: 0.3, out: 2.5, ctx: 1048576, quality: 'strong', vision: true, tools: true },
  'gemini-2.5-flash-lite': { in: 0.1, out: 0.4, ctx: 1048576, quality: 'standard', vision: true, tools: true },
  'gemini-2.0-flash': { in: 0.1, out: 0.4, ctx: 1048576, quality: 'standard', vision: true, tools: true },
  'deepseek-chat': { in: 0.27, out: 1.1, ctx: 64000, quality: 'strong', tools: true },
  'deepseek-reasoner': { in: 0.55, out: 2.19, ctx: 64000, quality: 'frontier' },
  'grok-4': { in: 3, out: 15, ctx: 256000, quality: 'frontier', vision: true, tools: true },
  'grok-3': { in: 3, out: 15, ctx: 131072, quality: 'frontier', tools: true },
  'grok-3-mini': { in: 0.3, out: 0.5, ctx: 131072, quality: 'strong', tools: true },
  'mistral-large': { in: 2, out: 6, ctx: 128000, quality: 'strong', tools: true },
  'mistral-medium': { in: 0.4, out: 2, ctx: 128000, quality: 'strong', tools: true },
  'mistral-small': { in: 0.1, out: 0.3, ctx: 128000, quality: 'standard', tools: true },
  'codestral': { in: 0.3, out: 0.9, ctx: 256000, quality: 'strong', tools: true },
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79, ctx: 128000, quality: 'strong', tools: true },
  'llama-3.1-8b-instant': { in: 0.05, out: 0.08, ctx: 128000, quality: 'light', tools: true },
  'qwen/qwen3-32b': { in: 0.29, out: 0.59, ctx: 131072, quality: 'strong', tools: true },
  'qwen-2.5-72b': { in: 0.35, out: 0.4, ctx: 131072, quality: 'strong', tools: true },
  'command-r-plus': { in: 2.5, out: 10, ctx: 128000, quality: 'strong', tools: true },
  'command-r': { in: 0.15, out: 0.6, ctx: 128000, quality: 'standard', tools: true },
  'sonar-pro': { in: 3, out: 15, ctx: 200000, quality: 'frontier' },
  'sonar': { in: 1, out: 1, ctx: 128000, quality: 'standard' },
};
