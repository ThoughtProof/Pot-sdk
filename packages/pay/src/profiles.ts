/**
 * Verifier performance profiles — benchmark-driven weights for consensus modes.
 * Data sourced from ThoughtProof benchmark runs v1 + v3b (2026-03-01/02).
 *
 * Task: payment_verification (adversarial reasoning chain detection)
 * Generator: DeepSeek (excluded from verification pool)
 * Verifiers: Sonnet, Kimi-32k, Grok (500 chains, 250 adversarial / 250 legitimate)
 */

export interface VerifierProfile {
  /** Model identifier (matches ProviderConfig.model) */
  modelId: string;
  /** Provider family */
  family: 'anthropic' | 'xai' | 'moonshot' | 'deepseek' | 'openai' | string;
  /** Per-task benchmark scores */
  taskScores: {
    payment_verification: {
      /** True positive rate (adversarial detection) */
      detection: number;
      /** False positive rate (legitimate flagged as suspicious) */
      fpRate: number;
      /** Benchmark version that produced this score */
      benchmarkVersion: string;
    };
  };
  /**
   * Consensus weight (0.1–3.0).
   * Used in "weighted" consensusMode: flagging verifiers contribute their weight to the flag score.
   * Derived from detection score — higher detection → higher weight.
   */
  weight: number;
  /**
   * True if detection >= 0.70 — suitable as primary verifier for payment security.
   * Warn users if no recommended verifier is in their provider list.
   */
  recommended: boolean;
}

/**
 * Benchmark-driven verifier profiles.
 * Update this list when new benchmark runs complete.
 */
export const VERIFIER_PROFILES: VerifierProfile[] = [
  {
    modelId: 'claude-sonnet-4-5',
    family: 'anthropic',
    taskScores: {
      payment_verification: { detection: 0.916, fpRate: 0.020, benchmarkVersion: 'v3b' },
    },
    weight: 3.0,
    recommended: true,
  },
  {
    modelId: 'claude-sonnet-4-6',
    family: 'anthropic',
    taskScores: {
      // Treat same-generation Sonnet variants as equivalent until separately benchmarked
      payment_verification: { detection: 0.916, fpRate: 0.020, benchmarkVersion: 'v3b-inferred' },
    },
    weight: 3.0,
    recommended: true,
  },
  {
    modelId: 'deepseek-chat',
    family: 'deepseek',
    taskScores: {
      payment_verification: { detection: 0.944, fpRate: 0.000, benchmarkVersion: 'v1' },
    },
    weight: 2.8,
    recommended: true,
  },
  {
    modelId: 'grok-4-1-fast',
    family: 'xai',
    taskScores: {
      payment_verification: { detection: 0.448, fpRate: 0.012, benchmarkVersion: 'v3b' },
    },
    weight: 1.5,
    recommended: false,
  },
  {
    modelId: 'moonshot-v1-32k',
    family: 'moonshot',
    taskScores: {
      payment_verification: { detection: 0.264, fpRate: 0.008, benchmarkVersion: 'v3b' },
    },
    weight: 0.75,
    recommended: false,
  },
  {
    modelId: 'moonshot-v1-8k',
    family: 'moonshot',
    taskScores: {
      // 8k variant was too weak for structured JSON — treat as unreliable
      payment_verification: { detection: 0.0, fpRate: 0.0, benchmarkVersion: 'v3-failed' },
    },
    weight: 0.1,
    recommended: false,
  },
];

/**
 * Look up a verifier profile by model ID.
 * Returns undefined if model is not in the benchmark database.
 */
export function getProfile(modelId: string): VerifierProfile | undefined {
  return VERIFIER_PROFILES.find(
    (p) => p.modelId.toLowerCase() === modelId.toLowerCase()
  );
}

/**
 * Returns all profiles marked as recommended (detection >= 0.70).
 */
export function getRecommendedVerifiers(): VerifierProfile[] {
  return VERIFIER_PROFILES.filter((p) => p.recommended);
}

/**
 * Checks whether the provided model IDs include at least one high-performance verifier.
 * Returns a warning string if none found, null if OK.
 *
 * @example
 * const warn = warnIfNoHighPerformanceVerifier(['moonshot-v1-32k', 'grok-4-1-fast']);
 * // → "No high-performance verifier detected for payment_verification. ..."
 */
export function warnIfNoHighPerformanceVerifier(modelIds: string[]): string | null {
  const lowerIds = modelIds.map((id) => id.toLowerCase());
  const hasRecommended = VERIFIER_PROFILES.some(
    (p) => p.recommended && lowerIds.includes(p.modelId.toLowerCase())
  );
  if (hasRecommended) return null;

  const recommended = getRecommendedVerifiers().map((p) => p.modelId).join(', ');
  return (
    `No high-performance verifier detected for payment_verification. ` +
    `Current setup may miss ~50%+ of adversarial chains. ` +
    `Recommended verifiers: ${recommended}. ` +
    `See https://thoughtproof.ai/docs/benchmarks for details.`
  );
}

/**
 * Get the consensus weight for a model ID.
 * Falls back to 1.0 (neutral) for unknown models.
 */
export function getWeight(modelId: string): number {
  return getProfile(modelId)?.weight ?? 1.0;
}
