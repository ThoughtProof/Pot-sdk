import type { CriticMode, DomainProfile, ReceptiveMode } from './types.js';

export interface DomainConfig {
  criticMode: CriticMode;
  requireCitation: boolean;
  classifyObjections: boolean;
  receptiveMode: ReceptiveMode;
  maxConfidence: number;
  description: string;
}

/**
 * Toxic combinations warning (insight from @evil_robot_jas):
 * adversarial critic + defensive generator = opacity. The system learns to hide
 * reasoning rather than improve it. "A hostile critic in a creative loop doesn't
 * just kill flow, it teaches the system to hide its reasoning instead of sharpen it."
 */
export const TOXIC_COMBINATIONS: Array<{ criticMode: CriticMode; receptiveMode: ReceptiveMode; warning: string }> = [
  { criticMode: 'adversarial', receptiveMode: 'defensive', warning: 'adversarial + defensive may produce opacity: generator learns to hide reasoning instead of improving it' },
];

export function checkToxicCombination(criticMode: CriticMode, receptiveMode: ReceptiveMode): string | null {
  const match = TOXIC_COMBINATIONS.find(t => t.criticMode === criticMode && t.receptiveMode === receptiveMode);
  return match?.warning ?? null;
}

export const DOMAIN_PROFILES: Record<DomainProfile, DomainConfig> = {
  medical: {
    criticMode: 'adversarial',
    requireCitation: true,
    classifyObjections: true,
    receptiveMode: 'open',
    maxConfidence: 0.70,
    description: 'Miss nothing. Every claim must be sourced.',
  },
  legal: {
    criticMode: 'adversarial',
    requireCitation: true,
    classifyObjections: true,
    receptiveMode: 'open',
    maxConfidence: 0.75,
    description: 'Precedent-based. Every citation verified.',
  },
  financial: {
    criticMode: 'balanced',
    requireCitation: true,
    classifyObjections: true,
    receptiveMode: 'adaptive',
    maxConfidence: 0.70,
    description: 'Adversarial on numbers, resistant on narrative.',
  },
  creative: {
    criticMode: 'resistant',
    requireCitation: false,
    classifyObjections: false,
    receptiveMode: 'adaptive',
    maxConfidence: 0.85,
    description: 'Evidence-based review without attacking creative choices.',
  },
  code: {
    criticMode: 'balanced',
    requireCitation: true,
    classifyObjections: true,
    receptiveMode: 'open',
    maxConfidence: 0.80,
    description: 'Adversarial on correctness, resistant on architecture.',
  },
  general: {
    criticMode: 'balanced',
    requireCitation: false,
    classifyObjections: false,
    receptiveMode: 'adaptive',
    maxConfidence: 0.85,
    description: 'Default profile. Balanced critique.',
  },
};
