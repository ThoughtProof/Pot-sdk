export interface GraphNode {
  id: string;
  label: string;
  type: 'entity' | 'claim' | 'fact';
  confidence: number;
  source?: string; // which claim/document introduced this node
}

export interface GraphEdge {
  id: string;
  from: string;     // node id
  to: string;       // node id
  relation: string; // e.g., "developed_by", "contradicts", "supports", "causes"
  confidence: number;
  negated?: boolean; // "GPT-4 was NOT developed by Meta"
}

export interface KnowledgeGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface GraphConsistencyResult {
  isConsistent: boolean;
  contradictions: GraphContradiction[];
  orphanNodes: string[];    // node ids with no edges (unsupported claims)
  cycles: string[][];       // arrays of node ids forming cycles
  consistencyScore: number; // 0-1
}

export interface GraphContradiction {
  nodeA: string;
  nodeB: string;
  relation: string;
  explanation: string;
  severity: 'critical' | 'moderate' | 'minor';
}

export interface GraphCriticOptions {
  graph?: KnowledgeGraph;     // existing graph to check against (optional)
  extractRelations?: boolean; // extract relations from claim via LLM (default: true)
  checkCycles?: boolean;      // detect logical cycles (default: true)
  maxNodes?: number;          // cap graph size (default: 200)
}

export interface GraphCriticResult {
  critique: string;
  consistency: GraphConsistencyResult;
  updatedGraph: KnowledgeGraph; // graph with new nodes/edges added
  newNodes: number;
  newEdges: number;
}
