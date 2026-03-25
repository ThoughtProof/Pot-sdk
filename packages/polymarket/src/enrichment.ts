/**
 * @pot-sdk2/polymarket — Verification Enrichment
 *
 * The integration layer between Polymarket signals and
 * ThoughtProof's verification pipeline.
 *
 * This module answers: "Should prediction market data
 * modify the verification verdict?"
 *
 * Philosophy:
 * - Machine Consensus (3 models) = primary verdict
 * - Human Collective Intelligence (PM) = calibration layer
 * - PM can STRENGTHEN confidence (crowd agrees with models)
 * - PM can FLAG concerns (crowd disagrees with models)
 * - PM should NEVER override model consensus alone
 *   (fail-closed principle: uncertain = HOLD)
 */

import type {
  PolymarketConfig,
  PolymarketEnrichment,
  CollectiveIntelligenceResult,
  MarketReference,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { queryCollectiveIntelligence, queryByMarket } from './analyzer.js';

// ─── Verdict Types (matching pot-sdk core) ─────────────────

type PotVerdict = 'ALLOW' | 'BLOCK' | 'UNCERTAIN';

interface VerificationContext {
  /** The original claim being verified */
  claim: string;
  /** The current model consensus verdict */
  modelVerdict: PotVerdict;
  /** Model consensus confidence (0-1) */
  modelConfidence: number;
  /** Domain of the claim */
  domain?: string;
  /** Stake level of the decision */
  stakeLevel?: 'low' | 'medium' | 'high' | 'critical';
  /**
   * Direct market reference — PREFERRED for agentic commerce.
   * When the agent already knows which market it's trading on,
   * pass the conditionId directly. Skips keyword matching entirely.
   * Faster, more accurate, zero ambiguity.
   */
  market?: MarketReference;
}

// ─── Main Enrichment Function ──────────────────────────────

/**
 * Enrich a ThoughtProof verification with prediction market signals.
 *
 * Call this AFTER the multi-model consensus is computed,
 * BEFORE the final verdict is emitted.
 *
 * @example
 * ```ts
 * // Option A: Keyword search (generic claims)
 * const enriched = await enrichVerification({
 *   claim: 'Bitcoin will reach $200K',
 *   modelVerdict: 'ALLOW',
 *   modelConfidence: 0.72,
 *   stakeLevel: 'high',
 * });
 *
 * // Option B: Direct market ID (agentic commerce — PREFERRED)
 * const enriched = await enrichVerification({
 *   claim: 'Buying YES on BTC $200K market',
 *   modelVerdict: 'ALLOW',
 *   modelConfidence: 0.72,
 *   stakeLevel: 'high',
 *   market: {
 *     conditionId: '0xabc123',
 *     outcome: 'YES',
 *   },
 * });
 * ```
 */
export async function enrichVerification(
  context: VerificationContext,
  config: PolymarketConfig = DEFAULT_CONFIG
): Promise<PolymarketEnrichment> {
  try {
    // If agent provides a direct market reference, use it (faster + accurate)
    // Otherwise fall back to keyword-based search
    const result = context.market
      ? await queryByMarket(context.claim, context.market, config)
      : await queryCollectiveIntelligence(context.claim, config);

    if (!result.primarySignal || result.alignment === 'no_data') {
      return {
        available: false,
        result,
        modifiesVerdict: false,
        verdictAdjustment: 'none',
        contextForSynthesis:
          'No prediction market data available for calibration.',
      };
    }

    const adjustment = computeVerdictAdjustment(context, result);

    return {
      available: true,
      result,
      modifiesVerdict: adjustment !== 'none',
      verdictAdjustment: adjustment,
      contextForSynthesis: buildEnrichmentContext(context, result, adjustment),
    };
  } catch (error) {
    // Fail-open for data fetching: if PM API is down,
    // verification continues with model consensus only
    return {
      available: false,
      result: null,
      modifiesVerdict: false,
      verdictAdjustment: 'none',
      contextForSynthesis: `Prediction market data unavailable (${error instanceof Error ? error.message : 'unknown error'}). Proceeding with model consensus only.`,
    };
  }
}

// ─── Verdict Adjustment Logic ──────────────────────────────

function computeVerdictAdjustment(
  context: VerificationContext,
  pmResult: CollectiveIntelligenceResult
): 'strengthen' | 'weaken' | 'flag' | 'none' {
  const primarySignal = pmResult.primarySignal;
  if (!primarySignal) return 'none';

  // Only strong/moderate signals should influence verdicts
  if (
    primarySignal.strength === 'weak' ||
    primarySignal.strength === 'insufficient'
  ) {
    return 'none';
  }

  const pmProb = primarySignal.probability;
  const modelVerdict = context.modelVerdict;
  const stakeLevel = context.stakeLevel || 'medium';

  // ─── Agreement: PM + Models align → STRENGTHEN
  if (modelVerdict === 'ALLOW' && pmResult.alignment === 'supports') {
    return 'strengthen';
  }

  if (modelVerdict === 'BLOCK' && pmResult.alignment === 'contradicts') {
    return 'strengthen';
  }

  // ─── Disagreement: PM contradicts Models → FLAG
  // This is the critical case. The crowd sees something the models don't.
  if (modelVerdict === 'ALLOW' && pmResult.alignment === 'contradicts') {
    // High-stake decisions: always flag disagreement
    if (stakeLevel === 'critical' || stakeLevel === 'high') {
      return 'flag';
    }
    // Medium stake: flag only if PM signal is strong
    if (primarySignal.strength === 'strong') {
      return 'flag';
    }
    return 'weaken';
  }

  if (modelVerdict === 'BLOCK' && pmResult.alignment === 'supports') {
    // Models say BLOCK but crowd says YES — worth noting but
    // we err on the side of caution (fail-closed)
    return 'weaken';
  }

  // ─── Uncertain model + strong PM signal → could go either way
  if (modelVerdict === 'UNCERTAIN') {
    if (pmProb >= 0.8 && primarySignal.strength === 'strong') {
      return 'strengthen'; // PM provides clarity
    }
    if (pmProb <= 0.2 && primarySignal.strength === 'strong') {
      return 'strengthen'; // PM provides clarity (negative)
    }
  }

  return 'none';
}

// ─── Context Building ──────────────────────────────────────

function buildEnrichmentContext(
  context: VerificationContext,
  pmResult: CollectiveIntelligenceResult,
  adjustment: 'strengthen' | 'weaken' | 'flag' | 'none'
): string {
  const signal = pmResult.primarySignal!;
  const pct = (signal.probability * 100).toFixed(1);
  const oi = formatUsd(signal.backedBy);
  const signalCount = pmResult.signals.length;

  let prefix: string;
  switch (adjustment) {
    case 'strengthen':
      prefix = '✅ PREDICTION MARKET ALIGNMENT';
      break;
    case 'weaken':
      prefix = '⚠️ PREDICTION MARKET DIVERGENCE';
      break;
    case 'flag':
      prefix = '🚨 PREDICTION MARKET CONTRADICTION';
      break;
    default:
      prefix = 'ℹ️ PREDICTION MARKET DATA';
  }

  const lines = [
    prefix,
    `Human Collective Intelligence: ${signalCount} relevant market${signalCount > 1 ? 's' : ''} found`,
    `Primary signal: "${signal.market.question}" → ${pct}% probability`,
    `Backed by: ${oi} in open interest (${signal.strength} signal)`,
    `Model verdict: ${context.modelVerdict} (${(context.modelConfidence * 100).toFixed(0)}% confidence)`,
    `PM alignment: ${pmResult.alignment}`,
    `Composite confidence: ${(pmResult.collectiveConfidence * 100).toFixed(1)}%`,
  ];

  if (adjustment === 'flag') {
    lines.push(
      '',
      '⚠️ The crowd disagrees with model consensus. This does NOT override',
      'the model verdict, but warrants human review before settlement.'
    );
  }

  if (adjustment === 'strengthen') {
    lines.push(
      '',
      '✅ Machine Consensus + Human Collective Intelligence are aligned.',
      'Higher confidence in the verification result.'
    );
  }

  return lines.join('\n');
}

function formatUsd(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}
