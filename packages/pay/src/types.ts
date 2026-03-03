import type { ProviderConfig } from 'pot-sdk';

export interface PayVerifyOptions {
  /** Payment amount in the specified currency */
  amount: number;
  /** Currency code (e.g. 'USDC', 'ETH') */
  currency: string;
  /** Provider configs — same format as pot-sdk core */
  providers: ProviderConfig[];
  /** Verification policy — defaults to 'tiered' */
  policy?: 'tiered' | 'always' | 'skip';
  /** Minimum aggregate confidence to PASS (0.0–1.0, default: 0.80) */
  minConfidence?: number;
  /** Minimum verifier count required to PASS (default: 2) */
  minVerifiers?: number;
  /** Attestation provider URL (default: thoughtproof.ai) */
  attestationProvider?: string;
  /**
   * Consensus mode for multi-verifier decisions.
   * - "majority": flag if ≥2/3 verifiers flag (default, lowest FP rate)
   * - "conservative": flag if ANY verifier flags (highest detection, more FP)
   * - "weighted": profile-weighted scoring — flagging verifiers contribute their
   *   benchmark-derived weight; flags if weighted flag score > total weight / 2
   *
   * @default "majority"
   */
  consensusMode?: 'majority' | 'conservative' | 'weighted';
  /**
   * Auto-switch to "conservative" consensus above this transaction value (USD equivalent).
   * Overrides consensusMode for high-value transactions.
   * @default 50
   */
  valueThreshold?: number;
  /**
   * Optional context about the agent's task/situation.
   * Passed to the DSPy-optimized verifier prompt for improved accuracy.
   * Example: "Agent managing cloud infrastructure costs for ACME Corp"
   */
  context?: string;
}

export interface PayVerifyResult {
  /** Final verdict */
  verdict: 'PASS' | 'FLAG' | 'SKIP';
  /** Aggregate confidence score (0.0–1.0) */
  confidence: number;
  /** Number of verifiers that returned a verdict */
  verifiers: number;
  /** SHA-256 hash of the reasoning chain + tx nonce */
  chainHash: string;
  /** Ready-to-use X-402-Attestation-* headers */
  attestationHeaders: Record<string, string>;
  /** Unique audit ID for post-hoc inspection */
  auditId: string;
  /** Concerns flagged by verifiers (if verdict = FLAG) */
  concerns?: string[];
  /** Time taken for verification in ms */
  latencyMs: number;
}

export interface PaymentIntent {
  /** Payment amount */
  amount: number;
  /** Currency code */
  currency: string;
  /** Target resource URL */
  resource: string;
  /** Agent's reasoning chain (agent-reported for MVP) */
  reasoningChain?: string;
}

export interface PayWrapOptions extends Omit<PayVerifyOptions, 'amount' | 'currency'> {
  /** Called when a payment is flagged (instead of throwing) */
  onFlag?: (result: PayVerifyResult, intent: PaymentIntent) => void;
}
