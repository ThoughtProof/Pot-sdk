/**
 * v0.6: Auto-Calibration — entropy-based confidence adjustment.
 *
 * If confidence is high but synthesis hedges, reduce confidence.
 * If confidence is low but synthesis is assertive, flag mismatch.
 *
 * Part of "The Mirror" — verification that verifies itself.
 *
 * v0.7 addition: Rasch-style per-model bias correction (calibrateByModel).
 * β values empirically measured 2026-03-23 from raw_scores.json (60 API calls,
 * no prompt hints). Verdict-aware: strict models get asymmetric treatment
 * depending on whether they block (UNCERTAIN) or allow (ALLOW).
 */

export interface CalibrationResult {
  adjusted: boolean;
  delta: number;
  originalConfidence: number;
  calibratedConfidence: number;
  reason?: string;
}

const HEDGING_PATTERNS = [
  /\bmight\b/i, /\bpossibly\b/i, /\bcould be\b/i, /\bit['']?s unclear\b/i,
  /\bperhaps\b/i, /\bpotentially\b/i, /\bnot certain\b/i, /\bhard to say\b/i,
  /\bsome evidence\b/i, /\bmay or may not\b/i, /\btentatively\b/i,
  /\bunclear whether\b/i, /\bremains to be seen\b/i, /\bspeculative\b/i,
];

const ASSERTIVE_PATTERNS = [
  /\bclearly\b/i, /\bdefinitively\b/i, /\bwithout doubt\b/i, /\bundeniably\b/i,
  /\bcertainly\b/i, /\bproven\b/i, /\bestablished fact\b/i, /\bunquestionably\b/i,
  /\bno question\b/i, /\babsolutely\b/i, /\bdefinitely\b/i,
];

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, p) => count + (p.test(text) ? 1 : 0), 0);
}

/**
 * Calibrate confidence based on synthesis language entropy.
 * Always runs (no opt-in needed) — part of the pipeline's self-check.
 */
export function calibrateConfidence(confidence: number, synthesisText: string): CalibrationResult {
  const hedgingCount = countMatches(synthesisText, HEDGING_PATTERNS);
  const assertiveCount = countMatches(synthesisText, ASSERTIVE_PATTERNS);

  // High confidence + hedging language → reduce
  if (confidence > 0.80 && hedgingCount >= 3) {
    const delta = -0.15;
    return {
      adjusted: true,
      delta,
      originalConfidence: confidence,
      calibratedConfidence: Math.max(0.1, confidence + delta),
      reason: `High confidence (${confidence}) with ${hedgingCount} hedging indicators — auto-reduced`,
    };
  }

  if (confidence > 0.80 && hedgingCount >= 2) {
    const delta = -0.10;
    return {
      adjusted: true,
      delta,
      originalConfidence: confidence,
      calibratedConfidence: Math.max(0.1, confidence + delta),
      reason: `High confidence (${confidence}) with ${hedgingCount} hedging indicators — auto-reduced`,
    };
  }

  // Low confidence + assertive language → flag mismatch (don't auto-adjust upward)
  if (confidence < 0.50 && assertiveCount >= 2) {
    return {
      adjusted: false,
      delta: 0,
      originalConfidence: confidence,
      calibratedConfidence: confidence,
      reason: `Low confidence (${confidence}) but ${assertiveCount} assertive indicators — calibration mismatch`,
    };
  }

  return {
    adjusted: false,
    delta: 0,
    originalConfidence: confidence,
    calibratedConfidence: confidence,
  };
}

// ─── Per-Model Rasch Calibration (v0.7) ──────────────────────────────────────

/**
 * β values: positive = model over-blocks (too strict), negative = over-allows.
 * Empirically measured 2026-03-23 from raw_scores.json (no prompt hints).
 *
 *   deepseek: 3x false-positive strict-on-ALLOW → β=+0.40
 *   grok:     2x false-positive strict-on-ALLOW → β=+0.20
 *   gemini:   1/5 routine blocked (staking_eth HOLD), matches Grok → β=+0.20 (empirical)
 *   sonnet:   reference model, best accuracy (60%), β=0.00 (no adjustment)
 */
const MODEL_BIAS: Record<string, number> = {
  deepseek: +0.40,
  grok:     +0.20,
  gemini:   +0.20,  // empirical: 1/5 routine blocked (staking_eth HOLD), matches Grok
  claude:   +0.00,  // reference
  sonnet:   +0.00,  // alias for claude/sonnet family
};

const BIAS_SCALE  = 0.10;  // flat correction multiplier
const BIAS_CAP    = 0.12;  // max flat correction (conservative)

/**
 * Verdict-aware Rasch-style bias correction.
 *
 * Asymmetric logic for strict models (β > 0):
 *   UNCERTAIN → discount the block signal  (strict model hedging = weak evidence)
 *   ALLOW     → amplify the allow signal   (strict model saying ALLOW = rare & strong)
 *   others    → small flat correction capped at BIAS_CAP
 *
 * Sonnet/Claude (β=0) pass through unchanged — they are the calibration baseline.
 * Verdicts are never flipped; only confidence is adjusted, bounded [0, 1].
 *
 * @param rawConfidence  Raw confidence from the model (0–1)
 * @param modelName      Model identifier (partial match: "deepseek", "grok", etc.)
 * @param verdict        Model's verdict: "ALLOW" | "HOLD" | "UNCERTAIN" | "DISSENT"
 */
export function calibrateByModel(
  rawConfidence: number,
  modelName: string,
  verdict: string,
): CalibrationResult {
  const key = Object.keys(MODEL_BIAS).find((k) => modelName.toLowerCase().includes(k));
  const beta = key !== undefined ? MODEL_BIAS[key] : 0.0;

  let correction: number;
  let reason: string;

  if (beta > 0 && verdict.toUpperCase() === 'UNCERTAIN') {
    correction = -(beta * 0.20);
    reason = `${modelName} is strict (β=${beta}) and uncertain — discounting block signal`;
  } else if (beta > 0 && verdict.toUpperCase() === 'ALLOW') {
    correction = +(beta * 0.10);
    reason = `${modelName} is strict (β=${beta}) but allows — rare signal, amplifying`;
  } else {
    correction = Math.min(BIAS_CAP, beta * BIAS_SCALE);
    reason = beta === 0
      ? `${modelName} is reference model — no adjustment`
      : `${modelName} flat bias correction (β=${beta})`;
  }

  const calibrated = Math.min(1.0, Math.max(0.0, rawConfidence + correction));
  const delta = calibrated - rawConfidence;

  return {
    adjusted: delta !== 0,
    delta,
    originalConfidence: rawConfidence,
    calibratedConfidence: calibrated,
    reason,
  };
}
