import { describe, it, expect, vi } from 'vitest';
import {
  parseMaterialityClassifications,
  calculateMaterialityConfidence,
  critiqueMentionsClaimUnverified,
  claimIsFactualAccusation,
  runCritic,
} from '../src/pipeline/critic.js';
import type { Proposal, Provider } from '../src/types.js';

const FACT = { factMode: true as const };

function line(
  kind: string,
  body: string,
  extra?: { scope?: string; materiality?: string; target?: string },
): string {
  const target = extra?.target ?? 'claim';
  const materiality = extra?.materiality ?? 'material';
  const scope = extra?.scope != null ? `[SCOPE:${extra.scope}]` : '';
  const kindTag = kind ? `[KIND:${kind}]` : '';
  return `[TARGET:${target}]${kindTag}${scope}[MATERIALITY:${materiality}] OBJECTION: ${body}`;
}

function makeProvider(fn: Provider['call']): Provider {
  return { name: 'test-provider', call: fn, isAvailable: () => true };
}

describe('claimIsFactualAccusation', () => {
  it('detects a named person accused of a crime', () => {
    expect(claimIsFactualAccusation('Holmen murdered his children.')).toBe(true);
    expect(claimIsFactualAccusation('Noyb is liable for the disclosure.')).toBe(true);
  });

  it('does not treat a peripheral statute detail as an accusation', () => {
    expect(claimIsFactualAccusation('Section 12 of the tax statute was renumbered last year.')).toBe(false);
    expect(claimIsFactualAccusation('No African country starts with K.')).toBe(false);
  });
});

describe('parseMaterialityClassifications fact-mode kinds', () => {
  it.each(['precision', 'incomplete', 'disagreement'] as const)(
    'demotes a material %s objection in fact mode',
    (kind) => {
      const text = [
        line(kind, `The claim is ${kind} and nothing here is shown false.`),
        '[OVERALL:deficient]',
      ].join('\n');
      const parsed = parseMaterialityClassifications(text, FACT);

      expect(parsed.factMode).toBe(true);
      expect(parsed.hasMaterialDefect).toBe(false);
      expect(parsed.materialCount).toBe(0);
      expect(parsed.notableCount).toBe(1);
      expect(parsed.scoringOverallAssessment).toBe('sound');
      expect(parsed.objections[0]).toMatchObject({
        kind,
        kindDefaulted: false,
        materiality: 'material',
        effectiveMateriality: 'notable',
      });
      // Soft notables cost 0.03 in fact mode, not 0.10.
      expect(calculateMaterialityConfidence(parsed)).toBeCloseTo(0.97, 5);
    },
  );

  it.each(['precision', 'incomplete', 'disagreement'] as const)(
    'keeps a material %s objection material when claimMode is omitted',
    (kind) => {
      const text = line(kind, `The claim is ${kind} and nothing here is shown false.`);
      const parsed = parseMaterialityClassifications(text);

      expect(parsed.factMode).toBeFalsy();
      expect(parsed.hasMaterialDefect).toBe(true);
      expect(parsed.objections[0].effectiveMateriality).toBe('material');
      expect(parsed.objections[0].scope).toBeUndefined();
    },
  );

  it('keeps decision mode when claimMode is decision', () => {
    const text = line('precision', 'The word most is vague.');
    const parsed = parseMaterialityClassifications(text, { factMode: false });
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].effectiveMateriality).toBe('material');
  });

  it.each(['false', 'fabricated'] as const)(
    'keeps KIND:%s material in fact mode',
    (kind) => {
      const text = line(kind, 'The claim names the wrong statute.');
      const parsed = parseMaterialityClassifications(text, FACT);
      expect(parsed.hasMaterialDefect).toBe(true);
      expect(parsed.materialCount).toBe(1);
      expect(parsed.objections[0]).toMatchObject({
        kind,
        effectiveMateriality: 'material',
      });
    },
  );

  it('forces material when KIND is missing, even if the critic said notable', () => {
    const text = '[TARGET:claim][MATERIALITY:notable] OBJECTION: The claim dates the treaty to 2019.';
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0]).toMatchObject({
      kindDefaulted: true,
      materiality: 'notable',
      effectiveMateriality: 'material',
    });
    expect(parsed.hasMaterialDefect).toBe(true);
  });

  it.each(['banana', 'falsehood', '', 'proposal'] as const)(
    'scores garbled KIND %j as material',
    (kind) => {
      const text = line(kind, 'The claim names the wrong court.');
      const parsed = parseMaterialityClassifications(text, FACT);
      expect(parsed.objections[0].kindDefaulted).toBe(true);
      expect(parsed.objections[0].kind).toBeUndefined();
      expect(parsed.hasMaterialDefect).toBe(true);
    },
  );

  it('does not upgrade a proposal-targeted objection that omits KIND', () => {
    const text = '[TARGET:proposal:1][MATERIALITY:notable] OBJECTION: Proposal 1 hedges.';
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.notableCount).toBe(0);
    expect(parsed.objections[0]).toMatchObject({
      scored: false,
      materiality: 'notable',
      effectiveMateriality: 'notable',
    });
  });
});

