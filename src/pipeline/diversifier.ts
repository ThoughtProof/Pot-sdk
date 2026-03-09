/**
 * Input Representation Diversifier — different verifiers see different views.
 *
 * Instead of sending the same raw claim to all generators, we create
 * structurally different representations of the same content.
 *
 * An injection crafted for representation A (raw text) may not work
 * against representation C (structured claims) or D (devil's advocate).
 *
 * Representations:
 * 1. **original** — the claim as-is (baseline)
 * 2. **factual-core** — stripped to bare factual assertions, no elaboration
 * 3. **skeptical** — reformulated as a skeptical question ("Is it really true that...?")
 * 4. **structured** — decomposed into numbered atomic claims
 * 5. **inverted** — the opposite claim, asking the generator to evaluate it
 *
 * Each is a pure text transformation (no LLM call, zero cost, injection-resistant).
 *
 * Credit: voipbin-cco (Moltbook) — "running them on different data snapshots
 * so that injecting one cannot influence the other"
 *
 * @since v1.1.0
 */

export type RepresentationType = 'original' | 'factual-core' | 'skeptical' | 'structured' | 'inverted';

export interface DiversifiedInput {
  /** The representation type */
  type: RepresentationType;
  /** The transformed claim text */
  content: string;
}

/**
 * Strip elaboration: remove hedging, qualifiers, parentheticals, and filler.
 * Keep only the core factual assertions.
 */
function toFactualCore(claim: string): string {
  let core = claim
    // Remove parentheticals
    .replace(/\([^)]*\)/g, '')
    // Remove common hedging phrases
    .replace(/\b(it is (widely |generally )?(believed|thought|assumed|argued) that)\b/gi, '')
    .replace(/\b(some (experts|researchers|analysts) (say|believe|argue|suggest) (that )?)/gi, '')
    .replace(/\b(according to (some|many|several) (sources|reports|studies),?\s*)/gi, '')
    .replace(/\b(it (might|could|may) be (that |the case that )?)/gi, '')
    .replace(/\b(there is (some |growing )?evidence (that |suggesting ))/gi, '')
    // Remove filler
    .replace(/\b(basically|essentially|fundamentally|importantly|interestingly|notably)\b/gi, '')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s+([.,;:])/g, '$1');

  // If we stripped too much, return original
  if (core.length < 20) return claim;
  return core;
}

/**
 * Reformulate as a skeptical question.
 * Forces the generator into evaluation mode rather than agreement mode.
 */
function toSkeptical(claim: string, lang: 'en' | 'de'): string {
  // Remove trailing punctuation for clean reformulation
  const cleaned = claim.replace(/[.!?]+$/, '').trim();

  if (lang === 'de') {
    return `Stimmt es wirklich, dass ${cleaned.charAt(0).toLowerCase() + cleaned.slice(1)}? Welche Gegenargumente und Schwächen hat diese Behauptung?`;
  }
  return `Is it really true that ${cleaned.charAt(0).toLowerCase() + cleaned.slice(1)}? What are the strongest counterarguments and weaknesses of this claim?`;
}

/**
 * Decompose into numbered atomic claims.
 * Splits compound sentences and lists each assertion separately.
 */
function toStructured(claim: string): string {
  // Split on common compound markers
  const parts = claim
    .split(/(?:,\s*(?:and|oder|und|but|aber|while|however|additionally|furthermore|moreover|also)\s+)|(?:\.\s+)|(?:;\s*)/i)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  if (parts.length <= 1) {
    return `Evaluate the following claim:\n1. ${claim}`;
  }

  const numbered = parts.map((p, i) => `${i + 1}. ${p}`).join('\n');
  return `Evaluate each of the following claims independently:\n${numbered}`;
}

/**
 * Invert the claim — present the opposite and ask the generator to evaluate.
 * This tests whether the generator independently arrives at the original position
 * or whether it just agrees with whatever is presented.
 */
function toInverted(claim: string, lang: 'en' | 'de'): string {
  const cleaned = claim.replace(/[.!?]+$/, '').trim();

  if (lang === 'de') {
    return `Einige argumentieren, dass das Gegenteil wahr ist: Es ist NICHT der Fall, dass ${cleaned.charAt(0).toLowerCase() + cleaned.slice(1)}. Bewerte diese Gegenposition. Ist sie stark oder schwach, und warum?`;
  }
  return `Some argue that the opposite is true: It is NOT the case that ${cleaned.charAt(0).toLowerCase() + cleaned.slice(1)}. Evaluate this counter-position. Is it strong or weak, and why?`;
}

/**
 * The full set of available representations, ordered by diversity value.
 */
const REPRESENTATION_ORDER: RepresentationType[] = [
  'original',      // baseline — always first
  'skeptical',     // forces evaluation mode
  'structured',    // atomic decomposition
  'inverted',      // tests independent reasoning
  'factual-core',  // stripped assertions
];

/**
 * Generate diversified representations of a claim.
 *
 * @param claim - The original claim/question
 * @param count - How many representations to generate (1 = original only)
 * @param lang - Language for reformulations
 * @returns Array of diversified inputs, one per generator
 */
export function diversifyInput(
  claim: string,
  count: number,
  lang: 'en' | 'de' = 'en',
): DiversifiedInput[] {
  if (count <= 0) return [];
  if (count === 1) return [{ type: 'original', content: claim }];

  const representations: DiversifiedInput[] = [];

  for (let i = 0; i < Math.min(count, REPRESENTATION_ORDER.length); i++) {
    const type = REPRESENTATION_ORDER[i];
    let content: string;

    switch (type) {
      case 'original':
        content = claim;
        break;
      case 'factual-core':
        content = toFactualCore(claim);
        break;
      case 'skeptical':
        content = toSkeptical(claim, lang);
        break;
      case 'structured':
        content = toStructured(claim);
        break;
      case 'inverted':
        content = toInverted(claim, lang);
        break;
      default:
        content = claim;
    }

    representations.push({ type, content });
  }

  // If we need more than 5, cycle back with 'original'
  while (representations.length < count) {
    representations.push({ type: 'original', content: claim });
  }

  return representations;
}
