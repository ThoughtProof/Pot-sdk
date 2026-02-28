import { describe, it, expect, vi } from 'vitest';
import { GraphStore } from '../src/graph-store.js';
import { checkConsistency } from '../src/consistency.js';
import { analyzeTopology } from '../src/topology.js';
import { runGraphCritic } from '../src/graph-critic.js';
import type { GraphNode, GraphEdge } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function node(id: string, type: GraphNode['type'] = 'entity'): GraphNode {
  return { id, label: id, type, confidence: 0.9 };
}

function edge(
  from: string,
  to: string,
  relation: string,
  negated = false
): GraphEdge {
  return {
    id: `${from}_${relation}_${to}`,
    from,
    to,
    relation,
    confidence: 0.9,
    negated,
  };
}

// ── GraphStore ────────────────────────────────────────────────────────────────

describe('GraphStore', () => {
  it('addNode: stores node, ignores duplicates', () => {
    const store = new GraphStore();
    store.addNode(node('gpt4'));
    store.addNode(node('gpt4')); // duplicate
    expect(store.getGraph().nodes.size).toBe(1);
    expect(store.getNode('gpt4')?.id).toBe('gpt4');
  });

  it('addEdge: stores edge, ignores duplicates', () => {
    const store = new GraphStore();
    store.addNode(node('gpt4'));
    store.addNode(node('openai'));
    const e = edge('gpt4', 'openai', 'developed_by');
    store.addEdge(e);
    store.addEdge(e); // duplicate
    expect(store.getGraph().edges.length).toBe(1);
  });

  it('getEdges: returns edges for node id', () => {
    const store = new GraphStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addNode(node('c'));
    store.addEdge(edge('a', 'b', 'causes'));
    store.addEdge(edge('c', 'a', 'supports'));
    const edgesA = store.getEdges('a');
    expect(edgesA.length).toBe(2);
  });

  it('findContradictions: detects negation contradiction', () => {
    const store = new GraphStore();
    store.addNode(node('gpt4'));
    store.addNode(node('openai'));
    store.addNode(node('meta'));
    store.addEdge(edge('gpt4', 'openai', 'developed_by', false));
    store.addEdge(edge('gpt4', 'openai', 'developed_by', true)); // NOT developed_by
    const contradictions = store.findContradictions();
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0].relation).toBe('developed_by');
  });

  it('findCycles: detects a simple A→B→A cycle', () => {
    const store = new GraphStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addEdge(edge('a', 'b', 'causes'));
    store.addEdge(edge('b', 'a', 'causes'));
    const cycles = store.findCycles();
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('findCycles: no cycles in DAG', () => {
    const store = new GraphStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addNode(node('c'));
    store.addEdge(edge('a', 'b', 'causes'));
    store.addEdge(edge('b', 'c', 'causes'));
    const cycles = store.findCycles();
    expect(cycles.length).toBe(0);
  });

  it('findOrphans: identifies nodes with no edges', () => {
    const store = new GraphStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addNode(node('orphan'));
    store.addEdge(edge('a', 'b', 'causes'));
    const orphans = store.findOrphans();
    expect(orphans).toContain('orphan');
    expect(orphans).not.toContain('a');
    expect(orphans).not.toContain('b');
  });

  it('toJSON / fromJSON roundtrip', () => {
    const store = new GraphStore();
    store.addNode(node('gpt4'));
    store.addNode(node('openai'));
    store.addEdge(edge('gpt4', 'openai', 'developed_by'));
    const json = store.toJSON();
    const restored = GraphStore.fromJSON(json);
    expect(restored.getNode('gpt4')?.id).toBe('gpt4');
    expect(restored.getGraph().edges.length).toBe(1);
    expect(restored.getGraph().edges[0].relation).toBe('developed_by');
  });

  it('constructor from existing KnowledgeGraph', () => {
    const store = new GraphStore();
    store.addNode(node('x'));
    const existing = store.getGraph();
    const store2 = new GraphStore(existing);
    store2.addNode(node('y'));
    // Original should not be mutated
    expect(store.getGraph().nodes.size).toBe(1);
    expect(store2.getGraph().nodes.size).toBe(2);
  });
});

