import { describe, it, expect } from 'vitest';
import {
  computeTransitiveTrust,
  findBestTrustPath,
  wouldTrustSurvive,
  cosineSimilarity,
  featuresToVector,
  detectDrift,
  detectConvergence,
  computeBlastRadius,
  determineRevocationTier,
  DEFAULT_ANOMALY_CONFIG,
} from '../src/index.js';
import type { AgentTrustProfile, BehavioralFeatures, TrustEdge } from '../src/index.js';

// ─── Trust Decay Tests ──────────────────────────────────────────────────────

describe('Trust Decay', () => {
  const baseConfig = {
    baseTrust: 0.95,
    decayPerHop: 0.90,
    floor: 0.30,
    ceiling: 0.95,
    consumerThreshold: 0.70,
    failureCost: 'low' as const,
  };

  it('direct trust (1 hop) should barely decay', () => {
    const direct = computeTransitiveTrust(baseConfig, ['A', 'B']);
    expect(direct.hops).toBe(1);
    expect(direct.trust).toBeGreaterThan(0.8);
    expect(direct.requiresIndependentVerification).toBe(false);
  });

  it('3 hops should decay significantly', () => {
    const direct = computeTransitiveTrust(baseConfig, ['A', 'B']);
    const threeHops = computeTransitiveTrust(baseConfig, ['A', 'B', 'C', 'D']);
    expect(threeHops.hops).toBe(3);
    expect(threeHops.trust).toBeLessThan(direct.trust);
  });

  it('critical failure cost should narrow corridor significantly', () => {
    const threeHopsLow = computeTransitiveTrust(baseConfig, ['A', 'B', 'C']);
    const critical = computeTransitiveTrust({ ...baseConfig, failureCost: 'critical' }, ['A', 'B', 'C']);
    expect(critical.effectiveThreshold).toBeGreaterThan(threeHopsLow.effectiveThreshold);
    expect(critical.requiresIndependentVerification).toBe(true);
  });

  it('zero hops = direct trust', () => {
    const noHops = computeTransitiveTrust(baseConfig, ['A']);
    expect(noHops.hops).toBe(0);
    expect(noHops.trust).toBe(0.95);
  });
});

// ─── wouldTrustSurvive ─────────────────────────────────────────────────────

describe('wouldTrustSurvive', () => {
  it('survives at 1 hop', () => {
    expect(wouldTrustSurvive(0.95, 0.90, 1, 0.70)).toBe(true);
  });

  it('does not survive at 5 hops', () => {
    expect(wouldTrustSurvive(0.95, 0.90, 5, 0.70)).toBe(false); // 0.95 * 0.9^5 = 0.56
  });

  it('survives at 3 hops with lower threshold', () => {
    expect(wouldTrustSurvive(0.95, 0.90, 3, 0.60)).toBe(true); // 0.95 * 0.9^3 = 0.69
  });
});

// ─── Cosine Similarity ─────────────────────────────────────────────────────

describe('Cosine Similarity', () => {
  it('identical vectors = 1.0', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0, 3);
  });

  it('orthogonal vectors = 0.0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 3);
  });

  it('same direction = ~1.0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeGreaterThan(0.99);
  });

  it('empty vectors = 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

// ─── Drift Detection ────────────────────────────────────────────────────────

describe('Drift Detection', () => {
  const normalFeatures: BehavioralFeatures = {
    approvalRate: 0.85,
    meanConfidence: 0.80,
    domainDistribution: [0.3, 0.3, 0.4],
    objectionFrequency: 0.15,
    avgLatencyMs: 1200,
  };

  const baseline: BehavioralFeatures[] = Array(10).fill(null).map(() => ({
    ...normalFeatures,
    approvalRate: 0.85 + (Math.random() - 0.5) * 0.02,
    meanConfidence: 0.80 + (Math.random() - 0.5) * 0.02,
  }));

  it('normal behavior — no anomaly', () => {
    const report = detectDrift('agent-1', normalFeatures, baseline, 'established');
    expect(report.anomalyDetected).toBe(false);
    expect(report.recommendation).toBe('none');
  });

  it('anomalous behavior — approval rate drops dramatically', () => {
    const anomalousFeatures: BehavioralFeatures = {
      ...normalFeatures,
      approvalRate: 0.20,
      meanConfidence: 0.30,
    };
    const report = detectDrift('agent-1', anomalousFeatures, baseline, 'established');
    expect(report.anomalyDetected).toBe(true);
    expect(report.anomalyType).toBe('drift');
    expect(report.triggerFeatures.length).toBeGreaterThan(0);
  });
});

// ─── Convergence Detection ──────────────────────────────────────────────────

describe('Convergence Detection', () => {
  it('detects agents with very similar behavior as suspicious', () => {
    const convergentAgents: AgentTrustProfile[] = [
      { agentId: 'a', trustScore: 0.9, verificationsContributed: 100, verificationsConsumed: 50, ageDays: 60, tier: 'established', behavioralFeatures: { approvalRate: 0.95, meanConfidence: 0.92, domainDistribution: [0.5, 0.5], objectionFrequency: 0.05, avgLatencyMs: 800 }, flagged: false, lastActive: '' },
      { agentId: 'b', trustScore: 0.9, verificationsContributed: 95, verificationsConsumed: 48, ageDays: 55, tier: 'established', behavioralFeatures: { approvalRate: 0.94, meanConfidence: 0.91, domainDistribution: [0.5, 0.5], objectionFrequency: 0.06, avgLatencyMs: 810 }, flagged: false, lastActive: '' },
      { agentId: 'c', trustScore: 0.9, verificationsContributed: 98, verificationsConsumed: 52, ageDays: 50, tier: 'established', behavioralFeatures: { approvalRate: 0.96, meanConfidence: 0.93, domainDistribution: [0.5, 0.5], objectionFrequency: 0.04, avgLatencyMs: 790 }, flagged: false, lastActive: '' },
    ];
    const report = detectConvergence(convergentAgents);
    expect(report).not.toBeNull();
    expect(report!.anomalyType).toBe('convergence');
    expect(report!.convergentAgents!.length).toBe(3);
  });
});

// ─── Blast Radius ───────────────────────────────────────────────────────────

describe('Blast Radius', () => {
  it('identifies directly trusting agents', () => {
    const agents = new Map<string, AgentTrustProfile>();
    const edges: TrustEdge[] = [
      { from: 'B', to: 'A', trust: 0.9, lastVerified: '2026-03-01', verificationCount: 10 },
      { from: 'C', to: 'B', trust: 0.85, lastVerified: '2026-03-01', verificationCount: 5 },
      { from: 'D', to: 'A', trust: 0.7, lastVerified: '2026-03-01', verificationCount: 3 },
      { from: 'E', to: 'C', trust: 0.8, lastVerified: '2026-03-01', verificationCount: 7 },
    ];
    const blast = computeBlastRadius('A', edges, agents);
    expect(blast.affectedAgents).toContain('B');
    expect(blast.affectedAgents).toContain('D');
  });
});

// ─── Revocation Tier ────────────────────────────────────────────────────────

describe('Revocation Tier', () => {
  it('immediate for high severity', () => {
    expect(determineRevocationTier(8.0, 3.0)).toBe('immediate');
  });

  it('notify for medium severity', () => {
    expect(determineRevocationTier(5.0, 3.0)).toBe('notify');
  });

  it('expire for low severity', () => {
    expect(determineRevocationTier(3.5, 3.0)).toBe('expire');
  });
});
