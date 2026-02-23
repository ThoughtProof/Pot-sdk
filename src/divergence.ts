import type { VerificationResult } from './types.js';

export type DivergenceLevel = 'none' | 'low' | 'moderate' | 'high';

export interface DivergenceReport {
  level: DivergenceLevel;
  mdi: number;                    // Model Diversity Index (0–1)
  sas: number;                    // Synthesis Audit Score (0–1)
  dominantModel: string | null;   // Model with highest synthesis share
  dominanceScore: number;         // Share of dominant model (0–1)
  synthesisDiverged: boolean;     // Did dual synthesizers disagree?
  flags: string[];                // All flags from verification
  disagreements: string[];        // Structured disagreement points parsed from flags
  summary: string;                // Human-readable one-liner
}

export function formatDivergenceReport(result: VerificationResult): DivergenceReport {
  const mdi = result.mdi ?? 1;
  const sas = result.sas ?? 1;
  const biasMap = result.biasMap ?? {};
  const dissent = result.dissent as { diverged?: boolean; similarity_score?: number } | undefined;

  // Dominant model from biasMap
  const entries = Object.entries(biasMap).sort(([, a], [, b]) => b - a);
  const dominantModel = entries.length > 0 ? entries[0][0] : null;
  const dominanceScore = entries.length > 0 ? entries[0][1] : 0;

  // Synthesis divergence
  const synthesisDiverged = dissent?.diverged ?? false;

  // Structured disagreements from flags
  const disagreements = (result.flags ?? [])
    .filter(f => f !== 'synthesis-dominance' && f !== 'low-model-diversity' && f !== 'low-confidence')
    .map(f => {
      if (f === 'unverified-claims') return 'Critic identified unverified or disputed claims';
      if (f === 'adversarial-pattern') return 'Adversarial injection pattern detected in output';
      if (f.startsWith('adversarial:')) return `Adversarial pattern matched: ${f.replace('adversarial:', '')}`;
      return f;
    });

  // Divergence level
  let level: DivergenceLevel = 'none';
  const hasAdversarial = result.flags?.some(f => f.startsWith('adversarial'));
  if (hasAdversarial || mdi < 0.3 || dominanceScore > 0.8) {
    level = 'high';
  } else if (result.flags?.includes('unverified-claims') || synthesisDiverged || dominanceScore > 0.65) {
    level = 'moderate';
  } else if (sas < 0.7 || mdi < 0.6) {
    level = 'low';
  }

  // Summary
  const summaryParts: string[] = [];
  if (hasAdversarial) summaryParts.push('adversarial injection detected');
  if (dominantModel && dominanceScore > 0.65) summaryParts.push(`${dominantModel} dominated synthesis (${Math.round(dominanceScore * 100)}%)`);
  if (result.flags?.includes('unverified-claims')) summaryParts.push('unverified claims flagged by critic');
  if (synthesisDiverged) summaryParts.push('dual synthesizers diverged');

  const summary = summaryParts.length > 0
    ? `Divergence [${level.toUpperCase()}]: ${summaryParts.join('; ')}.`
    : `No significant divergence detected. Confidence: ${(result.confidence * 100).toFixed(0)}%.`;

  return {
    level,
    mdi,
    sas,
    dominantModel,
    dominanceScore,
    synthesisDiverged,
    flags: result.flags ?? [],
    disagreements,
    summary,
  };
}
