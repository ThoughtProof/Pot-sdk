import { describe, it, expect, vi } from 'vitest';
import {
  parseMaterialityClassifications,
  calculateMaterialityConfidence,
  critiqueMentionsClaimUnverified,
  runCritic,
} from '../src/pipeline/critic.js';
import type { Proposal, Provider } from '../src/types.js';

/**
 * Recorded critic outputs. Proposal-targeted objections quote generator-added
 * content ("Proposal 1 asserts…"). Claim-targeted objections quote the claim.
 * Missing and garbled TARGET tags are the fail-closed cases.
 */
const PROPOSAL_ONLY = [
  '[TARGET:proposal:1][MATERIALITY:material] OBJECTION: Proposal 1 asserts an unsourced figure of forty seven percent.',
  '[TARGET:proposal:2][MATERIALITY:material] OBJECTION: Proposal 2 adds a citation the claim never made.',
  '[TARGET:proposal:1][MATERIALITY:notable] OBJECTION: Proposal 1 hedges instead of taking a stand.',
  '[OVERALL:deficient]',
].join('\n');

const CLAIM_MATERIAL = [
  '[TARGET:claim][MATERIALITY:material] OBJECTION: The claim dates the treaty to 2019, which contradicts the signing year.',
  '[TARGET:proposal:1][MATERIALITY:material] OBJECTION: Proposal 1 asserts an unsourced figure of forty seven percent.',
  '[OVERALL:deficient]',
].join('\n');

const MISSING_TARGET = [
  '[MATERIALITY:material] OBJECTION: The claim invents a statute that does not exist.',
  '[OVERALL:deficient]',
].join('\n');

const GARBLED_TARGETS = [
  '[TARGET:banana][MATERIALITY:material] OBJECTION: The claim invents a statute that does not exist.',
  '[TARGET:proposal][MATERIALITY:notable] OBJECTION: The claim omits the controlling exception.',
  '[TARGET:proposal:0][MATERIALITY:minor] OBJECTION: The claim uses a vague quantifier.',
  '[TARGET:proposal:x][MATERIALITY:material] OBJECTION: The claim names the wrong court.',
  '[OVERALL:deficient]',
].join('\n');

function makeProvider(fn: Provider['call']): Provider {
  return { name: 'test-provider', call: fn, isAvailable: () => true };
}

