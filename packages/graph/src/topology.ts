import type { GraphStore } from './graph-store.js';

export interface TopologyResult {
  cycles: string[][];
  orphans: string[];
  density: number;        // edges / possible edges
  componentCount: number; // disconnected subgraphs
}

/**
 * Analyze the topological structure of the knowledge graph.
 */
export function analyzeTopology(store: GraphStore): TopologyResult {
  const graph = store.getGraph();
  const nodeCount = graph.nodes.size;
  const edgeCount = graph.edges.length;

  const cycles = store.findCycles();
  const orphans = store.findOrphans();

  // Density: edges / max possible directed edges (n * (n-1))
  const maxEdges = nodeCount > 1 ? nodeCount * (nodeCount - 1) : 0;
  const density = maxEdges > 0 ? edgeCount / maxEdges : 0;

  // Count connected components (undirected) using union-find
  const parent = new Map<string, string>();

  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) {
      parent.set(x, find(parent.get(x)!));
    }
    return parent.get(x)!;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Initialize all nodes
  for (const nodeId of graph.nodes.keys()) {
    find(nodeId);
  }

  // Union connected nodes
  for (const edge of graph.edges) {
    union(edge.from, edge.to);
  }

  // Count unique roots
  const roots = new Set<string>();
  for (const nodeId of graph.nodes.keys()) {
    roots.add(find(nodeId));
  }

  return {
    cycles,
    orphans,
    density: Math.round(density * 10000) / 10000,
    componentCount: roots.size,
  };
}
