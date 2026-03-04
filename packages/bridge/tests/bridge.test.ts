import assert from 'assert';
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

// Direct trust (1 hop) should barely decay
const direct = computeTransitiveTrust({
  baseTrust: 0.95,
  decayPerHop: 0.90,
  floor: 0.30,
  ceiling: 0.95,
  consumerThreshold: 0.70,
  failureCost: 'low',
}, ['A', 'B']);

assert.strictEqual(direct.hops, 1);
assert.ok(direct.trust > 0.8, 'Direct trust should be > 0.8, got: ' + direct.trust);
assert.strictEqual(direct.requiresIndependentVerification, false);

// 3 hops should decay significantly
const threeHops = computeTransitiveTrust({
  baseTrust: 0.95,
  decayPerHop: 0.90,
  floor: 0.30,
  ceiling: 0.95,
  consumerThreshold: 0.70,
  failureCost: 'low',
}, ['A', 'B', 'C', 'D']);

assert.strictEqual(threeHops.hops, 3);
assert.ok(threeHops.trust < direct.trust, '3 hops should be less than 1 hop');

// Critical failure cost should narrow corridor significantly
const critical = computeTransitiveTrust({
  baseTrust: 0.95,
  decayPerHop: 0.90,
  floor: 0.30,
  ceiling: 0.95,
  consumerThreshold: 0.70,
  failureCost: 'critical',
}, ['A', 'B', 'C']);

assert.ok(critical.effectiveThreshold > threeHops.effectiveThreshold,
  'Critical threshold should be higher than low');
assert.strictEqual(critical.requiresIndependentVerification, true);

// Zero hops = direct trust
const noHops = computeTransitiveTrust({
  baseTrust: 0.95,
  decayPerHop: 0.90,
  floor: 0.30,
  ceiling: 0.95,
  consumerThreshold: 0.70,
  failureCost: 'low',
}, ['A']);

assert.strictEqual(noHops.hops, 0);
assert.strictEqual(noHops.trust, 0.95);

console.log('✅ Trust decay tests passed');

// ─── wouldTrustSurvive ─────────────────────────────────────────────────────

assert.strictEqual(wouldTrustSurvive(0.95, 0.90, 1, 0.70), true);
assert.strictEqual(wouldTrustSurvive(0.95, 0.90, 5, 0.70), false); // 0.95 * 0.9^5 = 0.56
assert.strictEqual(wouldTrustSurvive(0.95, 0.90, 3, 0.60), true);  // 0.95 * 0.9^3 = 0.69

console.log('✅ wouldTrustSurvive tests passed');

// ─── Cosine Similarity ─────────────────────────────────────────────────────

assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1.0) < 0.001, 'identical vectors = 1.0');
assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [0, 1, 0])) < 0.001, 'orthogonal vectors = 0.0');
assert.ok(cosineSimilarity([1, 2, 3], [1, 2, 3]) > 0.99, 'same direction = ~1.0');
assert.strictEqual(cosineSimilarity([], []), 0);

console.log('✅ Cosine similarity tests passed');

// ─── Drift Detection ────────────────────────────────────────────────────────

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

// Normal behavior — no anomaly
const normalReport = detectDrift('agent-1', normalFeatures, baseline, 'established');
assert.strictEqual(normalReport.anomalyDetected, false);
assert.strictEqual(normalReport.recommendation, 'none');

// Anomalous behavior — approval rate drops dramatically
const anomalousFeatures: BehavioralFeatures = {
  ...normalFeatures,
  approvalRate: 0.20, // dropped from 0.85 to 0.20
  meanConfidence: 0.30, // also dropped
};

const anomalyReport = detectDrift('agent-1', anomalousFeatures, baseline, 'established');
assert.strictEqual(anomalyReport.anomalyDetected, true);
assert.strictEqual(anomalyReport.anomalyType, 'drift');
assert.ok(anomalyReport.triggerFeatures.length > 0);

console.log('✅ Drift detection tests passed');

// ─── Convergence Detection ──────────────────────────────────────────────────

// Agents with very similar behavior → suspicious
const convergentAgents: AgentTrustProfile[] = [
  { agentId: 'a', trustScore: 0.9, verificationsContributed: 100, verificationsConsumed: 50, ageDays: 60, tier: 'established', behavioralFeatures: { approvalRate: 0.95, meanConfidence: 0.92, domainDistribution: [0.5, 0.5], objectionFrequency: 0.05, avgLatencyMs: 800 }, flagged: false, lastActive: '' },
  { agentId: 'b', trustScore: 0.9, verificationsContributed: 95, verificationsConsumed: 48, ageDays: 55, tier: 'established', behavioralFeatures: { approvalRate: 0.94, meanConfidence: 0.91, domainDistribution: [0.5, 0.5], objectionFrequency: 0.06, avgLatencyMs: 810 }, flagged: false, lastActive: '' },
  { agentId: 'c', trustScore: 0.9, verificationsContributed: 98, verificationsConsumed: 52, ageDays: 50, tier: 'established', behavioralFeatures: { approvalRate: 0.96, meanConfidence: 0.93, domainDistribution: [0.5, 0.5], objectionFrequency: 0.04, avgLatencyMs: 790 }, flagged: false, lastActive: '' },
];

const convergenceReport = detectConvergence(convergentAgents);
assert.ok(convergenceReport !== null, 'Should detect convergence');
assert.strictEqual(convergenceReport!.anomalyType, 'convergence');
assert.strictEqual(convergenceReport!.convergentAgents!.length, 3);

console.log('✅ Convergence detection tests passed');

// ─── Blast Radius ───────────────────────────────────────────────────────────

const agents = new Map<string, AgentTrustProfile>();
const edges: TrustEdge[] = [
  { from: 'B', to: 'A', trust: 0.9, lastVerified: '2026-03-01', verificationCount: 10 },
  { from: 'C', to: 'B', trust: 0.85, lastVerified: '2026-03-01', verificationCount: 5 },
  { from: 'D', to: 'A', trust: 0.7, lastVerified: '2026-03-01', verificationCount: 3 },
  { from: 'E', to: 'C', trust: 0.8, lastVerified: '2026-03-01', verificationCount: 7 },
];

const blast = computeBlastRadius('A', edges, agents);
assert.ok(blast.affectedAgents.includes('B'), 'B trusts A directly');
assert.ok(blast.affectedAgents.includes('D'), 'D trusts A directly');

console.log('✅ Blast radius tests passed');

// ─── Revocation Tier ────────────────────────────────────────────────────────

assert.strictEqual(determineRevocationTier(8.0, 3.0), 'immediate');  // 8 > 3*2
assert.strictEqual(determineRevocationTier(5.0, 3.0), 'notify');     // 5 > 3*1.5
assert.strictEqual(determineRevocationTier(3.5, 3.0), 'expire');     // 3.5 < 3*1.5

console.log('✅ Revocation tier tests passed');

console.log('\n🎉 All @pot-sdk2/bridge tests passed!');
