import { describe, it, expect } from 'vitest';
import {
  computeModelFamilyMDI,
  resolveModelFamily,
  extractModelFamilies,
  extractMinorityPositions,
} from '../src/utils.js';
import type { Proposal } from '../src/types.js';

describe('Patent Alignment — Model Diversity Index (Claim 4)', () => {
  it('returns 0 for single model family', () => {
    const mdi = computeModelFamilyMDI(['claude-sonnet-4', 'claude-opus-4', 'claude-haiku']);
    expect(mdi).toBe(0);
  });

  it('returns 0.67 for 3 different families', () => {
    const mdi = computeModelFamilyMDI(['claude-sonnet-4', 'grok-3', 'deepseek-chat']);
    expect(mdi).toBeCloseTo(0.667, 1);
  });

  it('returns 0.75 for 4 different families', () => {
    const mdi = computeModelFamilyMDI(['claude-sonnet-4', 'grok-3', 'deepseek-chat', 'gemini-2.5-flash']);
    expect(mdi).toBe(0.75);
  });

  it('returns 0.72 for 5 models from 4 families (2,1,1,1)', () => {
    const mdi = computeModelFamilyMDI([
      'claude-sonnet-4', 'claude-opus-4',
      'grok-3', 'deepseek-chat', 'gemini-2.5-flash',
    ]);
    expect(mdi).toBe(0.72);
  });

  it('returns 0 for empty input', () => {
    expect(computeModelFamilyMDI([])).toBe(0);
  });
});

describe('Patent Alignment — Model Family Resolution', () => {
  it('resolves Anthropic models', () => {
    expect(resolveModelFamily('claude-sonnet-4-6')).toBe('anthropic');
    expect(resolveModelFamily('claude-opus-4')).toBe('anthropic');
  });

  it('resolves xAI models', () => {
    expect(resolveModelFamily('grok-4-1-fast-non-reasoning')).toBe('xai');
  });

  it('resolves Google models', () => {
    expect(resolveModelFamily('gemini-3.1-flash-lite-preview')).toBe('google');
  });

  it('resolves DeepSeek models', () => {
    expect(resolveModelFamily('deepseek-chat')).toBe('deepseek');
  });

  it('resolves Moonshot models', () => {
    expect(resolveModelFamily('kimi-k2.6')).toBe('moonshot');
  });

  it('returns unknown for unrecognized models', () => {
    expect(resolveModelFamily('totally-new-model')).toBe('unknown');
  });
});

describe('Patent Alignment — Model Families Extraction', () => {
  it('extracts unique families from pipeline', () => {
    const families = extractModelFamilies(
      ['grok-4-1-fast-non-reasoning', 'deepseek-chat', 'gemini-3.1-flash-lite-preview'],
      'claude-sonnet-4-6',
      'claude-sonnet-4-6',
    );
    expect(families).toEqual(['anthropic', 'deepseek', 'google', 'xai']);
  });

  it('deduplicates when same family appears in multiple roles', () => {
    const families = extractModelFamilies(
      ['claude-sonnet-4', 'grok-3'],
      'claude-opus-4',
      'deepseek-chat',
    );
    expect(families).toEqual(['anthropic', 'deepseek', 'xai']);
  });
});

describe('Patent Alignment — Minority Position Extraction (Claim 1e)', () => {
  it('detects minority BLOCK when verdict is ALLOW', () => {
    const proposals: Proposal[] = [
      { model: 'grok-3', content: 'This reasoning is sound and valid. I recommend we allow this to proceed. The evidence supports the claim.' },
      { model: 'deepseek-chat', content: 'The reasoning is correct and verified. Safe to approve.' },
      { model: 'gemini-2.5-flash', content: 'This is dangerous and risky. I would block this. There is a critical error in the logic. The flaw is fundamental and the claim is incorrect.' },
    ];
    const minorities = extractMinorityPositions(proposals, 'ALLOW', '');
    expect(minorities.length).toBe(1);
    expect(minorities[0].model).toBe('gemini-2.5-flash');
    expect(minorities[0].family).toBe('google');
    expect(minorities[0].position).toBe('BLOCK');
  });

  it('returns empty when all agree', () => {
    const proposals: Proposal[] = [
      { model: 'grok-3', content: 'Safe, valid, recommend approval. Sound reasoning throughout.' },
      { model: 'deepseek-chat', content: 'Verified and correct. Recommend approval of this claim.' },
    ];
    const minorities = extractMinorityPositions(proposals, 'ALLOW', '');
    expect(minorities.length).toBe(0);
  });

  it('captures reason from dissenting model', () => {
    const proposals: Proposal[] = [
      { model: 'claude-sonnet-4', content: 'This should be blocked. The reasoning contains a fatal error that undermines the entire argument. Block immediately due to danger.' },
    ];
    const minorities = extractMinorityPositions(proposals, 'ALLOW', '');
    expect(minorities.length).toBe(1);
    expect(minorities[0].reason.length).toBeGreaterThan(0);
    expect(minorities[0].reason.length).toBeLessThanOrEqual(300);
  });
});
