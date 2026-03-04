/**
 * Grace-Period Revocation
 * 
 * When an agent is compromised:
 * - Trust score drops to 0 immediately for NEW verifications
 * - Existing attestations get a grace window for re-verification
 * - Blast radius computed via graph traversal
 * 
 * Analogy: TLS certificate revocation (CRL → OCSP → OCSP stapling)
 * Our approach: revocation with grace period = pragmatic middle ground
 */

import type {
  RevocationEvent,
  RevocationTier,
  BlastRadiusResult,
  TrustEdge,
  AgentTrustProfile,
} from './types.js';

/**
 * Grace period hours by revocation tier.
 */
const GRACE_PERIODS: Record<RevocationTier, number> = {
  immediate: 0,   // Zero tolerance — critical compromise
  notify: 24,     // 24h grace — consumers notified, can re-verify
  expire: 72,     // 72h grace — low severity, gradual expiry
};

/**
 * Compute the blast radius of a compromised agent.
 * Traces all trust paths through the compromised node.
 * 
 * @param compromisedAgent - ID of the compromised agent
 * @param edges - All trust edges in the network
 * @param agents - All agent profiles
 * @param maxDepth - Maximum depth to traverse (default: 10)
 */
export function computeBlastRadius(
  compromisedAgent: string,
  edges: TrustEdge[],
  agents: Map<string, AgentTrustProfile>,
  maxDepth = 10
): BlastRadiusResult {
  const affectedAgents = new Set<string>();
  const affectedAttestations = new Set<string>();

  // BFS from the compromised agent
  const queue: Array<{ agentId: string; depth: number }> = [{ agentId: compromisedAgent, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { agentId, depth } = queue.shift()!;
    if (visited.has(agentId) || depth > maxDepth) continue;
    visited.add(agentId);

    // Find all agents that trust this agent (incoming edges)
    const trusters = edges.filter(e => e.to === agentId);
    for (const edge of trusters) {
      affectedAgents.add(edge.from);
      // Each edge represents verifications that may be tainted
      affectedAttestations.add(`${edge.from}→${edge.to}:${edge.lastVerified}`);
      queue.push({ agentId: edge.from, depth: depth + 1 });
    }
  }

  return {
    compromisedAgent,
    affectedAgents: Array.from(affectedAgents),
    affectedAttestations: Array.from(affectedAttestations),
    maxDepth: Math.max(0, ...Array.from(visited).map(() => 0), visited.size - 1),
  };
}

/**
 * Create a revocation event for a compromised agent.
 * Automatically determines tier based on severity and computes blast radius.
 */
export function createRevocationEvent(
  agentId: string,
  reason: string,
  tier: RevocationTier,
  edges: TrustEdge[],
  agents: Map<string, AgentTrustProfile>
): RevocationEvent {
  const blastRadius = computeBlastRadius(agentId, edges, agents);

  return {
    agentId,
    reason,
    tier,
    gracePeriodHours: GRACE_PERIODS[tier],
    affectedAttestations: blastRadius.affectedAttestations,
    affectedAgents: blastRadius.affectedAgents,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Determine appropriate revocation tier based on anomaly severity.
 */
export function determineRevocationTier(
  sigmaDeviation: number,
  sigmaThreshold: number
): RevocationTier {
  if (sigmaDeviation > sigmaThreshold * 2) return 'immediate';
  if (sigmaDeviation > sigmaThreshold * 1.5) return 'notify';
  return 'expire';
}
