import { describe, expect, it } from 'vitest';

import { DEFAULT_GEN_NAMES, DEFAULT_MODELS } from '../src/verify.js';
import { resolveDefaultModel } from '../src/providers/index.js';

describe('default model configuration', () => {
  it('uses SERV Ultra as third generator instead of DeepSeek', () => {
    expect(DEFAULT_GEN_NAMES).toEqual(['anthropic', 'xai', 'serv-ultra', 'gemini']);
    expect(DEFAULT_MODELS['serv-ultra']).toBe('serv-ultra');
    expect(DEFAULT_GEN_NAMES).not.toContain('deepseek');
    expect(DEFAULT_GEN_NAMES).not.toContain('moonshot');
  });

  it('keeps explicit DeepSeek and Moonshot as opt-in models', () => {
    expect(DEFAULT_MODELS.deepseek).toBe('deepseek-chat');
    expect(DEFAULT_MODELS.moonshot).toBe('kimi-k2.6');
    expect(resolveDefaultModel('moonshot')).toBe('kimi-k2.6');
    expect(resolveDefaultModel('deepseek')).toBe('deepseek-chat');
  });

  it('resolves all SERV model aliases', () => {
    expect(resolveDefaultModel('serv')).toBe('serv-ultra');
    expect(resolveDefaultModel('serv-nano')).toBe('serv-nano');
    expect(resolveDefaultModel('serv-mini')).toBe('serv-mini');
    expect(resolveDefaultModel('serv-standard')).toBe('serv-standard');
    expect(resolveDefaultModel('serv-pro')).toBe('serv-pro');
    expect(resolveDefaultModel('serv-ultra')).toBe('serv-ultra');
  });

  it('retains Gemini Flash as fourth generator', () => {
    expect(DEFAULT_MODELS.gemini).toBe('gemini-3.1-flash-lite');
    expect(resolveDefaultModel('gemini')).toBe('gemini-3.1-flash-lite');
  });
});
