/**
 * v0.6: Auto-Calibration — entropy-based confidence adjustment.
 *
 * If confidence is high but synthesis hedges, reduce confidence.
 * If confidence is low but synthesis is assertive, flag mismatch.
 *
 * Part of "The Mirror" — verification that verifies itself.
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
