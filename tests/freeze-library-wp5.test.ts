import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../src/pipeline/synthesizer.js';
import { computeMdi, computeModelFamilyMDI } from '../src/utils.js';
import { createAttestation } from '../src/attestation.js';
import type { VerificationResult, Proposal } from '../src/types.js';

describe('extractKeywords (LTS port)', () => {
  it('does not collapse text into a single token', () => {
    const kw = extractKeywords('Risk management for high risk systems is mandatory today');
    expect(kw.length).toBeGreaterThan(1);
    expect(kw).toContain('management');
    expect(kw).toContain('systems');
  });
});

describe('strictModelDiversity policy helpers', () => {
  it('family MDI is low for homogeneous panel', () => {
    expect(computeModelFamilyMDI(['claude-sonnet-4', 'claude-opus-4', 'claude-haiku'])).toBe(0);
  });
  it('family MDI is high for 4 families', () => {
    expect(computeModelFamilyMDI(['claude-sonnet-4', 'grok-3', 'deepseek-chat', 'gemini-2.5-flash'])).toBe(0.75);
  });
});

describe('attestation WP5 parent_hash + falsifiability', () => {
  it('embeds optional chain fields without breaking hash shape', () => {
    const result = {
      verdict: 'ALLOW',
      confidence: 0.8,
      severity_score: null,
      mdi: 0.7,
      objections: [],
      domain: 'general',
      stakeLevel: 'medium',
      tier: 'standard',
      durationMs: 1,
      verified: true,
      flags: [],
      timestamp: new Date().toISOString(),
      parent_hash: 'sha256:abc',
      falsifiability: 'Show a counterexample with contradictory evidence',
      synthesis: 'ok',
      dissent: [],
    } as unknown as VerificationResult;

    const vc = createAttestation(result, {
      claim: 'test claim',
      parentHash: 'sha256:parent',
      falsifiability: ['counterexample X'],
    });

    expect(vc.subject.parent_hash).toBe('sha256:parent');
    expect(vc.subject.falsifiability).toEqual(['counterexample X']);
    expect(vc.proof.hash.startsWith('sha256:')).toBe(true);
  });
});

describe('content MDI after keyword fix', () => {
  const proposal = (model: string, content: string): Proposal => ({ model, content });
  it('identical texts → 0', () => {
    const t = 'Risk management for high risk AI systems is mandatory.';
    expect(computeMdi([proposal('a', t), proposal('b', t)])).toBe(0);
  });
});