// ── checkConsistency ──────────────────────────────────────────────────────────

describe('checkConsistency', () => {
  it('returns isConsistent=true when no contradictions', () => {
    const store = new GraphStore();
    store.addNode(node('gpt4'));
    store.addNode(node('openai'));
    store.addEdge(edge('gpt4', 'openai', 'developed_by'));
    const newEdges: GraphEdge[] = [edge('gpt4', 'openai', 'funded_by')];
    const result = checkConsistency(store, newEdges);
    expect(result.isConsistent).toBe(true);
  });

  it('detects direct negation contradiction', () => {
    const store = new GraphStore();
    store.addNode(node('gpt4'));
    store.addNode(node('openai'));
    store.addEdge(edge('gpt4', 'openai', 'developed_by', false));
    // New claim: GPT-4 was NOT developed by OpenAI
    const newEdges: GraphEdge[] = [edge('gpt4', 'openai', 'developed_by', true)];
    const result = checkConsistency(store, newEdges);
    expect(result.isConsistent).toBe(false);
    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  it('consistencyScore is 1.0 when no contradictions', () => {
    const store = new GraphStore();
    const result = checkConsistency(store, []);
    expect(result.consistencyScore).toBe(1.0);
  });

  it('consistencyScore decreases with contradictions', () => {
    const store = new GraphStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addEdge(edge('a', 'b', 'causes', false));
    const newEdges: GraphEdge[] = [edge('a', 'b', 'causes', true)];
    const result = checkConsistency(store, newEdges);
    expect(result.consistencyScore).toBeLessThan(1.0);
  });
});

// ── analyzeTopology ───────────────────────────────────────────────────────────

describe('analyzeTopology', () => {
  it('density is 0 for empty graph', () => {
    const store = new GraphStore();
    const result = analyzeTopology(store);
    expect(result.density).toBe(0);
  });

  it('density correct for simple graph', () => {
    const store = new GraphStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addNode(node('c'));
    store.addEdge(edge('a', 'b', 'causes'));
    // 3 nodes → max possible edges: 3*2=6; actual: 1
    const result = analyzeTopology(store);
    expect(result.density).toBeCloseTo(1 / 6, 3);
  });

  it('componentCount: isolated nodes are separate components', () => {
    const store = new GraphStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addNode(node('c'));
    store.addEdge(edge('a', 'b', 'causes'));
    // a-b connected, c isolated → 2 components
    const result = analyzeTopology(store);
    expect(result.componentCount).toBe(2);
  });

  it('componentCount: fully connected = 1 component', () => {
    const store = new GraphStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addNode(node('c'));
    store.addEdge(edge('a', 'b', 'causes'));
    store.addEdge(edge('b', 'c', 'causes'));
    const result = analyzeTopology(store);
    expect(result.componentCount).toBe(1);
  });

  it('returns orphans in topology result', () => {
    const store = new GraphStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addNode(node('orphan'));
    store.addEdge(edge('a', 'b', 'rel'));
    const result = analyzeTopology(store);
    expect(result.orphans).toContain('orphan');
  });
});

// ── runGraphCritic ────────────────────────────────────────────────────────────

describe('runGraphCritic', () => {
  it('returns correct shape with extractRelations=false', async () => {
    const result = await runGraphCritic(
      null,
      'test-model',
      'GPT-4 was developed by OpenAI in 2023.',
      { extractRelations: false }
    );
    expect(result).toHaveProperty('critique');
    expect(result).toHaveProperty('consistency');
    expect(result).toHaveProperty('updatedGraph');
    expect(typeof result.newNodes).toBe('number');
    expect(typeof result.newEdges).toBe('number');
    expect(result.consistency).toHaveProperty('isConsistent');
    expect(result.consistency).toHaveProperty('consistencyScore');
    expect(result.consistency).toHaveProperty('contradictions');
    expect(result.consistency).toHaveProperty('cycles');
    expect(result.consistency).toHaveProperty('orphanNodes');
  });

  it('no extraction → 0 new nodes/edges', async () => {
    const result = await runGraphCritic(
      null,
      'any',
      'Some claim.',
      { extractRelations: false }
    );
    expect(result.newNodes).toBe(0);
    expect(result.newEdges).toBe(0);
  });

  it('uses mocked LLM extractor to populate graph', async () => {
    const mockProvider = vi.fn().mockResolvedValue(JSON.stringify({
      nodes: [
        { id: 'gpt4', label: 'GPT-4', type: 'entity', confidence: 0.95 },
        { id: 'openai', label: 'OpenAI', type: 'entity', confidence: 0.95 },
      ],
      edges: [
        { from: 'gpt4', to: 'openai', relation: 'developed_by', confidence: 0.95, negated: false },
      ],
    }));

    const result = await runGraphCritic(
      mockProvider,
      'mock-model',
      'GPT-4 was developed by OpenAI.',
      { extractRelations: true }
    );

    expect(result.newNodes).toBe(2);
    expect(result.newEdges).toBe(1);
    expect(result.updatedGraph.nodes.size).toBe(2);
    expect(result.updatedGraph.edges.length).toBe(1);
    expect(result.critique).toContain('✅');
  });

  it('detects contradiction via mocked extractor against existing graph', async () => {
    // Pre-populate graph: GPT-4 developed_by OpenAI
    const existingStore = new GraphStore();
    existingStore.addNode({ id: 'gpt4', label: 'GPT-4', type: 'entity', confidence: 1 });
    existingStore.addNode({ id: 'openai', label: 'OpenAI', type: 'entity', confidence: 1 });
    existingStore.addEdge({
      id: 'e1',
      from: 'gpt4',
      to: 'openai',
      relation: 'developed_by',
      confidence: 1,
      negated: false,
    });
    const existingGraph = existingStore.getGraph();

    // Contradicting claim: GPT-4 was NOT developed by OpenAI
    const mockProvider = vi.fn().mockResolvedValue(JSON.stringify({
      nodes: [
        { id: 'gpt4', label: 'GPT-4', type: 'entity', confidence: 0.9 },
        { id: 'openai', label: 'OpenAI', type: 'entity', confidence: 0.9 },
      ],
      edges: [
        { from: 'gpt4', to: 'openai', relation: 'developed_by', confidence: 0.9, negated: true },
      ],
    }));

    const result = await runGraphCritic(
      mockProvider,
      'mock-model',
      'GPT-4 was NOT developed by OpenAI.',
      { graph: existingGraph, extractRelations: true }
    );

    expect(result.consistency.isConsistent).toBe(false);
    expect(result.consistency.contradictions.length).toBeGreaterThan(0);
    expect(result.critique).toContain('⚠️');
  });

  it('respects maxNodes cap', async () => {
    const mockProvider = vi.fn().mockResolvedValue(JSON.stringify({
      nodes: [
        { id: 'n1', label: 'N1', type: 'entity', confidence: 0.9 },
        { id: 'n2', label: 'N2', type: 'entity', confidence: 0.9 },
        { id: 'n3', label: 'N3', type: 'entity', confidence: 0.9 },
      ],
      edges: [],
    }));

    const result = await runGraphCritic(
      mockProvider,
      'mock-model',
      'Some text.',
      { maxNodes: 2, extractRelations: true }
    );

    expect(result.updatedGraph.nodes.size).toBeLessThanOrEqual(2);
    expect(result.newNodes).toBeLessThanOrEqual(2);
  });
});
