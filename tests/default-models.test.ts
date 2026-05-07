import { describe, expect, it } from 'vitest';

import { DEFAULT_GEN_NAMES, DEFAULT_MODELS } from '../src/verify.js';
import { resolveDefaultModel } from '../src/providers/index.js';

describe('default model configuration', () => {
  it('uses Gemini Flash as the default fourth generator instead of Moonshot/Kimi', () => {
    expect(DEFAULT_GEN_NAMES).toEqual(['anthropic', 'xai', 'deepseek', 'gemini']);
    expect(DEFAULT_MODELS.gemini).toBe('gemini-3.1-flash-lite-preview');
    expect(DEFAULT_GEN_NAMES).not.toContain('moonshot');
  });

  it('keeps explicit Moonshot usage on the non-deprecated Kimi 2.6 model', () => {
    expect(DEFAULT_MODELS.moonshot).toBe('kimi-k2.6');
    expect(resolveDefaultModel('moonshot')).toBe('kimi-k2.6');
  });
});
