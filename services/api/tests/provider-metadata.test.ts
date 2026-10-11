import { describe, it, expect } from 'vitest';
import { openRouterModelMetadata } from '../src/models/provider-metadata.js';
describe('Provider-reported metadata', () => {
  it('converts OpenRouter per-token price to USD per million', () => {
    const parsed = openRouterModelMetadata({ pricing: { prompt: '0.0000002', completion: '0.0000005' }, architecture: { input_modalities: ['text', 'image'] } });
    expect(parsed.price_in_per_m).toBeCloseTo(0.2);
    expect(parsed.price_out_per_m).toBeCloseTo(0.5);
    expect(parsed.modalities).toEqual(['text', 'image']);
  });
  it('does not invent missing or malformed prices', () => {
    expect(openRouterModelMetadata({ pricing: { prompt: 'not-a-number', completion: '-5' } })).toMatchObject({ price_in_per_m: null, price_out_per_m: null });
    expect(openRouterModelMetadata({})).toMatchObject({ price_in_per_m: null, price_out_per_m: null, supports_streaming: undefined });
  });
  it('keeps actual zero prices for verified free models', () => {
    expect(openRouterModelMetadata({ pricing: { prompt: '0', completion: '0' } })).toMatchObject({ price_in_per_m: 0, price_out_per_m: 0 });
  });
});