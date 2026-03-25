/**
 * @pot-sdk2/polymarket
 *
 * Human Collective Intelligence for ThoughtProof Verification.
 *
 * Prediction market probabilities as a calibration layer alongside
 * multi-model Machine Consensus. No AI can verify itself — so humans
 * and machines verify each other.
 *
 * @example
 * ```ts
 * import { enrichVerification, queryByMarket } from '@pot-sdk2/polymarket';
 *
 * // PREFERRED: Direct market ID (agentic commerce)
 * const enriched = await enrichVerification({
 *   claim: 'Buying YES on BTC $200K market',
 *   modelVerdict: 'ALLOW',
 *   modelConfidence: 0.85,
 *   stakeLevel: 'high',
 *   market: {
 *     conditionId: '0xabc123',
 *     outcome: 'YES',
 *   },
 * });
 *
 * // With snapshot (zero API calls):
 * const enriched = await enrichVerification({
 *   claim: 'Buying YES on BTC $200K market',
 *   modelVerdict: 'ALLOW',
 *   modelConfidence: 0.85,
 *   market: {
 *     conditionId: '0xabc123',
 *     outcome: 'YES',
 *     snapshot: agentMarketData, // PolymarketMarket the agent already fetched
 *   },
 * });
 *
 * // Fallback: Keyword search (generic claims)
 * const signals = await queryCollectiveIntelligence(
 *   'Will the EU AI Act be fully enforced by 2027?'
 * );
 * ```
 *
 * @packageDocumentation
 */

// ─── Core Types ────────────────────────────────────────────

export type {
  PolymarketEvent,
  PolymarketMarket,
  PredictionSignal,
  SignalStrength,
  CollectiveIntelligenceResult,
  PolymarketConfig,
  ConfidenceWeights,
  PolymarketEnrichment,
  MarketReference,
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';

// ─── Errors ────────────────────────────────────────────────

export {
  PolymarketError,
  RateLimitError,
  MarketNotFoundError,
  ApiDownError,
  TimeoutError,
} from './errors.js';

// ─── Rate Limiting ─────────────────────────────────────────

export { tryConsume, waitAndConsume, resetRateLimiter } from './rate-limiter.js';

// ─── Data Fetching ─────────────────────────────────────────

export {
  searchEvents,
  searchMarkets,
  getMarket,
  getOrderBook,
  getMidPrice,
  meetsLiquidityThreshold,
  clearCache,
} from './fetcher.js';

// ─── Signal Analysis ───────────────────────────────────────

export {
  classifySignalStrength,
  computeSignalConfidence,
  marketToSignal,
  extractSearchTerms,
  matchScore,
  queryCollectiveIntelligence,
  queryByMarket,
  determineAlignmentWithIntent,
} from './analyzer.js';

// ─── Verification Integration ──────────────────────────────

export { enrichVerification } from './enrichment.js';
