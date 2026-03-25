/**
 * @pot-sdk2/polymarket — Signal Analyzer
 *
 * Transforms raw Polymarket data into verification-ready signals.
 * This is where "Human Collective Intelligence" becomes a
 * confidence score that enriches ThoughtProof's Machine Consensus.
 *
 * Key insight: Prediction markets are 79% more accurate than
 * alternative forecast methods (meta-analysis, 24 studies).
 * But ONLY in liquid markets. We enforce strict thresholds.
 */

import type {
  PolymarketMarket,
  PredictionSignal,
  SignalStrength,
  CollectiveIntelligenceResult,
  PolymarketConfig,
  MarketReference,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { searchMarkets, searchEvents, getMarket, meetsLiquidityThreshold } from './fetcher.js';

// ─── Signal Analysis ───────────────────────────────────────

/**
 * Classify signal strength based on market liquidity metrics.
 *
 * Strong: High OI, tight spread, high volume = market is very liquid
 * Moderate: Meets thresholds but not exceptional
 * Weak: Below thresholds but still has some signal
 * Insufficient: Too thin to be reliable
 */
export function classifySignalStrength(
  market: PolymarketMarket,
  config: PolymarketConfig = DEFAULT_CONFIG
): SignalStrength {
  const oiRatio = market.openInterest / config.minOpenInterest;
  const spreadOk = market.spread <= config.maxSpread;

  if (oiRatio >= 5 && spreadOk && market.volumeTotal >= 10_000_000) {
    return 'strong';
  }
  if (oiRatio >= 1 && spreadOk) {
    return 'moderate';
  }
  if (oiRatio >= 0.2 || market.volumeTotal >= 100_000) {
    return 'weak';
  }
  return 'insufficient';
}

/**
 * Compute signal confidence (0-1) from market metrics.
 *
 * Uses configurable weights (defaults are HEURISTIC, not empirically calibrated).
 * Override config.confidenceWeights with your own calibrated values.
 *
 * Combines:
 * - Liquidity depth (OI relative to threshold)
 * - Spread quality (tighter = better, uses CLOB data when available)
 * - Volume intensity (more trading = more information)
 */
export function computeSignalConfidence(
  market: PolymarketMarket,
  config: PolymarketConfig = DEFAULT_CONFIG
): number {
  const weights = config.confidenceWeights;

  // Liquidity score (0-1): how much OI vs our minimum
  const liquidityScore = Math.min(
    market.openInterest / config.minOpenInterest,
    1
  );

  // Spread score (0-1): tighter spread = higher score
  const spreadScore =
    market.spread <= 0
      ? 1
      : Math.max(0, 1 - market.spread / config.maxSpread);

  // Volume score (0-1): log scale because volume varies enormously
  const volumeScore = Math.min(
    Math.log10(Math.max(market.volumeTotal, 1)) / 8, // $100M = 1.0
    1
  );

  // Weighted combination using configurable weights
  const confidence =
    liquidityScore * weights.liquidity +
    spreadScore * weights.spread +
    volumeScore * weights.volume;

  return Math.round(confidence * 1000) / 1000; // 3 decimal places
}

/**
 * Convert a market into a PredictionSignal.
 */
export function marketToSignal(
  market: PolymarketMarket,
  config: PolymarketConfig = DEFAULT_CONFIG
): PredictionSignal {
  const strength = classifySignalStrength(market, config);
  const confidence = computeSignalConfidence(market, config);

  // The probability IS the yes price — that's the beauty of prediction markets
  const probability = market.outcomePriceYes;

  const rationale = buildRationale(market, strength, confidence);

  return {
    market,
    probability,
    signalConfidence: confidence,
    strength,
    backedBy: market.openInterest,
    rationale,
  };
}

// ─── Claim Matching ────────────────────────────────────────

/**
 * Extract search keywords from a claim for market matching.
 * Simple but effective: strip common words, keep meaningful terms.
 */
export function extractSearchTerms(claim: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'will', 'would',
    'should', 'could', 'can', 'may', 'might', 'shall', 'must',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'that', 'this', 'these', 'those', 'it', 'its',
    'and', 'or', 'but', 'not', 'no', 'nor',
    'if', 'then', 'so', 'as', 'than',
    'i', 'we', 'you', 'he', 'she', 'they', 'me', 'us',
    'my', 'our', 'your', 'his', 'her', 'their',
    'what', 'which', 'who', 'whom', 'when', 'where', 'how', 'why',
    'very', 'really', 'just', 'about', 'also', 'more',
  ]);

  return claim
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 5); // Max 5 terms
}

/**
 * Score how well a market question matches a claim.
 * Returns 0-1 where 1 = perfect match.
 */
export function matchScore(claim: string, marketQuestion: string): number {
  const claimTerms = extractSearchTerms(claim);
  const marketTerms = new Set(extractSearchTerms(marketQuestion));

  if (claimTerms.length === 0) return 0;

  let matches = 0;
  for (const term of claimTerms) {
    if (marketTerms.has(term)) {
      matches++;
    } else {
      // Partial match: check if any market term contains this term
      for (const mt of marketTerms) {
        if (mt.includes(term) || term.includes(mt)) {
          matches += 0.5;
          break;
        }
      }
    }
  }

  return Math.min(matches / claimTerms.length, 1);
}