describe('parseMaterialityClassifications target scoping', () => {
  it('does not let proposal-targeted material objections sink a correct claim', () => {
    const parsed = parseMaterialityClassifications(PROPOSAL_ONLY);

    expect(parsed.materialCount).toBe(0);
    expect(parsed.notableCount).toBe(0);
    expect(parsed.minorCount).toBe(0);
    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.overallAssessment).toBe('deficient');
    expect(parsed.scoringOverallAssessment).toBe('sound');
    expect(calculateMaterialityConfidence(parsed)).toBe(1);
    expect(parsed.objections.filter(o => o.scored === false)).toHaveLength(3);
    expect(parsed.objections.map(o => o.target)).toEqual([
      'proposal:1',
      'proposal:2',
      'proposal:1',
    ]);
  });

  it('still treats a claim-targeted material objection as a material defect', () => {
    const parsed = parseMaterialityClassifications(CLAIM_MATERIAL);

    expect(parsed.materialCount).toBe(1);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.scoringOverallAssessment).toBe('deficient');
    // 1 claim material (0.30). The proposal material is not in the penalty.
    expect(calculateMaterialityConfidence(parsed)).toBeCloseTo(0.7, 5);
    const claim = parsed.objections.find(o => o.target === 'claim');
    expect(claim?.scored).toBe(true);
    expect(claim?.targetDefaulted).toBe(false);
  });

  it('scores a missing TARGET tag as claim', () => {
    const parsed = parseMaterialityClassifications(MISSING_TARGET);

    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.materialCount).toBe(1);
    expect(parsed.objections[0]).toMatchObject({
      target: 'claim',
      targetDefaulted: true,
      scored: true,
      materiality: 'material',
    });
    expect(calculateMaterialityConfidence(parsed)).toBeCloseTo(0.7, 5);
  });

  it('scores garbled TARGET tags as claim', () => {
    const parsed = parseMaterialityClassifications(GARBLED_TARGETS);

    expect(parsed.objections.map(o => o.targetDefaulted)).toEqual([true, true, true, true]);
    expect(parsed.objections.every(o => o.target === 'claim' && o.scored === true)).toBe(true);
    expect(parsed.materialCount).toBe(2);
    expect(parsed.notableCount).toBe(1);
    expect(parsed.minorCount).toBe(1);
    expect(parsed.hasMaterialDefect).toBe(true);
    // 2*0.30 + 0.10 + 0.02
    expect(calculateMaterialityConfidence(parsed)).toBeCloseTo(0.28, 5);
  });

  it('does not borrow a previous objection TARGET when this one is untagged', () => {
    const parsed = parseMaterialityClassifications([
      '[TARGET:proposal:1][MATERIALITY:material] OBJECTION: extra number from the generator.',
      '[MATERIALITY:material] OBJECTION: The claim dates the treaty to 2019.',
    ].join('\n'));

    expect(parsed.materialCount).toBe(1);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].scored).toBe(false);
    expect(parsed.objections[1]).toMatchObject({ target: 'claim', targetDefaulted: true, scored: true });
  });

  it('accepts a TARGET tag on the line above the materiality tag and ignores spaced proposal indexes', () => {
    const parsed = parseMaterialityClassifications([
      '[TARGET: proposal: 2]',
      '[MATERIALITY:notable] OBJECTION: Proposal 2 invented a percentage.',
      '[TARGET:CLAIM][MATERIALITY:minor] OBJECTION: wording only, the claim stands.',
    ].join('\n'));

    expect(parsed.objections[0]).toMatchObject({ target: 'proposal:2', scored: false, targetDefaulted: false });
    expect(parsed.objections[1]).toMatchObject({ target: 'claim', scored: true, materiality: 'minor' });
    expect(parsed.notableCount).toBe(0);
    expect(parsed.minorCount).toBe(1);
    expect(calculateMaterialityConfidence(parsed)).toBeCloseTo(0.98, 5);
  });

  it('prefers claim when both a claim tag and a proposal tag sit on the same objection', () => {
    const parsed = parseMaterialityClassifications(
      '[TARGET:proposal:1][MATERIALITY:material][TARGET:claim] OBJECTION: The claim and proposal 1 both state the wrong year.',
    );
    expect(parsed.objections[0]).toMatchObject({ target: 'claim', scored: true, targetDefaulted: false });
    expect(parsed.hasMaterialDefect).toBe(true);
  });

  it('scores objections aimed at a user-output proposal as the claim', () => {
    const parsed = parseMaterialityClassifications(
      '[TARGET:proposal:2][MATERIALITY:material] OBJECTION: The submitted text states the wrong year.',
      { claimProposalIndexes: [2] },
    );
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].target).toBe('claim');
    expect(parsed.objections[0].scored).toBe(true);
  });

  it('keeps a harsh overall when no objection was parsed', () => {
    const parsed = parseMaterialityClassifications('[OVERALL:deficient]');
    expect(parsed.objections).toHaveLength(0);
    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.scoringOverallAssessment).toBe('deficient');
  });

  it('ignores the word unverified when it appears only inside proposal objections', () => {
    const text = [
      '[TARGET:proposal:1][MATERIALITY:material] OBJECTION: Proposal 1 asserts an unverified percentage.',
      '[OVERALL:sound]',
    ].join('\n');
    const parsed = parseMaterialityClassifications(text);
    expect(critiqueMentionsClaimUnverified(text, parsed)).toBe(false);

    const claimText = '[TARGET:claim][MATERIALITY:material] OBJECTION: The claim is unverified on the date.';
    const claimParsed = parseMaterialityClassifications(claimText);
    expect(critiqueMentionsClaimUnverified(claimText, claimParsed)).toBe(true);

    const untagged = '[MATERIALITY:material] OBJECTION: The claim is unverified on the date.';
    const untaggedParsed = parseMaterialityClassifications(untagged);
    expect(critiqueMentionsClaimUnverified(untagged, untaggedParsed)).toBe(true);
  });
});

