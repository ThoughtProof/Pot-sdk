/**
 * @pot-sdk2/polymarket — Types
 *
 * Human Collective Intelligence signals for ThoughtProof verification.
 * Prediction market probabilities as a calibration layer alongside
 * multi-model Machine Consensus.
 */

// ─── Market Data ───────────────────────────────────────────

export interface PolymarketEvent {
  /** Polymarket event ID */
  id: string;
  /** Human-readable event title */
  title: string;
  /** Event description / resolution criteria */
  description: string;
  /** Associated markets (binary outcomes) */
  markets: PolymarketMarket[];
  /** Event category (politics, crypto, sports, etc.) */
  category: string;
  /** Event end date (ISO 8601) */
  endDate: string;
  /** Whether the event is still active */
  active: boolean;
}

export interface PolymarketMarket {
  /** Condition ID (CTF token identifier) */
  conditionId: string;
  /** Market question */
  question: string;
  /** Current YES price (0-1, represents probability) */
  outcomePriceYes: number;
  /** Current NO price (0-1) */
  outcomePriceNo: number;
  /** 24h trading volume in USDC */
  volume24h: number;
  /** Total trading volume in USDC */
  volumeTotal: number;
  /** Current open interest in USDC */
  openInterest: number;
  /** Number of unique traders */
  uniqueTraders: number;
  /** Best bid price (YES side) */
  bestBid: number;
  /** Best ask price (YES side) */
  bestAsk: number;
  /** Bid-ask spread */
  spread: number;
  /** Whether this market meets our liquidity threshold */
  meetsLiquidityThreshold: boolean;
}

// ─── Signal & Confidence ───────────────────────────────────

export type SignalStrength = 'strong' | 'moderate' | 'weak' | 'insufficient';

export interface PredictionSignal {
  /** The market this signal is derived from */
  market: PolymarketMarket;
  /** Probability from the market (0-1) */
  probability: number;
  /** Our confidence in this signal based on liquidity metrics */
  signalConfidence: number;
  /** Signal strength classification */
  strength: SignalStrength;
  /** How much $ is backing this probability */
  backedBy: number;
  /** Human-readable explanation */
  rationale: string;
}

export interface CollectiveIntelligenceResult {
  /** The claim or decision being verified */
  claim: string;
  /** Best matching prediction signal, if any */
  primarySignal: PredictionSignal | null;
  /** All relevant signals found */
  signals: PredictionSignal[];
  /** Composite confidence score (0-1) incorporating all signals */
  collectiveConfidence: number;
  /** How well the PM data aligns with the claim */
  alignment: 'supports' | 'contradicts' | 'neutral' | 'no_data';
  /** Human-readable synthesis */
  synthesis: string;
  /** Timestamp of data fetch */
  fetchedAt: string;
  /** Data freshness indicator */
  staleness: 'fresh' | 'recent' | 'stale';
}

// ─── Configuration ─────────────────────────────────────────

export interface PolymarketConfig {
  /** Minimum open interest (USDC) to consider a market signal reliable */
  minOpenInterest: number;
  /** Maximum acceptable bid-ask spread (0-1) */
  maxSpread: number;
  /** Gamma API base URL */
  gammaApiUrl: string;
  /** CLOB API base URL */
  clobApiUrl: string;
  /** Request timeout in ms */
  timeout: number;
  /** Cache TTL in seconds (market data doesn't change every second) */
  cacheTtlSeconds: number;
  /** Maximum number of markets to search */
  maxMarkets: number;
}

export const DEFAULT_CONFIG: PolymarketConfig = {
  minOpenInterest: 500_000,  // $500K minimum for reliable signal
  maxSpread: 0.05,           // 5% max spread
  gammaApiUrl: 'https://gamma-api.polymarket.com',
  clobApiUrl: 'https://clob.polymarket.com',
  timeout: 10_000,
  cacheTtlSeconds: 300,      // 5 min cache
  maxMarkets: 20,
};

// ─── Integration with pot-sdk ──────────────────────────────

export interface PolymarketEnrichment {
  /** Whether prediction market data was available */
  available: boolean;
  /** The collective intelligence result */
  result: CollectiveIntelligenceResult | null;
  /** Whether the PM signal should modify the verification verdict */
  modifiesVerdict: boolean;
  /** Suggested verdict adjustment */
  verdictAdjustment: 'strengthen' | 'weaken' | 'flag' | 'none';
  /** Additional context for the verification synthesis */
  contextForSynthesis: string;
}
