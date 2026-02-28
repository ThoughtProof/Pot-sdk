import { GraphStore } from './graph-store.js';
import { extractGraphElements } from './extractor.js';
import { checkConsistency } from './consistency.js';
import { analyzeTopology, type TopologyResult } from './topology.js';
import type {
  GraphCriticOptions,
  GraphCriticResult,
  GraphConsistencyResult,
} from './types.js';

function buildGraphCritique(
  consistency: GraphConsistencyResult,
  topology: TopologyResult,
  claim: string
): string {
  const lines: string[] = [];

  if (consistency.isConsistent && consistency.contradictions.length === 0) {
    lines.push(`✅ Graph-consistent: No structural contradictions detected for claim.`);
  } else {
    lines.push(`⚠️ Graph inconsistency detected (score: ${(consistency.consistencyScore * 100).toFixed(0)}%):`);
    for (const c of consistency.contradictions) {
      lines.push(`  [${c.severity.toUpperCase()}] ${c.explanation}`);
    }
  }

  if (topology.cycles.length > 0) {
    lines.push(`\n🔄 Logical cycles detected (${topology.cycles.length}):`);
    for (const cycle of topology.cycles) {
      lines.push(`  → ${cycle.join(' → ')} → ${cycle[0]}`);
    }
    lines.push(`  Cycles may indicate circular reasoning or contradictory causality.`);
  }

  if (topology.orphans.length > 0) {
    lines.push(`\n🔍 Unsupported claims (orphan nodes, ${topology.orphans.length}):`);
    lines.push(`  ${topology.orphans.join(', ')}`);
    lines.push(`  These entities have no established relationships — claims may be ungrounded.`);
  }

  lines.push(`\n📊 Graph stats: ${topology.componentCount} component(s), density ${(topology.density * 100).toFixed(1)}%`);

  return lines.join('\n');
}

/**
 * The graph doesn't lie — structural contradictions are harder to hallucinate away.
 *
 * Runs a graph-aware critic on a claim: extracts entities and relationships via LLM,
 * checks them against an existing knowledge graph, and returns a structural critique.
 */
export async function runGraphCritic(
  provider: any,
  model: string,
  claim: string,
  options: GraphCriticOptions = {},
  lang: 'en' | 'de' = 'en'
): Promise<GraphCriticResult> {
  const store = new GraphStore(options.graph);
  const maxNodes = options.maxNodes ?? 200;
  const shouldExtract = options.extractRelations !== false;

  let newNodeCount = 0;
  let newEdgeCount = 0;
  let extractedNodes: Awaited<ReturnType<typeof extractGraphElements>>['nodes'] = [];
  let extractedEdges: Awaited<ReturnType<typeof extractGraphElements>>['edges'] = [];

  if (shouldExtract) {
    const extracted = await extractGraphElements(provider, model, claim, lang);
    extractedNodes = extracted.nodes;
    extractedEdges = extracted.edges;

    // Respect maxNodes cap
    const currentCount = store.getGraph().nodes.size;
    const slotsLeft = maxNodes - currentCount;
    const nodesToAdd = extractedNodes.slice(0, Math.max(0, slotsLeft));

    for (const node of nodesToAdd) {
      store.addNode(node);
      newNodeCount++;
    }
  }

  // Check consistency before adding new edges
  const consistency = checkConsistency(store, extractedEdges);

  // Add edges
  for (const edge of extractedEdges) {
    store.addEdge(edge);
    newEdgeCount++;
  }

  // Topology analysis
  const topology = analyzeTopology(store);

  // Merge cycles from topology into consistency result
  const fullConsistency: GraphConsistencyResult = {
    ...consistency,
    cycles: options.checkCycles !== false ? topology.cycles : [],
    orphanNodes: topology.orphans,
  };

  const critique = buildGraphCritique(fullConsistency, topology, claim);

  return {
    critique,
    consistency: fullConsistency,
    updatedGraph: store.getGraph(),
    newNodes: newNodeCount,
    newEdges: newEdgeCount,
  };
}