describe('runCritic target instructions', () => {
  const proposals: Proposal[] = [
    { model: 'grok', content: 'Generator answer with an extra percentage.' },
    { model: 'user-output', content: 'The claim under verification.' },
  ];

  it('asks the critic to tag claim versus proposal when materiality is on', async () => {
    const prompts: string[] = [];
    const provider = makeProvider(async (_model, prompt) => {
      prompts.push(prompt);
      return {
        content: '[TARGET:claim][MATERIALITY:minor] OBJECTION: none material\n[OVERALL:sound]',
        tokens: 1,
        cost: 0,
      };
    });

    await runCritic(provider, 'anthropic/claude-sonnet-4-6', proposals, 'en', false, undefined, 'adversarial', {
      classifyMateriality: true,
    });

    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain('[TARGET:claim]');
    expect(prompts[0]).toContain('[TARGET:proposal:N]');
    expect(prompts[0]).toContain('If you are unsure, use claim');
    expect(prompts[0]).toContain('user-output');
    expect(prompts[0]).toContain('=== PROPOSAL 2 (user-output) ===');
  });

  it('does not add target instructions when materiality classification is off', async () => {
    const prompts: string[] = [];
    const provider = makeProvider(async (_model, prompt) => {
      prompts.push(prompt);
      return { content: 'no tags', tokens: 1, cost: 0 };
    });

    await runCritic(provider, 'critic/model', proposals, 'en', false, undefined, 'adversarial');

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('TARGET (CRITICAL');
  });
});

const pipeline = vi.hoisted(() => ({ critic: '' }));

vi.mock('../src/providers/index.js', async () => {
  const actual = await vi.importActual<typeof import('../src/providers/index.js')>('../src/providers/index.js');
  const provider = {
    name: 'mock',
    isAvailable: () => true,
    call: async (_model: string, prompt: string) => {
      if (prompt.includes('injection detection')) {
        return { content: '{"injected": false, "confidence": 0, "evidence": null}', tokens: 0, cost: 0 };
      }
      if (prompt.includes('You are the Synthesizer')) {
        return {
          content: 'The Pacific Ocean is the largest ocean on Earth. That claim stands. Confidence: 70%',
          tokens: 0,
          cost: 0,
        };
      }
      if (prompt.includes('independent analyst')) {
        return {
          content: 'The Pacific Ocean is the largest ocean on Earth. Confidence: 90%',
          tokens: 0,
          cost: 0,
        };
      }
      return { content: pipeline.critic, tokens: 0, cost: 0 };
    },
  };
  return {
    ...actual,
    createProviderFromConfig: () => provider,
    createProvider: () => provider,
  };
});

import { verify } from '../src/verify.js';
import type { MaterialityResult } from '../src/pipeline/critic.js';

function verifyClaim(critic: string) {
  pipeline.critic = critic;
  return verify('', {
    claim: 'The Pacific Ocean is the largest ocean on Earth.',
    language: 'en',
    domain: 'general',
    criticMode: 'adversarial',
    stakeLevel: 'medium',
    classifyMateriality: true,
    guard: false,
    providers: [
      { name: 'xai', model: 'grok-test', apiKey: 'test', role: 'generator' },
      { name: 'deepseek', model: 'deepseek-test', apiKey: 'test', role: 'synthesizer' },
      { name: 'anthropic', model: 'claude-test', apiKey: 'test', role: 'critic' },
    ],
  });
}

describe('verify() verdict with recorded critic output', () => {
  it('does not sink a correct claim when material objections target generator proposals', async () => {
    const result = await verifyClaim([
      '[TARGET:proposal:1][MATERIALITY:material] OBJECTION: Proposal 1 asserts an unsourced figure of forty seven percent.',
      '[TARGET:proposal:1][MATERIALITY:material] OBJECTION: Proposal 1 adds a citation the claim never made.',
      '[OVERALL:deficient]',
    ].join('\n'));
    const materiality = (result as { materiality?: MaterialityResult }).materiality;

    expect(materiality?.hasMaterialDefect).toBe(false);
    expect(materiality?.materialCount).toBe(0);
    expect(materiality?.scoringOverallAssessment).toBe('sound');
    expect(result.flags, JSON.stringify(result.flags)).toEqual([]);
    expect(result.verdict).toBe('VERIFIED');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('returns UNVERIFIED when a material objection targets the claim', async () => {
    const result = await verifyClaim(CLAIM_MATERIAL);
    const materiality = (result as { materiality?: MaterialityResult }).materiality;

    expect(materiality?.hasMaterialDefect).toBe(true);
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('returns UNVERIFIED when the material objection has no target tag', async () => {
    const result = await verifyClaim(MISSING_TARGET);
    expect((result as { materiality?: MaterialityResult }).materiality?.objections[0].targetDefaulted).toBe(true);
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('returns UNVERIFIED when the material objection target tag is garbled', async () => {
    const result = await verifyClaim(GARBLED_TARGETS);
    expect(result.verdict).toBe('UNVERIFIED');
  });
});
