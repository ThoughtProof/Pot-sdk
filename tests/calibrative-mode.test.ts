/**
 * Tests for criticMode: 'calibrative' (v0.6.1)
 *
 * Calibrative mode re-scores confidence WITHOUT generating new objections.
 * It analyzes structural coherence (hedging, logical leaps, consistency)
 * and outputs a JSON adjustment factor.
 *
 * Credit: Moltbook "Not all friction" discussion (85 comments)
 */
import { describe, it, expect } from 'vitest';
import { parseCalibrationCriticResult } from '../src/pipeline/critic.js';

describe('parseCalibrationCriticResult', () => {
  it('parses a valid negative adjustment', () => {
    const content = '{"adjustment": -0.12, "reason": "High hedging contradicts stated confidence"}';
    const result = parseCalibrationCriticResult(content);
    expect(result.adjustment).toBeCloseTo(-0.12);
    expect(result.reason).toBe('High hedging contradicts stated confidence');
  });

  it('parses a valid positive adjustment', () => {
    const content = '{"adjustment": 0.08, "reason": "Analysis is overly conservative given strong evidence"}';
    const result = parseCalibrationCriticResult(content);
    expect(result.adjustment).toBeCloseTo(0.08);
    expect(result.reason).toContain('conservative');
  });

  it('clamps adjustment to [-0.30, +0.15] range', () => {
    const over = '{"adjustment": 0.99, "reason": "way too high"}';
    expect(parseCalibrationCriticResult(over).adjustment).toBe(0.15);

    const under = '{"adjustment": -0.99, "reason": "way too low"}';
    expect(parseCalibrationCriticResult(under).adjustment).toBe(-0.30);
  });

  it('handles JSON embedded in surrounding text', () => {
    const content = `Here is my calibration result:
{"adjustment": -0.05, "reason": "Minor hedging detected"}
That concludes the review.`;
    const result = parseCalibrationCriticResult(content);
    expect(result.adjustment).toBeCloseTo(-0.05);
    expect(result.reason).toBe('Minor hedging detected');
  });

  it('returns safe defaults on parse failure', () => {
    const result = parseCalibrationCriticResult('not json at all');
    expect(result.adjustment).toBe(0);
    expect(result.reason).toMatch(/parse-failed/);
  });

  it('returns safe defaults on invalid JSON structure', () => {
    const result = parseCalibrationCriticResult('{"foo": "bar"}');
    expect(result.adjustment).toBe(0);
  });

  it('handles adjustment: 0 (no change)', () => {
    const content = '{"adjustment": 0, "reason": "Confidence matches evidence quality"}';
    const result = parseCalibrationCriticResult(content);
    expect(result.adjustment).toBe(0);
    expect(result.reason).toContain('Confidence');
  });
});

describe('CriticMode calibrative — type contract', () => {
  it('calibrative is a valid CriticMode value', async () => {
    // Import the type guard indirectly by ensuring the string literal is accepted
    // This test mainly verifies TypeScript compilation succeeds.
    const mode: import('../src/types.js').CriticMode = 'calibrative';
    expect(mode).toBe('calibrative');
  });
});
