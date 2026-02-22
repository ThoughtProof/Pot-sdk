import type { Proposal } from './types.js';
import { extractKeywords, type SynthesisBalance } from './pipeline/synthesizer.js';

export function parseConfidence(text: string): number {
  const match = text.match(/confidence[:\\s]*(\\d+(?:\\.\\d+)?)%/i);
  return match ? parseFloat(match[1]) / 100 : 0.5;
}

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