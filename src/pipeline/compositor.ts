import type { ProviderConfig, Synthesis, Verdict } from '../types.js';
import { createProviderFromConfig } from '../providers/index.js';

export interface SubVerdict {
  claim: string;
  verdict: Verdict;
  confidence: number;
  synthesis?: string;
  flags?: string[];
}

export interface CompositionalResult {
  verdict: Verdict;
  confidence: number;
  synthesis: string;
  compositionRisk: 'low' | 'medium' | 'high' | 'critical';
}

const COMPOSITOR_PROMPT = `You are a compositional verifier. You receive an original compound claim, a list of sub-verdicts (one per step), and their dependency relationships. Your job is to produce a single compositional verdict.

ORIGINAL CLAIM:
{claim}

SUB-VERDICTS:
{subVerdicts}

DEPENDENCIES:
{dependencies}

COMPOSITIONAL RULES (apply in order):
1. If ANY sub-claim is UNVERIFIED and has a high-dependency relationship with subsequent steps → compound verdict: UNVERIFIED
2. If ALL sub-claims are VERIFIED → compound verdict proceeds through calibration (see confidence below)
3. If verdicts are mixed and dependencies are low → compound verdict: UNCERTAIN, flag each risk
4. If any sub-claim verdict is DISSENT → inherit DISSENT at compound level

COMPOSITION RISK:
- critical: any UNVERIFIED sub-claim in a chain where later steps depend on it
- high: any UNVERIFIED sub-claim, even if isolated
- medium: any UNCERTAIN sub-claim
- low: all sub-claims VERIFIED

CONFIDENCE SCORING:
- Use the MINIMUM sub-claim confidence as the base
- Apply a dependency penalty: reduce by 0.05 for each dependency chain that includes an UNVERIFIED sub-claim
- Cap at 0.85 — compound claims have inherent uncertainty

Respond ONLY with a valid JSON object:
{
  "verdict": "VERIFIED|UNVERIFIED|UNCERTAIN|DISSENT",
  "confidence": <number 0-1>,
  "synthesis": "<2-4 sentence explanation of the compositional verdict, citing specific sub-claim verdicts>",
  "compositionRisk": "low|medium|high|critical"
}`;

/**
 * v1.3+: Produce a compositional verdict from sub-verification results.
 * Uses the cheapest available provider (same philosophy as decomposer).
 * Returns a conservative fallback if LLM call fails.
 * Credit: RECURSIVE-VERIFY-SPEC.md — Compositional Synthesis
 */
export async function compositionalSynthesize(
  originalClaim: string,
  subVerdicts: SubVerdict[],
  dependencies: string[],
  providers: ProviderConfig[],
): Promise<CompositionalResult> {
  // Fallback: derive verdict from rules without LLM if needed
  const fallback = applyCompositionalRules(subVerdicts, dependencies);

  if (providers.length === 0) {
    return fallback;
  }

  // Use last provider (synthesizer role) or cheapest available
  const cfg = providers[providers.length - 1] || providers[0];
  const provider = createProviderFromConfig(cfg);

  const subVerdictsText = subVerdicts
    .map((sv, i) => `Step ${i + 1}: "${sv.claim}"\n  Verdict: ${sv.verdict} (confidence: ${(sv.confidence * 100).toFixed(0)}%)${sv.flags?.length ? `\n  Flags: ${sv.flags.join(', ')}` : ''}${sv.synthesis ? `\n  Synthesis: ${sv.synthesis.slice(0, 200)}` : ''}`)
    .join('\n\n');

  const dependenciesText = dependencies.length > 0
    ? dependencies.join('\n')
    : 'No explicit dependencies specified';

  const prompt = COMPOSITOR_PROMPT
    .replace('{claim}', originalClaim)
    .replace('{subVerdicts}', subVerdictsText)
    .replace('{dependencies}', dependenciesText);

  try {
    const response = await provider.call(cfg.model, prompt);
    const content = response.content.trim();

    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content;

    const parsed = JSON.parse(jsonStr) as CompositionalResult;

    const validVerdicts: Verdict[] = ['VERIFIED', 'UNVERIFIED', 'UNCERTAIN', 'DISSENT'];
    if (!validVerdicts.includes(parsed.verdict)) {
      return fallback;
    }

    return {
      verdict: parsed.verdict,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || fallback.confidence)),
      synthesis: parsed.synthesis || fallback.synthesis,
      compositionRisk: (['low', 'medium', 'high', 'critical'].includes(parsed.compositionRisk)
        ? parsed.compositionRisk
        : fallback.compositionRisk),
    };
  } catch (err) {
    console.warn('[pot-sdk] Compositional synthesis failed, using rule-based fallback:', err instanceof Error ? err.message : err);
    return fallback;
  }
}

/**
 * Rule-based compositional verdict fallback (no LLM required).
 * Implements the compositional rules from the spec deterministically.
 */
function applyCompositionalRules(subVerdicts: SubVerdict[], dependencies: string[]): CompositionalResult {
  if (subVerdicts.length === 0) {
    return { verdict: 'UNCERTAIN', confidence: 0.5, synthesis: 'No sub-verdicts to compose.', compositionRisk: 'medium' };
  }

  const hasUnverified = subVerdicts.some(sv => sv.verdict === 'UNVERIFIED');
  const hasUncertain = subVerdicts.some(sv => sv.verdict === 'UNCERTAIN');
  const hasDissent = subVerdicts.some(sv => sv.verdict === 'DISSENT');
  const allVerified = subVerdicts.every(sv => sv.verdict === 'VERIFIED');

  const minConfidence = Math.min(...subVerdicts.map(sv => sv.confidence));
  const hasDependencies = dependencies.length > 0;

  let verdict: Verdict;
  let compositionRisk: CompositionalResult['compositionRisk'];
  let confidence: number;

  if (hasDissent) {
    verdict = 'DISSENT';
    compositionRisk = 'high';
    confidence = minConfidence * 0.7;
  } else if (hasUnverified && hasDependencies) {
    verdict = 'UNVERIFIED';
    compositionRisk = 'critical';
    confidence = minConfidence * 0.6;
  } else if (hasUnverified) {
    verdict = 'UNVERIFIED';
    compositionRisk = 'high';
    confidence = minConfidence * 0.7;
  } else if (allVerified) {
    verdict = 'VERIFIED';
    compositionRisk = 'low';
    confidence = Math.min(minConfidence, 0.85);
  } else if (hasUncertain) {
    verdict = 'UNCERTAIN';
    compositionRisk = 'medium';
    confidence = minConfidence * 0.85;
  } else {
    verdict = 'UNCERTAIN';
    compositionRisk = 'medium';
    confidence = minConfidence * 0.8;
  }

  const unverifiedClaims = subVerdicts.filter(sv => sv.verdict === 'UNVERIFIED').map(sv => `"${sv.claim}"`).join(', ');
  const synthesis = hasUnverified
    ? `Compound claim is UNVERIFIED. Sub-claim(s) failed verification: ${unverifiedClaims}. Proceeding with the compound action is not recommended.`
    : allVerified
      ? `All ${subVerdicts.length} sub-claims verified. Compound action appears sound based on individual step analysis.`
      : `Mixed verdicts across ${subVerdicts.length} sub-claims. Compound action carries uncertainty — review each step independently.`;

  return { verdict, confidence: Math.max(0, Math.min(1, confidence)), synthesis, compositionRisk };
}
