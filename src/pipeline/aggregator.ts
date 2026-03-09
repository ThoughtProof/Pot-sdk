/**
 * Reasoning-Based Aggregator — derive confidence from patterns, not stated numbers.
 *
 * The current pipeline trusts the synthesizer's stated "Confidence: X%".
 * An injection targeting the synthesizer can manipulate this single number.
 *
 * This aggregator derives an INDEPENDENT confidence estimate from:
 * 1. Proposal agreement patterns (do generators agree or diverge?)
 * 2. Critique severity patterns (how many/severe objections exist?)
 * 3. Synthesis reasoning coherence (does the text match the stated confidence?)
 * 4. Cross-stage consistency (do proposals, critique, and synthesis tell the same story?)
 *
 * The aggregated confidence is compared to the synthesizer's stated confidence.
 * Large discrepancies trigger a flag and the aggregated value takes precedence.
 *
 * Credit: voipbin-cco (Moltbook) — "fool the consensus mechanism, not individual verifiers"
 *
 * @since v1.1.0
 */

import type { Proposal, ClassifiedObjection } from '../types.js';

export interface AggregationSignal {
  /** Name of the signal */
  name: string;
  /** Value between 0.0 (very negative) and 1.0 (very positive) */
  value: number;
  /** Weight in final aggregation (0.0 to 1.0) */
  weight: number;
  /** Human-readable explanation */
  reason: string;
}

export interface AggregationResult {
  /** Reasoning-derived confidence (independent of synthesizer's stated value) */
  aggregatedConfidence: number;
  /** Individual signals that contributed */
  signals: AggregationSignal[];
  /** Whether aggregated confidence significantly differs from stated confidence */
  divergesFromStated: boolean;
  /** Absolute difference: |stated - aggregated| */
  divergenceAmount: number;
  /** Whether the aggregated value should override the stated value */
  shouldOverride: boolean;
}

// ── Signal 1: Proposal Agreement ───────────────────────────────────────────

/**
 * Measures semantic agreement between generator proposals.
 * High agreement on claims → higher confidence signal.
 * High divergence → lower confidence signal.
 */
function measureProposalAgreement(proposals: Proposal[]): AggregationSignal {
  if (proposals.length < 2) {
    return { name: 'proposal-agreement', value: 0.5, weight: 0.25, reason: 'Insufficient proposals for agreement analysis' };
  }

  // Extract key terms from each proposal
  const proposalTermSets = proposals.map(p => {
    const terms = p.content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4);
    return new Set(terms);
  });

  // Pairwise Jaccard similarity
  let totalSimilarity = 0;
  let pairs = 0;
  for (let i = 0; i < proposalTermSets.length; i++) {
    for (let j = i + 1; j < proposalTermSets.length; j++) {
      const a = proposalTermSets[i];
      const b = proposalTermSets[j];
      const intersection = new Set([...a].filter(w => b.has(w)));
      const union = new Set([...a, ...b]);
      const jaccard = union.size > 0 ? intersection.size / union.size : 0;
      totalSimilarity += jaccard;
      pairs++;
    }
  }

  const avgSimilarity = pairs > 0 ? totalSimilarity / pairs : 0;

  // Map similarity to confidence signal:
  // 0.0 similarity → 0.3 (total disagreement = very uncertain)
  // 0.3 similarity → 0.5 (moderate divergence = neutral)
  // 0.6+ similarity → 0.7-0.8 (strong agreement = positive signal)
  const value = Math.min(0.85, 0.3 + avgSimilarity * 0.9);

  let reason: string;
  if (avgSimilarity > 0.5) reason = `Strong agreement across ${proposals.length} proposals (${(avgSimilarity * 100).toFixed(0)}% overlap)`;
  else if (avgSimilarity > 0.25) reason = `Moderate agreement across ${proposals.length} proposals (${(avgSimilarity * 100).toFixed(0)}% overlap)`;
  else reason = `Low agreement across ${proposals.length} proposals (${(avgSimilarity * 100).toFixed(0)}% overlap) — high uncertainty`;

  return { name: 'proposal-agreement', value, weight: 0.25, reason };
}

