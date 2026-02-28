import type { GraphNode, GraphEdge } from './types.js';

const EXTRACTION_PROMPT_EN = `Extract entities and relationships from the following text.
Return ONLY a valid JSON object with this structure:
{
  "nodes": [
    { "id": "string (short slug)", "label": "string", "type": "entity|claim|fact", "confidence": 0.0-1.0 }
  ],
  "edges": [
    { "from": "node_id", "to": "node_id", "relation": "relation_type", "confidence": 0.0-1.0, "negated": false }
  ]
}
Rules:
- node ids: lowercase, underscored slugs (e.g., "gpt_4", "openai")
- relation types: snake_case verbs (e.g., "developed_by", "released_in", "causes", "contradicts", "supports")
- negated: true only if the text explicitly negates the relationship
- confidence: your certainty this relationship exists in the text
TEXT: `;

const EXTRACTION_PROMPT_DE = `Extrahiere Entitäten und Beziehungen aus dem folgenden Text.
Gib NUR ein gültiges JSON-Objekt mit dieser Struktur zurück:
{
  "nodes": [
    { "id": "string (kurzer Slug)", "label": "string", "type": "entity|claim|fact", "confidence": 0.0-1.0 }
  ],
  "edges": [
    { "from": "node_id", "to": "node_id", "relation": "relationstyp", "confidence": 0.0-1.0, "negated": false }
  ]
}
TEXT: `;

interface ExtractedData {
  nodes: Array<Omit<GraphNode, 'id'> & { id: string }>;
  edges: Array<{
    from: string;
    to: string;
    relation: string;
    confidence: number;
    negated?: boolean;
  }>;
}

function sanitizeExtracted(raw: ExtractedData): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = (raw.nodes ?? []).map((n, i) => ({
    id: String(n.id ?? `node_${i}`).toLowerCase().replace(/\s+/g, '_'),
    label: String(n.label ?? n.id ?? `Node ${i}`),
    type: (['entity', 'claim', 'fact'].includes(n.type) ? n.type : 'entity') as GraphNode['type'],
    confidence: Math.min(1, Math.max(0, Number(n.confidence ?? 0.8))),
    source: n.source,
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges: GraphEdge[] = (raw.edges ?? [])
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e, i) => ({
      id: `edge_${i}_${e.from}_${e.relation}_${e.to}`,
      from: e.from,
      to: e.to,
      relation: String(e.relation ?? 'related_to').toLowerCase().replace(/\s+/g, '_'),
      confidence: Math.min(1, Math.max(0, Number(e.confidence ?? 0.8))),
      negated: Boolean(e.negated),
    }));

  return { nodes, edges };
}

/**
 * Extract graph elements (nodes + edges) from text via LLM.
 */
export async function extractGraphElements(
  provider: any,
  model: string,
  text: string,
  lang: 'en' | 'de' = 'en'
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const prompt = (lang === 'de' ? EXTRACTION_PROMPT_DE : EXTRACTION_PROMPT_EN) + text;

  let responseText: string;

  try {
    // Support common provider shapes (OpenAI-compatible, Anthropic, raw function)
    if (typeof provider === 'function') {
      responseText = await provider(model, prompt);
    } else if (provider?.chat?.completions?.create) {
      // OpenAI-style
      const res = await provider.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      });
      responseText = res.choices[0]?.message?.content ?? '{}';
    } else if (provider?.messages?.create) {
      // Anthropic-style
      const res = await provider.messages.create({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      responseText = res.content[0]?.text ?? '{}';
    } else {
      throw new Error('Unsupported provider shape');
    }
  } catch (err) {
    // Fallback: return empty graph on extraction failure
    return { nodes: [], edges: [] };
  }

  // Extract JSON from response (may be wrapped in markdown code blocks)
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ??
    responseText.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1] : responseText;

  try {
    const parsed: ExtractedData = JSON.parse(jsonStr.trim());
    return sanitizeExtracted(parsed);
  } catch {
    return { nodes: [], edges: [] };
  }
}
