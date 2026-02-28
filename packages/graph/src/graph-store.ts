import type {
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  GraphContradiction,
} from './types.js';

interface SerializedGraph {
  nodes: [string, GraphNode][];
  edges: GraphEdge[];
  createdAt: number;
  updatedAt: number;
}

export class GraphStore {
  private graph: KnowledgeGraph;

  constructor(existing?: KnowledgeGraph) {
    if (existing) {
      // Deep-clone to avoid mutation
      this.graph = {
        nodes: new Map(existing.nodes),
        edges: [...existing.edges],
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    } else {
      this.graph = {
        nodes: new Map(),
        edges: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
  }

  addNode(node: GraphNode): void {
    if (!this.graph.nodes.has(node.id)) {
      this.graph.nodes.set(node.id, node);
      this.graph.updatedAt = Date.now();
    }
  }

  addEdge(edge: GraphEdge): void {
    // Avoid duplicate edges (same from/to/relation/negated)
    const exists = this.graph.edges.some(
      (e) =>
        e.from === edge.from &&
        e.to === edge.to &&
        e.relation === edge.relation &&
        !!e.negated === !!edge.negated
    );
    if (!exists) {
      this.graph.edges.push(edge);
      this.graph.updatedAt = Date.now();
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.graph.nodes.get(id);
  }

  getEdges(nodeId: string): GraphEdge[] {
    return this.graph.edges.filter(
      (e) => e.from === nodeId || e.to === nodeId
    );
  }

  getGraph(): KnowledgeGraph {
    return this.graph;
  }

  /**
   * Find contradictions: edges that share the same (from, relation) but differ in `negated` flag
   * or point to different targets with opposite polarity.
   */
  findContradictions(): GraphContradiction[] {
    const contradictions: GraphContradiction[] = [];

    for (let i = 0; i < this.graph.edges.length; i++) {
      for (let j = i + 1; j < this.graph.edges.length; j++) {
        const a = this.graph.edges[i];
        const b = this.graph.edges[j];

        // Same from node, same relation, one negated and one not
        if (
          a.from === b.from &&
          a.relation === b.relation &&
          !!a.negated !== !!b.negated
        ) {
          contradictions.push({
            nodeA: a.to,
            nodeB: b.to,
            relation: a.relation,
            explanation: `Contradiction: "${a.from}" --[${a.relation}]--> "${a.to}" conflicts with "${b.from}" --[NOT ${b.relation}]--> "${b.to}"`,
            severity: 'critical',
          });
        }

        // Same from, same relation, but different targets (fork contradiction)
        if (
          a.from === b.from &&
          a.relation === b.relation &&
          a.to !== b.to &&
          !!a.negated === !!b.negated
        ) {
          contradictions.push({
            nodeA: a.to,
            nodeB: b.to,
            relation: a.relation,
            explanation: `Ambiguous: "${a.from}" --[${a.relation}]--> "${a.to}" AND "${a.from}" --[${a.relation}]--> "${b.to}"`,
            severity: 'moderate',
          });
        }
      }
    }

    return contradictions;
  }

  /** Find cycles using iterative DFS */
  findCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const adjacency = new Map<string, string[]>();
    for (const edge of this.graph.edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from)!.push(edge.to);
    }

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      for (const neighbor of adjacency.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, path);
        } else if (recStack.has(neighbor)) {
          // Found a cycle — extract it
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart !== -1) {
            cycles.push(path.slice(cycleStart));
          }
        }
      }

      path.pop();
      recStack.delete(node);
    };

    for (const nodeId of this.graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, []);
      }
    }

    return cycles;
  }

  /** Find nodes with no edges (unsupported / orphan claims) */
  findOrphans(): string[] {
    const connectedNodes = new Set<string>();
    for (const edge of this.graph.edges) {
      connectedNodes.add(edge.from);
      connectedNodes.add(edge.to);
    }
    return Array.from(this.graph.nodes.keys()).filter(
      (id) => !connectedNodes.has(id)
    );
  }

  toJSON(): string {
    const serializable: SerializedGraph = {
      nodes: Array.from(this.graph.nodes.entries()),
      edges: this.graph.edges,
      createdAt: this.graph.createdAt,
      updatedAt: this.graph.updatedAt,
    };
    return JSON.stringify(serializable, null, 2);
  }

  static fromJSON(json: string): GraphStore {
    const parsed: SerializedGraph = JSON.parse(json);
    const graph: KnowledgeGraph = {
      nodes: new Map(parsed.nodes),
      edges: parsed.edges,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
    return new GraphStore(graph);
  }
}
