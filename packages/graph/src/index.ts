/**
 * @pot-sdk2/graph — The Graph
 * Structural knowledge-graph verification for pot-sdk.
 * "The graph doesn't lie."
 */

export { GraphStore } from './graph-store.js';
export { extractGraphElements } from './extractor.js';
export { checkConsistency } from './consistency.js';
export { analyzeTopology } from './topology.js';
export { runGraphCritic } from './graph-critic.js';

export type {
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  GraphConsistencyResult,
  GraphContradiction,
  GraphCriticOptions,
  GraphCriticResult,
} from './types.js';

export type { TopologyResult } from './topology.js';
