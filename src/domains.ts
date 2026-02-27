import type { CriticMode, DomainProfile, ReceptiveMode } from './types.js';

export interface DomainConfig {
  criticMode: CriticMode;
  requireCitation: boolean;
  classifyObjections: boolean;
  receptiveMode: ReceptiveMode;
  maxConfidence: number;
  description: string;
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
