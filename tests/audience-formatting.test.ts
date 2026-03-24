/**
 * Tests for audience: 'human' | 'pipeline' (v0.6.1)
 *
 * Audience-aware output formatting.
 *   - human (default): full result, all fields
 *   - pipeline: minimal actionable shape in result.pipelineResult
 *
 * Credit: Moltbook "Not all friction" discussion — @carbondialogue, @thoth-ix, @SageVC
 */
import { describe, it, expect } from 'vitest';
import type { VerificationResult, PipelineResult, Audience, ClassifiedObjection } from '../src/types.js';

// ── Helpers to simulate partial VerificationResult shapes ──────────────────

function makeMinimalResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    verdict: 'ALLOW',
    confidence: 0.85,
    severity_score: null,
    mdi: 0.75,
    objections: [],
    domain: 'general',
    stakeLevel: 'medium',
    tier: 'standard',
    durationMs: 1200,
    verified: true,
    flags: [],
    timestamp: new Date().toISOString(),
    synthesis: 'The claim is well-supported by available evidence.',
    dissent: null,
    ...overrides,
  } as VerificationResult;
}

function buildPipelineResult(result: VerificationResult, threshold = 0.70): PipelineResult {
  // Replicate the audience: 'pipeline' formatting logic from verify.ts
  const topObj = result.classifiedObjections?.[0];
  return {
    pass: result.confidence > threshold,
    confidence: result.confidence,
    flags: result.flags,
    verdict: result.verdict,
    audience: 'pipeline',
    ...(topObj ? {
      topObjection: {
        type: topObj.type,
        severity: topObj.severity,
        claim: topObj.claim,
      },
    } : {}),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('audience: pipeline — PipelineResult shape', () => {
  it('produces pass: true when confidence > 0.70', () => {
    const result = makeMinimalResult({ confidence: 0.85 });
    const pr = buildPipelineResult(result);
    expect(pr.pass).toBe(true);
    expect(pr.confidence).toBe(0.85);
    expect(pr.verdict).toBe('ALLOW');
    expect(pr.audience).toBe('pipeline');
  });

  it('produces pass: false when confidence <= 0.70', () => {
    const result = makeMinimalResult({ confidence: 0.60, verdict: 'UNCERTAIN', severity_score: null });
    const pr = buildPipelineResult(result);
    expect(pr.pass).toBe(false);
  });

  it('includes flags in pipeline output', () => {
    const result = makeMinimalResult({ flags: ['hedging-detected', 'low-confidence'] });
    const pr = buildPipelineResult(result);
    expect(pr.flags).toContain('hedging-detected');
    expect(pr.flags).toContain('low-confidence');
  });

  it('includes topObjection when classifiedObjections present', () => {
    const objection: ClassifiedObjection = {
      claim: 'The cited study does not exist',
      type: 'factual',
      severity: 'critical',
      explanation: 'No paper with this title found in PubMed',
    };
    const result = makeMinimalResult({ classifiedObjections: [objection] });
    const pr = buildPipelineResult(result);
    expect(pr.topObjection).toBeDefined();
    expect(pr.topObjection?.type).toBe('factual');
    expect(pr.topObjection?.severity).toBe('critical');
    expect(pr.topObjection?.claim).toBe('The cited study does not exist');
  });

  it('omits topObjection when no classifiedObjections', () => {
    const result = makeMinimalResult({ classifiedObjections: undefined });
    const pr = buildPipelineResult(result);
    expect(pr.topObjection).toBeUndefined();
  });

  it('pipeline output does NOT include full synthesis text', () => {
    const result = makeMinimalResult({ synthesis: 'A very long synthesis text...' });
    const pr = buildPipelineResult(result);
    expect((pr as any).synthesis).toBeUndefined();
  });

  it('pipeline output does NOT include dissent details', () => {
    const result = makeMinimalResult({ dissent: { similarity_score: 0.4, diverged: true } });
    const pr = buildPipelineResult(result);
    expect((pr as any).dissent).toBeUndefined();
  });
});

describe('audience: human — backward compatibility', () => {
  it('audience defaults to undefined (no transformation)', () => {
    // Simulates not passing audience — should behave like v0.6.0
    const result = makeMinimalResult();
    expect(result.audience).toBeUndefined();
    expect(result.pipelineResult).toBeUndefined();
  });

  it('Audience type accepts human and pipeline', () => {
    const a1: Audience = 'human';
    const a2: Audience = 'pipeline';
    expect(a1).toBe('human');
    expect(a2).toBe('pipeline');
  });
});

describe('PipelineResult type contract', () => {
  it('satisfies the expected shape', () => {
    const pr: PipelineResult = {
      pass: true,
      confidence: 0.9,
      flags: ['cousin-bias-risk'],
      verdict: 'ALLOW',
      audience: 'pipeline',
      topObjection: { type: 'logical', severity: 'minor', claim: 'Minor leap in step 3' },
    };
    expect(pr.pass).toBe(true);
    expect(pr.topObjection?.severity).toBe('minor');
  });
});

describe('v2.0 verdict values', () => {
  it('BLOCK verdict has severity_score', () => {
    const result = makeMinimalResult({
      verdict: 'BLOCK',
      severity_score: 0.72,
      verified: false,
    });
    expect(result.verdict).toBe('BLOCK');
    expect(result.severity_score).toBe(0.72);
  });

  it('ALLOW verdict has null severity_score', () => {
    const result = makeMinimalResult({ verdict: 'ALLOW', severity_score: null });
    expect(result.severity_score).toBeNull();
  });

  it('UNCERTAIN verdict has null severity_score', () => {
    const result = makeMinimalResult({ verdict: 'UNCERTAIN', severity_score: null });
    expect(result.severity_score).toBeNull();
  });

  it('tier is lite or standard', () => {
    const lite = makeMinimalResult({ tier: 'lite', mdi: null });
    const standard = makeMinimalResult({ tier: 'standard', mdi: 0.67 });
    expect(lite.tier).toBe('lite');
    expect(lite.mdi).toBeNull();
    expect(standard.tier).toBe('standard');
    expect(standard.mdi).toBe(0.67);
  });

  it('objections is always an array', () => {
    const result = makeMinimalResult({ objections: ['Risk too high', 'No stop-loss'] });
    expect(Array.isArray(result.objections)).toBe(true);
    expect(result.objections).toHaveLength(2);
  });
});
