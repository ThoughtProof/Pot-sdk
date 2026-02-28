import type { GraphEdge, GraphConsistencyResult, GraphContradiction } from './types.js';
import type { GraphStore } from './graph-store.js';

/**
 * Check whether a set of new edges are consistent with the existing graph.
 * Detects direct contradictions (A --[rel]--> B vs A --[NOT rel]--> B).
 */
export function checkConsistency(
  store: GraphStore,
  newEdges: GraphEdge[]
): GraphConsistencyResult {
  const graph = store.getGraph();
  const existingEdges = graph.edges;
  const contradictions: GraphContradiction[] = [];

  for (const newEdge of newEdges) {
    for (const existing of existingEdges) {
      // Direct negation contradiction: same from+relation, different polarity
      if (
        existing.from === newEdge.from &&
        existing.relation === newEdge.relation &&
        !!existing.negated !== !!newEdge.negated
      ) {
        const severity: GraphContradiction['severity'] =
          existing.to === newEdge.to ? 'critical' : 'moderate';

        contradictions.push({
          nodeA: existing.to,
          nodeB: newEdge.to,
          relation: newEdge.relation,
          explanation: `"${newEdge.from}" --[${existing.negated ? 'NOT ' : ''}${existing.relation}]--> "${existing.to}" contradicts new claim "${newEdge.from}" --[${newEdge.negated ? 'NOT ' : ''}${newEdge.relation}]--> "${newEdge.to}"`,
          severity,
        });
      }
    }
  }

  // Also surface any existing contradictions already in the graph
  const graphContradictions = store.findContradictions();
  const allContradictions = [...graphContradictions, ...contradictions];

  const score = Math.max(0, 1.0 - allContradictions.length * 0.2);

  return {
    isConsistent: contradictions.length === 0,
    contradictions: allContradictions,
    orphanNodes: store.findOrphans(),
    cycles: store.findCycles(),
    consistencyScore: score,
  };
}