// ─── Main Integration Functions ────────────────────────────

/**
 * Query Polymarket for signals relevant to a claim (keyword search).
 *
 * For agentic commerce where the agent knows the market ID,
 * prefer queryByMarket() instead — faster and more accurate.
 */
export async function queryCollectiveIntelligence(
  claim: string,
  config: PolymarketConfig = DEFAULT_CONFIG
): Promise<CollectiveIntelligenceResult> {
  const fetchedAt = new Date().toISOString();

  // Extract search terms from the claim
  const terms = extractSearchTerms(claim);

  if (terms.length === 0) {
    return noDataResult(claim, fetchedAt);
  }

  // Search with different term combinations for better coverage
  const searchQueries = [
    terms.join(' '),
    terms.slice(0, 3).join(' '),
    terms[0], // Broadest single-term search
  ];

  const allMarkets: PolymarketMarket[] = [];
  const seenIds = new Set<string>();

  for (const query of searchQueries) {
    try {
      const markets = await searchMarkets(query, config);
      for (const m of markets) {
        if (!seenIds.has(m.conditionId)) {
          allMarkets.push(m);
          seenIds.add(m.conditionId);
        }
      }

      // Also search events
      const events = await searchEvents(query, config);
      for (const e of events) {
        for (const m of e.markets) {
          if (!seenIds.has(m.conditionId)) {
            allMarkets.push(m);
            seenIds.add(m.conditionId);
          }
        }
      }
    } catch {
      // Continue with next query
    }
  }

  if (allMarkets.length === 0) {
    return noDataResult(claim, fetchedAt);
  }

  // Score and rank markets by relevance to the claim
  const scored = allMarkets
    .map((market) => ({
      market,
      relevance: matchScore(claim, market.question),
    }))
    .filter((s) => s.relevance > 0.2) // Minimum relevance threshold
    .sort((a, b) => b.relevance - a.relevance);

  if (scored.length === 0) {
    return noDataResult(claim, fetchedAt);
  }

  // Convert to signals
  const signals = scored.map((s) => marketToSignal(s.market, config));

  // Primary signal = best match that meets liquidity threshold (runtime check)
  const primarySignal =
    signals.find(
      (s) => s.strength === 'strong' || s.strength === 'moderate'
    ) || signals[0];

  // Compute composite confidence
  const collectiveConfidence = computeCompositeConfidence(signals);

  // Determine alignment
  const alignment = determineAlignment(primarySignal);

  // Build synthesis
  const synthesis = buildSynthesis(
    claim,
    primarySignal,
    signals.length,
    collectiveConfidence
  );

  return {
    claim,
    primarySignal,
    signals,
    collectiveConfidence,
    alignment,
    synthesis,
    fetchedAt,
    staleness: 'fresh',
  };
}

/**
 * Query collective intelligence using a direct market reference.
 *
 * This is the PREFERRED method for agentic commerce — the agent already
 * knows which market it's trading on, so we skip keyword matching entirely.
 * Faster, more accurate, zero ambiguity.
 *
 * Supports three modes:
 * 1. snapshot provided → zero API calls, instant
 * 2. conditionId only → one Gamma API call
 * 3. conditionId + tokenId → Gamma + CLOB for real spread
 */
export async function queryByMarket(
  claim: string,
  marketRef: MarketReference,
  config: PolymarketConfig = DEFAULT_CONFIG
): Promise<CollectiveIntelligenceResult> {
  const fetchedAt = new Date().toISOString();

  try {
    // If agent provided a snapshot, use it directly — zero API calls
    let market: PolymarketMarket | null = marketRef.snapshot || null;

    if (!market) {
      market = await getMarket(marketRef.conditionId, config);
    }

    if (!market) {
      return noDataResult(
        claim,
        fetchedAt,
        `Market ${marketRef.conditionId} not found on Polymarket.`
      );
    }

    const signal = marketToSignal(market, config);

    // If agent specified an outcome, adjust probability AND context
    if (marketRef.outcome === 'NO') {
      signal.probability = market.outcomePriceNo;
      signal.rationale = buildRationale(
        market, signal.strength, signal.signalConfidence,
        'NO', market.outcomePriceNo
      );
    }

    const collectiveConfidence = signal.signalConfidence;

    // Alignment considers the agent's INTENDED outcome
    const alignment = determineAlignmentWithIntent(
      signal,
      marketRef.outcome || 'YES'
    );

    const synthesis = buildSynthesis(
      claim,
      signal,
      1,
      collectiveConfidence
    );

    return {
      claim,
      primarySignal: signal,
      signals: [signal],
      collectiveConfidence,
      alignment,
      synthesis,
      fetchedAt,
      staleness: marketRef.snapshot ? 'recent' : 'fresh',
    };
  } catch (error) {
    return noDataResult(
      claim,
      fetchedAt,
      `Failed to fetch market ${marketRef.conditionId}: ${error instanceof Error ? error.message : 'unknown'}`
    );
  }
}

