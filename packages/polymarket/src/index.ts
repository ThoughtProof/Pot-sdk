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
 * import { enrichVerification, queryCollectiveIntelligence } from '@pot-sdk2/polymarket';
 *
 * // Standalone: Query prediction market signals for any claim
 * const signals = await queryCollectiveIntelligence(
 *   'Will the EU AI Act be fully enforced by 2027?'
 * );
 * console.log(signals.collectiveConfidence); // 0.73
 * console.log(signals.alignment); // 'supports'
 *
 * // Integrated: Enrich a ThoughtProof verification
 * const enriched = await enrichVerification({
 *   claim: 'Bitcoin will reach $200K by end of 2026',
 *   modelVerdict: 'ALLOW',
 *   modelConfidence: 0.85,
 *   stakeLevel: 'high',
 * });
 *
 * if (enriched.verdictAdjustment === 'flag') {
 *   console.log('⚠️ Crowd disagrees with models!');
 *   console.log(enriched.contextForSynthesis);
 * }
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
  PolymarketEnrichment,
  MarketReference,
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';

// ─── Data Fetching ─────────────────────────────────────────

export {
  searchEvents,
  searchMarkets,
  getMarket,
  getOrderBook,
  getMidPrice,
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
} from './analyzer.js';

// ─── Verification Integration ──────────────────────────────

export { enrichVerification } from './enrichment.js';
