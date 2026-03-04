/**
 * Behavioral Anomaly Detection
 * 
 * Detects two types of anomalies:
 * 1. Drift — single agent deviates from its own baseline
 * 2. Convergence — multiple agents shift toward same behavior (coordinated compromise)
 * 
 * "Organic evolution is divergent; coordinated compromise is convergent." — thoth-ix
 * "The graph watches the watchmen." — thoth-ix
 */

import type {
  AgentTier,
  AgentTrustProfile,
  AnomalyDetectionConfig,
  AnomalyReport,
  BehavioralFeatures,
} from './types.js';

/**
 * Default anomaly detection configuration.
 * Age-tiered windows and sigma thresholds from v0.9 spec.
 */
export const DEFAULT_ANOMALY_CONFIG: AnomalyDetectionConfig = {
  baselineWindows: { new: 7, established: 30, veteran: 90 },
  sigmaThresholds: { new: 4, established: 3, veteran: 2.5 },
  convergenceThreshold: 0.85,
  convergenceMinAgents: 3,
};

/**
 * Compute cosine similarity between two behavioral feature vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Convert BehavioralFeatures to a flat number array for vector operations.
 */
export function featuresToVector(f: BehavioralFeatures): number[] {
  return [
    f.approvalRate,
    f.meanConfidence,
    f.objectionFrequency,
    f.avgLatencyMs / 10000, // normalize latency
    ...f.domainDistribution,
  ];
}

/**
 * Compute standard deviation of a number array.
 */
function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Detect drift anomaly for a single agent.
 * Compares current behavioral features against a baseline.
 * 
 * @param current - Agent's current behavioral features
 * @param baseline - Array of historical feature snapshots
 * @param tier - Agent's age tier (determines sigma threshold)
 * @param config - Anomaly detection config
 */
export function detectDrift(
  agentId: string,
  current: BehavioralFeatures,
  baseline: BehavioralFeatures[],
  tier: AgentTier,
  config: AnomalyDetectionConfig = DEFAULT_ANOMALY_CONFIG
): AnomalyReport {
  if (baseline.length < 3) {
    return {
      agentId,
      anomalyDetected: false,
      anomalyType: 'none',
      sigmaDeviation: 0,
      triggerFeatures: [],
      recommendation: 'none',
    };
  }

  const sigmaThreshold = config.sigmaThresholds[tier];
  const currentVec = featuresToVector(current);
  const triggerFeatures: string[] = [];
  let maxDeviation = 0;

  const featureNames = ['approvalRate', 'meanConfidence', 'objectionFrequency', 'avgLatencyMs'];

  for (let i = 0; i < Math.min(currentVec.length, featureNames.length); i++) {
    const baselineValues = baseline.map(b => featuresToVector(b)[i]);
    const mean = baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length;
    const sd = stddev(baselineValues);

    if (sd === 0) continue;
    const deviation = Math.abs(currentVec[i] - mean) / sd;

    if (deviation > sigmaThreshold) {
      triggerFeatures.push(featureNames[i]);
    }
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  const anomalyDetected = triggerFeatures.length > 0;
  let recommendation: AnomalyReport['recommendation'] = 'none';
  if (maxDeviation > sigmaThreshold * 2) recommendation = 'revoke';
  else if (maxDeviation > sigmaThreshold * 1.5) recommendation = 'investigate';
  else if (anomalyDetected) recommendation = 'monitor';

  return {
    agentId,
    anomalyDetected,
    anomalyType: anomalyDetected ? 'drift' : 'none',
    sigmaDeviation: Math.round(maxDeviation * 100) / 100,
    triggerFeatures,
    recommendation,
  };
}

/**
 * Detect convergence anomaly across multiple agents.
 * "Organic evolution is divergent; coordinated compromise is convergent."
 * 
 * @param agents - Array of agents with current behavioral features
 * @param config - Anomaly detection config
 */
export function detectConvergence(
  agents: AgentTrustProfile[],
  config: AnomalyDetectionConfig = DEFAULT_ANOMALY_CONFIG
): AnomalyReport | null {
  if (agents.length < config.convergenceMinAgents) return null;

  const vectors = agents.map(a => featuresToVector(a.behavioralFeatures));

  // Compute pairwise similarity
  const similarities: number[] = [];
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      similarities.push(cosineSimilarity(vectors[i], vectors[j]));
    }
  }

  // Count pairs above threshold
  const highSimilarityPairs = similarities.filter(s => s > config.convergenceThreshold).length;
  const totalPairs = similarities.length;
  const convergenceRatio = totalPairs > 0 ? highSimilarityPairs / totalPairs : 0;

  // If >50% of pairs show high similarity, flag convergence
  if (convergenceRatio > 0.5 && highSimilarityPairs >= config.convergenceMinAgents) {
    const convergentIds = agents.map(a => a.agentId);
    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;

    return {
      agentId: 'network',
      anomalyDetected: true,
      anomalyType: 'convergence',
      sigmaDeviation: avgSimilarity,
      triggerFeatures: ['pairwise_cosine_similarity'],
      convergentAgents: convergentIds,
      recommendation: convergenceRatio > 0.8 ? 'revoke' : 'investigate',
    };
  }

  return null;
}
