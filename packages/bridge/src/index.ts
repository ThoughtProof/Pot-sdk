/**
 * @pot-sdk2/bridge — Cross-Agent Trust Verification (v0.9 "The Bridge")
 *
 * Architecture co-designed with thoth-ix (Moltbook, 2026-02-28).
 * 13 spec components from the community thread.
 *
 * Three layers:
 * 1. Trust Decay — transitive trust with multiplicative decay per hop
 * 2. Behavioral Anomaly Detection — drift and convergence monitoring
 * 3. Grace-Period Revocation — TLS-inspired revocation with blast radius
 *
 * Key insights:
 * - "A critic without memory is just a random number generator with opinions."
 * - "The graph watches the watchmen."
 * - "Organic evolution is divergent; coordinated compromise is convergent."
 *
 * @example
 * import { computeTransitiveTrust, detectDrift, createRevocationEvent } from '@pot-sdk2/bridge';
 *
 * // Check if transitive trust survives 3 hops
 * const result = computeTransitiveTrust({
 *   baseTrust: 0.95,
 *   decayPerHop: 0.90,
 *   floor: 0.30,
 *   ceiling: 0.95,
 *   consumerThreshold: 0.70,
 *   failureCost: 'high',
 * }, ['agentA', 'agentB', 'agentC', 'agentD']);
 *
 * if (result.requiresIndependentVerification) {
 *   // Transitive trust too low — verify directly
 * }
 */

// Trust Decay Engine
export {
  computeTransitiveTrust,
  findBestTrustPath,
  wouldTrustSurvive,
} from './decay.js';

// Behavioral Anomaly Detection
export {
  cosineSimilarity,
  featuresToVector,
  detectDrift,
  detectConvergence,
  DEFAULT_ANOMALY_CONFIG,
} from './anomaly.js';

// Grace-Period Revocation
export {
  computeBlastRadius,
  createRevocationEvent,
  determineRevocationTier,
} from './revocation.js';

// Remote Verification (API + Local multi-model)
export {
  verify,
  quickVerify,
  THOUGHTPROOF_API_URL,
} from './remote.js';

export type {
  VerifyMode,
  Verdict,
  VerifierResult,
  VerificationReceipt,
  RemoteVerifyOptions,
  LocalVerifyOptions,
  LocalModelConfig,
  VerifyOptions,
} from './remote.js';

// Types
export type {
  TrustDecayConfig,
  TrustDecayResult,
  FailureCostLevel,
  AgentTrustProfile,
  AgentTier,
  BehavioralFeatures,
  AnomalyDetectionConfig,
  AnomalyReport,
  RevocationTier,
  RevocationEvent,
  BlastRadiusResult,
  TrustEdge,
  TrustGraph,
} from './types.js';
