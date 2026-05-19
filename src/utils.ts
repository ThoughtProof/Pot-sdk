import type { Proposal } from './types.js';
import { extractKeywords, type SynthesisBalance } from './pipeline/synthesizer.js';

export function parseConfidence(text: string): number {
  const match = text.match(/confidence[:\s]*(\d+(?:\.\d+)?)%/i);
  return match ? parseFloat(match[1]) / 100 : 0.5;
}

/**
 * Content Diversity Index — measures how diverse the actual outputs are
 * (keyword-based Jaccard distance between proposals).
 */
export function computeMdi(proposals: Proposal[]): number {
  if (proposals.length < 2) return 1.0;

  const kws: Set<string>[] = proposals.map(p => new Set(extractKeywords(p.content)));

  let pairwiseSim = 0;
  let pairs = 0;

  for (let i = 0; i < kws.length; i++) {
    for (let j = i + 1; j < kws.length; j++) {
      const inter = new Set([...kws[i]].filter(x => kws[j].has(x)));
      const union = kws[i].size + kws[j].size - inter.size;
      pairwiseSim += union > 0 ? inter.size / union : 0;
      pairs++;
    }
  }

  const avgSim = pairwiseSim / pairs;
  return 1 - avgSim; // high diversity = low similarity
}

/**
 * Model Diversity Index (Patent Claim 4) — Herfindahl-Hirschman based.
 * MDI = 1 - Σ(share_i²) where share_i is the proportion of model family i.
 *
 * Examples:
 *   3 models, all same family:        MDI = 0.00
 *   3 models, 3 different families:   MDI = 0.67
 *   4 models, 4 different families:   MDI = 0.75
 *   5 models, 4 families (2,1,1,1):   MDI = 0.72
 */
export function computeModelFamilyMDI(modelNames: string[]): number {
  if (modelNames.length === 0) return 0;

  const families = modelNames.map(m => resolveModelFamily(m));
  const familyCounts: Record<string, number> = {};
  for (const f of families) {
    familyCounts[f] = (familyCounts[f] || 0) + 1;
  }

  const total = families.length;
  let hhi = 0;
  for (const count of Object.values(familyCounts)) {
    const share = count / total;
    hhi += share * share;
  }

  return parseFloat((1 - hhi).toFixed(3));
}

/**
 * Resolve a model name to its family (for MDI calculation).
 * Patent requires different "model families" — not just different models.
 */
export function resolveModelFamily(modelName: string): string {
  const m = modelName.toLowerCase();

  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.includes('grok') || m.includes('xai')) return 'xai';
  if (m.includes('gpt') || m.includes('openai') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';
  if (m.includes('gemini') || m.includes('google')) return 'google';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('llama') || m.includes('meta')) return 'meta';
  if (m.includes('kimi') || m.includes('moonshot')) return 'moonshot';
  if (m.includes('serv') && !m.includes('openserv')) return 'openserv';
  if (m.includes('openserv')) return 'openserv';
  if (m.includes('qwen') || m.includes('alibaba')) return 'alibaba';
  if (m.includes('mistral')) return 'mistral';
  if (m.includes('command') || m.includes('cohere')) return 'cohere';

  return 'unknown';
}

/**
 * Extract the set of unique model families used in the pipeline.
 */
export function extractModelFamilies(
  generatorModels: string[],
  criticModel: string,
  synthesizerModel: string,
): string[] {
  const allModels = [...generatorModels, criticModel, synthesizerModel];
  const families = new Set(allModels.map(m => resolveModelFamily(m)));
  return [...families].sort();
}

/**
 * Extract minority (dissenting) positions from generator proposals.
 * Patent Claim 1(e): "explicit dissent representing minority positions
 * that did not reach consensus."
 *
 * Compares each proposal's stance to the final verdict and captures
 * those that disagree.
 */
export function extractMinorityPositions(
  proposals: Proposal[],
  finalVerdict: string,
  synthesisContent: string,
): { model: string; family: string; position: string; reason: string }[] {
  const minorities: { model: string; family: string; position: string; reason: string }[] = [];

  for (const p of proposals) {
    const content = p.content.toLowerCase();

    // Detect the proposal's implicit verdict
    const blockSignals = (content.match(/\b(block|hold|deny|reject|unsafe|danger|risky|flaw|error|incorrect|insufficient)\b/g) ?? []).length;
    const allowSignals = (content.match(/\b(allow|safe|recommend|approve|sound|valid|correct|verified)\b/g) ?? []).length;

    let proposalStance: string;
    if (blockSignals > allowSignals + 2) {
      proposalStance = 'BLOCK';
    } else if (allowSignals > blockSignals + 2) {
      proposalStance = 'ALLOW';
    } else {
      proposalStance = 'UNCERTAIN';
    }

    // If this model's stance differs from the final verdict, it's a minority position
    if (proposalStance !== finalVerdict && proposalStance !== 'UNCERTAIN') {
      // Extract a brief reason (first sentence with a key signal)
      const sentences = p.content.split(/[.!?]+/).filter(s => s.trim().length > 10);
      const keySignals = proposalStance === 'BLOCK'
        ? /block|hold|deny|reject|unsafe|danger|risky|flaw|error/i
        : /allow|safe|recommend|approve|sound|valid/i;
      const reasonSentence = sentences.find(s => keySignals.test(s))?.trim() || sentences[0]?.trim() || '';

      minorities.push({
        model: p.model,
        family: resolveModelFamily(p.model),
        position: proposalStance,
        reason: reasonSentence.substring(0, 300),
      });
    }
  }

  return minorities;
}