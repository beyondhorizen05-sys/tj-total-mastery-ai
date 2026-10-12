import { describe, expect, it } from 'vitest';
import { CognitiveEngine } from '../src/cognitive/engine.js';
import type { ModelRouter } from '../src/models/router.js';

describe('cognitive intent fallback', () => {
  const engine = new CognitiveEngine({} as ModelRouter);

  it('recognizes short imperative work requests when model classification is unavailable', () => {
    for (const text of ['Update my Shopify product', 'Run the project tests', 'Connect my calendar']) {
      expect(engine.heuristicIntent(text).intent, text).toBe('goal');
    }
  });

  it('recognizes polite delegated work while keeping how-to questions in chat', () => {
    expect(engine.heuristicIntent('Could you update my Shopify product?').intent).toBe('goal');
    expect(engine.heuristicIntent('Can you explain how to build a Shopify product page?').intent).toBe('chat');
  });

  it('keeps ordinary short conversation in chat intent', () => {
    expect(engine.heuristicIntent('Hi TJ, how are you?').intent).toBe('chat');
  });
});