// ── Signal 2: Critique Severity ────────────────────────────────────────────

/**
 * Analyzes the severity and count of critic objections.
 * Many critical objections → lower confidence.
 * Few/minor objections → higher confidence.
 */
function measureCritiqueSeverity(
  critiqueContent: string,
  classifiedObjections?: ClassifiedObjection[],
): AggregationSignal {
  // If we have classified objections, use them directly
  if (classifiedObjections && classifiedObjections.length > 0) {
    const criticalCount = classifiedObjections.filter(o => o.severity === 'critical').length;
    const moderateCount = classifiedObjections.filter(o => o.severity === 'moderate').length;
    const minorCount = classifiedObjections.filter(o => o.severity === 'minor').length;

    // Weighted severity score (higher = worse)
    const severityScore = (criticalCount * 3 + moderateCount * 1.5 + minorCount * 0.5);
    // Normalize: 0 objections → 0.85, 3 critical → 0.15
    const value = Math.max(0.10, 0.85 - severityScore * 0.10);

    return {
      name: 'critique-severity',
      value,
      weight: 0.30,
      reason: `${criticalCount} critical, ${moderateCount} moderate, ${minorCount} minor objections`,
    };
  }

  // Fallback: heuristic analysis of critique text
  const unverifiedCount = (critiqueContent.match(/UNVERIFIED|UNVERIFIZIERT|UNSUPPORTED|UNBELEGT/gi) || []).length;
  const errorIndicators = (critiqueContent.match(/\berror\b|\bflaw\b|\bfalse\b|\bwrong\b|\bincorrect\b/gi) || []).length;

  const totalIssues = unverifiedCount + errorIndicators;
  const value = Math.max(0.15, 0.85 - totalIssues * 0.08);

  return {
    name: 'critique-severity',
    value,
    weight: 0.30,
    reason: `${unverifiedCount} unverified claims, ${errorIndicators} error indicators in critique`,
  };
}

// ── Signal 3: Hedging Analysis ─────────────────────────────────────────────

/**
 * Detects hedging language in the synthesis.
 * Lots of hedging + high stated confidence = suspicious.
 */
function measureHedging(synthesisContent: string): AggregationSignal {
  const hedgePatterns = [
    /\bmight\b/gi, /\bcould\b/gi, /\bpossibly\b/gi, /\bperhaps\b/gi,
    /\bmay\b/gi, /\bpotentially\b/gi, /\bunclear\b/gi, /\buncertain\b/gi,
    /\blikely\b/gi, /\bprobably\b/gi, /\bappears?\b/gi, /\bseems?\b/gi,
    /\bkönnte\b/gi, /\bmöglicherweise\b/gi, /\bvielleicht\b/gi, /\bwahrscheinlich\b/gi,
    /\bunklar\b/gi, /\bunsicher\b/gi, /\beventuell\b/gi,
  ];

  const assertivePatterns = [
    /\bdefinitely\b/gi, /\bclearly\b/gi, /\bcertain\b/gi, /\bconfirmed\b/gi,
    /\bproven\b/gi, /\bevident\b/gi, /\bundeniable\b/gi, /\bestablished\b/gi,
    /\beindeutig\b/gi, /\bbestätigt\b/gi, /\bbewiesen\b/gi, /\bbelegt\b/gi,
  ];

  let hedgeCount = 0;
  for (const p of hedgePatterns) {
    hedgeCount += (synthesisContent.match(p) || []).length;
  }

  let assertiveCount = 0;
  for (const p of assertivePatterns) {
    assertiveCount += (synthesisContent.match(p) || []).length;
  }

  const totalSignals = hedgeCount + assertiveCount;
  if (totalSignals === 0) {
    return { name: 'hedging-analysis', value: 0.60, weight: 0.20, reason: 'Neutral language — no strong hedging or assertion signals' };
  }

  const hedgeRatio = hedgeCount / totalSignals;

  // High hedging → lower confidence signal
  // High assertion → higher confidence signal
  const value = Math.max(0.15, Math.min(0.85, 0.85 - hedgeRatio * 0.70));

  let reason: string;
  if (hedgeRatio > 0.7) reason = `Heavy hedging (${hedgeCount} hedge vs ${assertiveCount} assertive) — low confidence warranted`;
  else if (hedgeRatio > 0.4) reason = `Mixed language (${hedgeCount} hedge vs ${assertiveCount} assertive) — moderate confidence`;
  else reason = `Assertive language (${hedgeCount} hedge vs ${assertiveCount} assertive) — confidence consistent`;

  return { name: 'hedging-analysis', value, weight: 0.20, reason };
}