// ─── Internal Helpers ──────────────────────────────────────

function noDataResult(
  claim: string,
  fetchedAt: string,
  reason?: string
): CollectiveIntelligenceResult {
  return {
    claim,
    primarySignal: null,
    signals: [],
    collectiveConfidence: 0,
    alignment: 'no_data',
    synthesis:
      reason ||
      'No relevant prediction market data found for this claim. Verification relies on multi-model consensus only.',
    fetchedAt,
    staleness: 'fresh',
  };
}

function computeCompositeConfidence(signals: PredictionSignal[]): number {
  if (signals.length === 0) return 0;

  const strengthWeights: Record<SignalStrength, number> = {
    strong: 1.0,
    moderate: 0.7,
    weak: 0.3,
    insufficient: 0.1,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const signal of signals) {
    const weight = strengthWeights[signal.strength];
    weightedSum += signal.signalConfidence * weight;
    totalWeight += weight;
  }

  return totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 1000) / 1000
    : 0;
}

/**
 * Determine alignment for keyword-search mode (no intent known).
 * Simply looks at the YES probability.
 */
function determineAlignment(
  signal: PredictionSignal | null
): 'supports' | 'contradicts' | 'neutral' | 'no_data' {
  if (!signal) return 'no_data';

  if (signal.probability >= 0.7 && signal.strength !== 'insufficient') {
    return 'supports';
  }
  if (signal.probability <= 0.3 && signal.strength !== 'insufficient') {
    return 'contradicts';
  }
  return 'neutral';
}

/**
 * Determine alignment considering the agent's intended outcome.
 *
 * This fixes the bug where an agent buying NO at 0.35 YES / 0.65 NO
 * was treated as "neutral" when it should be "supports" (the market
 * agrees: NO is more likely).
 *
 * Logic:
 * - Agent buys YES → high YES price = supports, low YES price = contradicts
 * - Agent buys NO → high NO price = supports, low NO price = contradicts
 */
export function determineAlignmentWithIntent(
  signal: PredictionSignal,
  agentOutcome: 'YES' | 'NO'
): 'supports' | 'contradicts' | 'neutral' | 'no_data' {
  if (signal.strength === 'insufficient') return 'neutral';

  const relevantPrice =
    agentOutcome === 'YES'
      ? signal.market.outcomePriceYes
      : signal.market.outcomePriceNo;

  if (relevantPrice >= 0.7) return 'supports';
  if (relevantPrice <= 0.3) return 'contradicts';
  return 'neutral';
}

function buildRationale(
  market: PolymarketMarket,
  strength: SignalStrength,
  confidence: number,
  outcome: 'YES' | 'NO' = 'YES',
  overridePrice?: number
): string {
  const oi = formatUsd(market.openInterest);
  const vol = formatUsd(market.volumeTotal);
  const price = overridePrice ?? market.outcomePriceYes;
  const pct = (price * 100).toFixed(1);
  const spreadSource = market.spreadFromClob ? 'CLOB' : 'estimated';

  const strengthLabel = {
    strong: 'High-confidence signal',
    moderate: 'Moderate-confidence signal',
    weak: 'Low-confidence signal (thin market)',
    insufficient: 'Insufficient data (market too thin)',
  }[strength];

  return `${strengthLabel}: Market "${market.question}" shows ${pct}% probability (${outcome}). Backed by ${oi} open interest, ${vol} total volume. Spread: ${(market.spread * 100).toFixed(2)}% (${spreadSource}). Signal confidence: ${(confidence * 100).toFixed(1)}%.`;
}

function buildSynthesis(
  claim: string,
  primarySignal: PredictionSignal | null,
  totalSignals: number,
  confidence: number
): string {
  if (!primarySignal) {
    return 'No prediction market data available for this claim.';
  }

  const pct = (primarySignal.probability * 100).toFixed(1);
  const oi = formatUsd(primarySignal.backedBy);

  if (primarySignal.strength === 'strong') {
    return `Human Collective Intelligence (${totalSignals} market${totalSignals > 1 ? 's' : ''}) shows ${pct}% probability, backed by ${oi} in open interest. This is a strong signal from liquid, well-traded markets. Composite confidence: ${(confidence * 100).toFixed(1)}%.`;
  }

  if (primarySignal.strength === 'moderate') {
    return `Prediction market data (${totalSignals} market${totalSignals > 1 ? 's' : ''}) suggests ${pct}% probability with ${oi} backing. Moderate confidence due to decent but not exceptional liquidity. Composite: ${(confidence * 100).toFixed(1)}%.`;
  }

  return `Limited prediction market data found (${totalSignals} market${totalSignals > 1 ? 's' : ''}). Best signal: ${pct}% probability with ${oi} backing. Low confidence — treat as supplementary, not authoritative. Machine consensus should be primary.`;
}

function formatUsd(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}