describe('bare UNVERIFIED scope', () => {
  const peripheralClaim = 'Section 12 of the tax statute was renumbered last year.';

  it('demotes unverified doubt about a peripheral detail', () => {
    const text = [
      line('unverified', 'UNVERIFIED: the exact section number may have been renumbered.', { scope: 'peripheral' }),
      '[OVERALL:questionable]',
    ].join('\n');
    const parsed = parseMaterialityClassifications(text, {
      ...FACT,
      accusation: claimIsFactualAccusation(peripheralClaim),
    });

    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.notableCount).toBe(1);
    expect(parsed.scoringOverallAssessment).toBe('sound');
    expect(parsed.objections[0]).toMatchObject({
      kind: 'unverified',
      scope: 'peripheral',
      scopeDefaulted: false,
      effectiveMateriality: 'notable',
    });
    expect(critiqueMentionsClaimUnverified(text, parsed)).toBe(false);
  });

  it('accepts a spaced SCOPE:peripheral tag', () => {
    const text = line('unverified', 'Cannot confirm the exact numbering.', { scope: ' peripheral' });
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0]).toMatchObject({
      scope: 'peripheral',
      scopeDefaulted: false,
      effectiveMateriality: 'notable',
    });
    expect(parsed.hasMaterialDefect).toBe(false);
  });

  it('keeps core unverified doubt material', () => {
    const text = line('unverified', 'UNVERIFIED: whether the treaty was signed at all.', { scope: 'core' });
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0]).toMatchObject({
      scope: 'core',
      scopeDefaulted: false,
      effectiveMateriality: 'material',
    });
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(critiqueMentionsClaimUnverified(text, parsed)).toBe(true);
  });

  it('counts a missing SCOPE tag as core', () => {
    const text = line('unverified', 'UNVERIFIED: whether the treaty was signed at all.');
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0]).toMatchObject({
      scope: 'core',
      scopeDefaulted: true,
      effectiveMateriality: 'material',
    });
    expect(parsed.hasMaterialDefect).toBe(true);
  });

  it.each(['side', 'edge', 'maybe', ''] as const)(
    'counts garbled SCOPE %j as core',
    (scope) => {
      const text = line('unverified', 'UNVERIFIED: the central outcome.', { scope });
      const parsed = parseMaterialityClassifications(text, FACT);
      expect(parsed.objections[0]).toMatchObject({
        scope: 'core',
        scopeDefaulted: true,
        effectiveMateriality: 'material',
      });
      expect(parsed.hasMaterialDefect).toBe(true);
    },
  );

  it('prefers SCOPE:core when both scopes are present', () => {
    const text = '[TARGET:claim][KIND:unverified][SCOPE:peripheral][MATERIALITY:material][SCOPE:core] OBJECTION: UNVERIFIED: the outcome.';
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0]).toMatchObject({ scope: 'core', scopeDefaulted: false });
    expect(parsed.hasMaterialDefect).toBe(true);
  });
});

describe('P04-style accusation held only by UNVERIFIED objections', () => {
  const claim = 'Holmen murdered his children.';
  const threeUnverified = (scope?: string) => [
    line('unverified', 'UNVERIFIED: that Holmen murdered his children.', scope != null ? { scope } : undefined),
    line('unverified', 'UNVERIFIED: the named person committed that crime.', scope != null ? { scope } : undefined),
    line('unverified', 'UNVERIFIED: the children were the victims.', scope != null ? { scope } : undefined),
    '[OVERALL:questionable]',
  ].join('\n');

  it('recognises the claim as an accusation', () => {
    expect(claimIsFactualAccusation(claim)).toBe(true);
  });

  it('stays a material defect when SCOPE is omitted', () => {
    const parsed = parseMaterialityClassifications(threeUnverified(), {
      factMode: true,
      accusation: true,
    });
    expect(parsed.materialCount).toBe(3);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections.every(o => o.scope === 'core' && o.scopeDefaulted === true)).toBe(true);
    expect(parsed.objections.every(o => o.effectiveMateriality === 'material')).toBe(true);
    expect(parsed.scoringOverallAssessment).toBe('questionable');
  });

  it('stays a material defect even when the critic marks every objection peripheral', () => {
    const parsed = parseMaterialityClassifications(threeUnverified('peripheral'), {
      factMode: true,
      accusation: true,
    });
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.materialCount).toBe(3);
    expect(parsed.objections.every(o => o.scope === 'peripheral' && o.effectiveMateriality === 'material')).toBe(true);
  });
});

