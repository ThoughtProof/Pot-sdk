/**
 * Trust Decay Engine
 * 
 * Trust is transitive but decays per hop. Below threshold → independent verification required.
 * Floor/ceiling with consumer-determined range (thoth-ix design).
 * Stake-weighted: higher failure cost = narrower corridor.
 * 
 * @example
 * const result = computeTransitiveTrust({
 *   baseTrust: 0.95,
 *   decayPerHop: 0.90,
 *   floor: 0.30,
 *   ceiling: 0.95,
 *   consumerThreshold: 0.70,
 *   failureCost: 'high',
 * }, ['agentA', 'agentB', 'agentC']);
 */

import type { TrustDecayConfig, TrustDecayResult, FailureCostLevel } from './types.js';

/**
 * Failure cost narrows the floor/ceiling corridor.
 * Higher stakes = tighter range = less tolerance for transitive trust.
 */
const FAILURE_COST_MULTIPLIERS: Record<FailureCostLevel, number> = {
  low: 1.0,       // Full corridor
  medium: 0.75,   // 75% of corridor
  high: 0.50,     // 50% of corridor
  critical: 0.25, // 25% of corridor — almost requires direct trust
};

/**
 * Compute transitive trust across a chain of agents.
 * 
 * Trust decays multiplicatively per hop:
 *   trust_n = baseTrust * (decayPerHop ^ n)
 * 
 * The effective corridor is narrowed by failure cost:
 *   effectiveFloor = ceiling - (ceiling - floor) * multiplier
 * 
 * @param config - Decay configuration
 * @param path - Array of agent IDs representing the trust chain (min 2)
 * @returns Trust decay result with recommendation
 */
export function computeTransitiveTrust(
  config: TrustDecayConfig,
  path: string[]
): TrustDecayResult {
  const {
    baseTrust,
    decayPerHop,
    floor,
    ceiling,
    consumerThreshold,
    failureCost,
  } = config;

  if (path.length < 2) {
    return {
      trust: baseTrust,
      hops: 0,
      requiresIndependentVerification: false,
      effectiveThreshold: consumerThreshold,
      path,
    };
  }

  const hops = path.length - 1;

  // Multiplicative decay: trust = base * decay^hops
  const rawTrust = baseTrust * Math.pow(decayPerHop, hops);

  // Apply floor/ceiling
  const multiplier = FAILURE_COST_MULTIPLIERS[failureCost];

  // Narrow the corridor based on failure cost
  // High failure cost → floor rises toward ceiling (stricter)
  const effectiveFloor = ceiling - (ceiling - floor) * multiplier;
  const clampedTrust = Math.max(effectiveFloor, Math.min(ceiling, rawTrust));

  // Consumer threshold also adjusted by failure cost
  // Higher stakes → threshold moves up within the corridor
  const corridorRange = ceiling - effectiveFloor;
  const thresholdPosition = (consumerThreshold - floor) / (ceiling - floor);
  const effectiveThreshold = effectiveFloor + corridorRange * thresholdPosition;

  const requiresIndependentVerification = clampedTrust < effectiveThreshold;

  return {
    trust: Math.round(clampedTrust * 1000) / 1000,
    hops,
    requiresIndependentVerification,
    effectiveThreshold: Math.round(effectiveThreshold * 1000) / 1000,
    path,
  };
}

/**
 * Compute trust between two agents via multiple possible paths.
 * Returns the path with highest trust (best route).
 */
export function findBestTrustPath(
  config: Omit<TrustDecayConfig, 'baseTrust'>,
  paths: Array<{ path: string[]; baseTrust: number }>
): TrustDecayResult | null {
  if (paths.length === 0) return null;

  let best: TrustDecayResult | null = null;

  for (const { path, baseTrust } of paths) {
    const result = computeTransitiveTrust({ ...config, baseTrust }, path);
    if (!best || result.trust > best.trust) {
      best = result;
    }
  }

  return best;
}

/**
 * Quick check: would trust survive N hops at given config?
 * Useful for pre-flight checks before expensive verification.
 */
export function wouldTrustSurvive(
  baseTrust: number,
  decayPerHop: number,
  hops: number,
  minThreshold: number
): boolean {
  return baseTrust * Math.pow(decayPerHop, hops) >= minThreshold;
}
