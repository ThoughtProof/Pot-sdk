/**
 * @pot-sdk2/bridge — Cross-Agent Trust Verification Types
 * 
 * Co-designed with thoth-ix (Moltbook, 2026-02-28)
 * 13 spec components from the community thread
 */

// ─── Trust Decay ────────────────────────────────────────────────────────────

export interface TrustDecayConfig {
  /** Base trust score between two directly connected agents (0.0–1.0) */
  baseTrust: number;
  /** Decay factor per hop (default: 0.90 — 10% loss per hop) */
  decayPerHop: number;
  /** Protocol-enforced minimum trust (floor). Prevents paranoia gridlock. */
  floor: number;
  /** Protocol-enforced maximum transitive trust (ceiling). Prevents naive propagation. */
  ceiling: number;
  /** Consumer's chosen threshold within [floor, ceiling]. Below this → independent verification required. */
  consumerThreshold: number;
  /** Failure cost multiplier — higher stakes = stricter decay. Narrows the floor/ceiling corridor. */
  failureCost: FailureCostLevel;
}

export type FailureCostLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TrustDecayResult {
  /** Computed transitive trust after decay */
  trust: number;
  /** Number of hops in the trust chain */
  hops: number;
  /** Whether independent verification is recommended */
  requiresIndependentVerification: boolean;
  /** The effective threshold used (adjusted by failure cost) */
  effectiveThreshold: number;
  /** Trust chain path (agent IDs) */
  path: string[];
}

// ─── Agent Trust Scores ─────────────────────────────────────────────────────

export interface AgentTrustProfile {
  /** Unique agent identifier */
  agentId: string;
  /** Overall trust score (0.0–1.0) */
  trustScore: number;
  /** Number of verifications contributed */
  verificationsContributed: number;
  /** Number of verifications consumed */
  verificationsConsumed: number;
  /** Agent age in days */
  ageDays: number;
  /** Agent tier based on age */
  tier: AgentTier;
  /** Behavioral feature vector for anomaly detection */
  behavioralFeatures: BehavioralFeatures;
  /** Whether the agent is currently flagged */
  flagged: boolean;
  /** Timestamp of last activity */
  lastActive: string;
}

export type AgentTier = 'new' | 'established' | 'veteran';

export interface BehavioralFeatures {
  /** Approval rate (fraction of verifications that passed) */
  approvalRate: number;
  /** Mean confidence score across verifications */
  meanConfidence: number;
  /** Distribution of domains verified (normalized vector) */
  domainDistribution: number[];
  /** Objection frequency (how often the agent raises concerns) */
  objectionFrequency: number;
  /** Average response latency in ms */
  avgLatencyMs: number;
}

// ─── Behavioral Anomaly Detection ───────────────────────────────────────────

export interface AnomalyDetectionConfig {
  /** Baseline window by tier: new=7d, established=30d, veteran=90d */
  baselineWindows: Record<AgentTier, number>;
  /** Sigma threshold by tier: new=4σ, established=3σ, veteran=2.5σ */
  sigmaThresholds: Record<AgentTier, number>;
  /** Convergence correlation threshold (>0.85 across 3+ agents = suspicious) */
  convergenceThreshold: number;
  /** Minimum agents for convergence check */
  convergenceMinAgents: number;
}

export interface AnomalyReport {
  /** Agent under analysis */
  agentId: string;
  /** Whether anomaly was detected */
  anomalyDetected: boolean;
  /** Type of anomaly: drift, convergence, or none */
  anomalyType: 'drift' | 'convergence' | 'none';
  /** Sigma deviation from baseline */
  sigmaDeviation: number;
  /** Which features triggered the anomaly */
  triggerFeatures: string[];
  /** Convergent agents (if convergence detected) */
  convergentAgents?: string[];
  /** Recommended action */
  recommendation: 'none' | 'monitor' | 'investigate' | 'revoke';
}

// ─── Grace-Period Revocation ────────────────────────────────────────────────

export type RevocationTier = 'immediate' | 'notify' | 'expire';

export interface RevocationEvent {
  /** Agent being revoked */
  agentId: string;
  /** Reason for revocation */
  reason: string;
  /** Revocation tier */
  tier: RevocationTier;
  /** Grace period in hours (0 for immediate) */
  gracePeriodHours: number;
  /** Affected attestation IDs (blast radius) */
  affectedAttestations: string[];
  /** Downstream agents affected */
  affectedAgents: string[];
  /** Timestamp of revocation event */
  timestamp: string;
}

export interface BlastRadiusResult {
  /** The compromised agent */
  compromisedAgent: string;
  /** All agents with transitive trust through the compromised agent */
  affectedAgents: string[];
  /** All attestations signed or transitively trusted through the compromised agent */
  affectedAttestations: string[];
  /** Maximum depth of affected trust chains */
  maxDepth: number;
}

// ─── Trust Graph ────────────────────────────────────────────────────────────

export interface TrustEdge {
  /** Source agent */
  from: string;
  /** Target agent */
  to: string;
  /** Direct trust score */
  trust: number;
  /** Last verification timestamp */
  lastVerified: string;
  /** Number of successful verifications between these agents */
  verificationCount: number;
}

export interface TrustGraph {
  /** All agents in the network */
  agents: Map<string, AgentTrustProfile>;
  /** All trust edges */
  edges: TrustEdge[];
}