describe('explicit counter-fact stays material', () => {
  const kenya = 'No African country starts with K is false: Kenya.';

  it('keeps KIND:false material', () => {
    const parsed = parseMaterialityClassifications(line('false', kenya), FACT);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].effectiveMateriality).toBe('material');
  });

  it('keeps "is false: Kenya" material even when tagged unverified and peripheral', () => {
    const text = line('unverified', kenya, { scope: 'peripheral', materiality: 'minor' });
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0]).toMatchObject({
      kind: 'unverified',
      scope: 'peripheral',
      materiality: 'minor',
      effectiveMateriality: 'material',
    });
    expect(parsed.hasMaterialDefect).toBe(true);
  });

  it.each([
    'factually false: Kenya',
    'The claim is false: Kenya exists.',
    'false: Kenya',
  ])('treats %j as a concrete counter-fact', (body) => {
    const text = line('precision', body, { scope: 'peripheral' });
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].effectiveMateriality).toBe('material');
  });

  it('does not upgrade the same sentence in decision mode', () => {
    const text = line('unverified', kenya, { scope: 'peripheral', materiality: 'notable' });
    const parsed = parseMaterialityClassifications(text);
    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.objections[0].effectiveMateriality).toBe('notable');
  });
});

describe('runCritic fact-mode instructions', () => {
  const proposals: Proposal[] = [
    { model: 'grok', content: 'Generator answer.' },
  ];

  it('asks for KIND and SCOPE only in fact mode', async () => {
    const prompts: string[] = [];
    const provider = makeProvider(async (_model, prompt) => {
      prompts.push(prompt);
      return {
        content: '[TARGET:claim][KIND:precision][SCOPE:peripheral][MATERIALITY:minor] OBJECTION: none\n[OVERALL:sound]',
        tokens: 1,
        cost: 0,
      };
    });

    await runCritic(provider, 'anthropic/claude-sonnet-4-6', proposals, 'en', false, undefined, 'adversarial', {
      classifyMateriality: true,
      factMode: true,
    });

    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain('FACT MODE — KIND');
    expect(prompts[0]).toContain('[SCOPE:core]');
    expect(prompts[0]).toContain('[SCOPE:peripheral]');
    expect(prompts[0]).toContain('is false: Kenya');
    expect(prompts[0]).toContain('If you are unsure, use [SCOPE:core]');
  });

  it('omits fact-mode instructions for a decision check', async () => {
    const prompts: string[] = [];
    const provider = makeProvider(async (_model, prompt) => {
      prompts.push(prompt);
      return { content: '[TARGET:claim][MATERIALITY:minor] OBJECTION: none\n[OVERALL:sound]', tokens: 1, cost: 0 };
    });

    await runCritic(provider, 'critic/model', proposals, 'en', false, undefined, 'adversarial', {
      classifyMateriality: true,
    });

    expect(prompts[0]).not.toContain('FACT MODE — KIND');
    expect(prompts[0]).toContain('[TARGET:claim]');
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
          content: 'The claim under verification stands as stated. Confidence: 70%',
          tokens: 0,
          cost: 0,
        };
      }
      if (prompt.includes('independent analyst')) {
        return {
          content: 'The claim under verification stands as stated. Confidence: 90%',
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

function verifyClaim(critic: string, claim: string, claimMode?: 'fact' | 'decision') {
  pipeline.critic = critic;
  return verify('', {
    claim,
    language: 'en',
    domain: 'general',
    criticMode: 'adversarial',
    stakeLevel: 'medium',
    classifyMateriality: true,
    ...(claimMode ? { claimMode } : {}),
    guard: false,
    providers: [
      { name: 'xai', model: 'grok-test', apiKey: 'test', role: 'generator' },
      { name: 'deepseek', model: 'deepseek-test', apiKey: 'test', role: 'synthesizer' },
      { name: 'anthropic', model: 'claude-test', apiKey: 'test', role: 'critic' },
    ],
  });
}

describe('verify() fact-mode verdicts', () => {
  it('returns UNVERIFIED for a P04 accusation held only by unscoped UNVERIFIED objections', async () => {
    const critic = [
      '[TARGET:claim][KIND:unverified][MATERIALITY:material] OBJECTION: UNVERIFIED: that Holmen murdered his children.',
      '[TARGET:claim][KIND:unverified][MATERIALITY:material] OBJECTION: UNVERIFIED: the named person committed that crime.',
      '[TARGET:claim][KIND:unverified][MATERIALITY:material] OBJECTION: UNVERIFIED: the children were the victims.',
      '[OVERALL:questionable]',
    ].join('\n');
    const result = await verifyClaim(critic, 'Holmen murdered his children.', 'fact');
    const materiality = (result as { materiality?: MaterialityResult }).materiality;

    expect(materiality?.hasMaterialDefect).toBe(true);
    expect(materiality?.materialCount).toBe(3);
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('returns UNVERIFIED for a P04 accusation even when UNVERIFIED objections are marked peripheral', async () => {
    const critic = [
      '[TARGET:claim][KIND:unverified][SCOPE:peripheral][MATERIALITY:material] OBJECTION: UNVERIFIED: that Holmen murdered his children.',
      '[TARGET:claim][KIND:unverified][SCOPE:peripheral][MATERIALITY:notable] OBJECTION: UNVERIFIED: the named person committed that crime.',
      '[TARGET:claim][KIND:unverified][SCOPE:peripheral][MATERIALITY:minor] OBJECTION: UNVERIFIED: the children were the victims.',
      '[OVERALL:sound]',
    ].join('\n');
    const result = await verifyClaim(critic, 'Holmen murdered his children.', 'fact');
    const materiality = (result as { materiality?: MaterialityResult }).materiality;

    expect(materiality?.hasMaterialDefect).toBe(true);
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('returns UNVERIFIED for an explicit false: Kenya counter-fact', async () => {
    const critic = [
      '[TARGET:claim][KIND:false][MATERIALITY:material] OBJECTION: No African country starts with K is false: Kenya.',
      '[OVERALL:deficient]',
    ].join('\n');
    const result = await verifyClaim(critic, 'No African country starts with K.', 'fact');
    const materiality = (result as { materiality?: MaterialityResult }).materiality;

    expect(materiality?.hasMaterialDefect).toBe(true);
    expect(materiality?.objections[0].effectiveMateriality).toBe('material');
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('keeps a false: Kenya objection material when the critic labels it unverified and peripheral', async () => {
    const critic = '[TARGET:claim][KIND:unverified][SCOPE:peripheral][MATERIALITY:minor] OBJECTION: No African country starts with K is false: Kenya.';
    const result = await verifyClaim(critic, 'No African country starts with K.', 'fact');
    const materiality = (result as { materiality?: MaterialityResult }).materiality;

    expect(materiality?.hasMaterialDefect).toBe(true);
    expect(materiality?.objections[0].effectiveMateriality).toBe('material');
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('does not block a correct claim on peripheral unverified numbering', async () => {
    const critic = [
      '[TARGET:claim][KIND:unverified][SCOPE:peripheral][MATERIALITY:material] OBJECTION: UNVERIFIED: the exact section number.',
      '[OVERALL:deficient]',
    ].join('\n');
    const result = await verifyClaim(
      critic,
      'Section 12 of the tax statute was renumbered last year.',
      'fact',
    );
    const materiality = (result as { materiality?: MaterialityResult }).materiality;

    expect(materiality?.hasMaterialDefect).toBe(false);
    expect(materiality?.scoringOverallAssessment).toBe('sound');
    expect(result.flags, JSON.stringify(result.flags)).toEqual([]);
    expect(result.verdict).toBe('VERIFIED');
  });

  it('still returns UNVERIFIED for the same precision objection in decision mode', async () => {
    const critic = '[TARGET:claim][KIND:precision][MATERIALITY:material] OBJECTION: The word most is vague.';
    const result = await verifyClaim(critic, 'Most rivers flow downhill.', 'decision');
    expect((result as { materiality?: MaterialityResult }).materiality?.hasMaterialDefect).toBe(true);
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('returns VERIFIED for that precision objection in fact mode', async () => {
    const critic = [
      '[TARGET:claim][KIND:precision][MATERIALITY:material] OBJECTION: The word most is vague.',
      '[OVERALL:deficient]',
    ].join('\n');
    const result = await verifyClaim(critic, 'Most rivers flow downhill.', 'fact');
    const materiality = (result as { materiality?: MaterialityResult }).materiality;
    expect(materiality?.hasMaterialDefect).toBe(false);
    expect(materiality?.notableCount).toBe(1);
    expect(result.verdict).toBe('VERIFIED');
  });
});