// ── Signal 4: Cross-Stage Consistency ──────────────────────────────────────

/**
 * Checks if the synthesis addresses the critique's concerns.
 * If critique raised major objections but synthesis ignores them → inconsistency.
 */
function measureCrossStageConsistency(
  critiqueContent: string,
  synthesisContent: string,
): AggregationSignal {
  // Extract critique keywords (likely objection-related)
  const critiqueWords = new Set(
    critiqueContent
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 5)
  );

  const synthesisWords = new Set(
    synthesisContent
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 5)
  );

  // How much of the critique vocabulary appears in the synthesis?
  const critInSynth = [...critiqueWords].filter(w => synthesisWords.has(w)).length;
  const coverageRatio = critiqueWords.size > 0 ? critInSynth / critiqueWords.size : 1;

  // High coverage → synthesis addressed critique → consistent
  // Low coverage → synthesis may have ignored critique → suspicious
  const value = Math.min(0.85, 0.30 + coverageRatio * 0.65);

  let reason: string;
  if (coverageRatio > 0.5) reason = `Synthesis addresses ${(coverageRatio * 100).toFixed(0)}% of critique vocabulary — consistent`;
  else if (coverageRatio > 0.25) reason = `Synthesis partially addresses critique (${(coverageRatio * 100).toFixed(0)}%) — some gaps`;
  else reason = `Synthesis largely ignores critique (${(coverageRatio * 100).toFixed(0)}% coverage) — potential inconsistency`;

  return { name: 'cross-stage-consistency', value, weight: 0.15, reason };
}

// ── Main Aggregator ────────────────────────────────────────────────────────

const DIVERGENCE_THRESHOLD = 0.20; // if |stated - aggregated| > 0.20, flag it

/**
 * Run reasoning-based aggregation to derive independent confidence.
 *
 * @param proposals - Generator proposals (excluding user-output)
 * @param critiqueContent - Critic's full text output
 * @param synthesisContent - Synthesizer's full text output
 * @param statedConfidence - The confidence number parsed from synthesis text
 * @param classifiedObjections - Structured objections if available
 * @returns AggregationResult with independent confidence and divergence info
 */
export function aggregateFromReasoning(
  proposals: Proposal[],
  critiqueContent: string,
  synthesisContent: string,
  statedConfidence: number,
  classifiedObjections?: ClassifiedObjection[],
): AggregationResult {
  const signals: AggregationSignal[] = [
    measureProposalAgreement(proposals),
    measureCritiqueSeverity(critiqueContent, classifiedObjections),
    measureHedging(synthesisContent),
    measureCrossStageConsistency(critiqueContent, synthesisContent),
  ];

  // Weighted average
  let totalWeight = 0;
  let weightedSum = 0;
  for (const signal of signals) {
    weightedSum += signal.value * signal.weight;
    totalWeight += signal.weight;
  }

  const aggregatedConfidence = totalWeight > 0
    ? parseFloat((weightedSum / totalWeight).toFixed(3))
    : statedConfidence;

  const divergenceAmount = Math.abs(statedConfidence - aggregatedConfidence);
  const divergesFromStated = divergenceAmount > DIVERGENCE_THRESHOLD;

  // Override when:
  // 1. Large divergence AND
  // 2. Stated confidence is HIGHER than aggregated (inflation, not deflation)
  // We don't override if stated is lower than aggregated (conservative is fine)
  const shouldOverride = divergesFromStated && statedConfidence > aggregatedConfidence;

  return {
    aggregatedConfidence,
    signals,
    divergesFromStated,
    divergenceAmount: parseFloat(divergenceAmount.toFixed(3)),
    shouldOverride,
  };
}
