import { describe, it, expect, vi } from 'vitest';
import {
  parseMaterialityClassifications,
  calculateMaterialityConfidence,
  claimIsFactualAccusation,
  runCritic,
} from '../src/pipeline/critic.js';
import type { MaterialityResult } from '../src/pipeline/critic.js';
import type { Proposal, Provider } from '../src/types.js';

const FACT = { factMode: true as const };

function objection(tags: string, body: string): string {
  return `${tags}[MATERIALITY:material] OBJECTION: ${body}`;
}

function makeProvider(fn: Provider['call']): Provider {
  return { name: 'test-provider', call: fn, isAvailable: () => true };
}

describe('false and fabricated need an independent counter-fact', () => {
  it('demotes KIND:false when the only basis is another generator', () => {
    const text = [
      objection(
        '[TARGET:claim][KIND:false][SCOPE:core][COUNTERFACT: Generator 1 says otherwise]',
        'Generator 1 says otherwise.',
      ),
      '[OVERALL:deficient]',
    ].join('\n');
    const parsed = parseMaterialityClassifications(text, FACT);

    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.notableCount).toBe(1);
    expect(parsed.scoringOverallAssessment).toBe('sound');
    expect(parsed.objections[0]).toMatchObject({
      kind: 'false',
      counterfactIndependent: false,
      reclassifiedDisagreement: true,
      effectiveMateriality: 'notable',
    });
    expect(calculateMaterialityConfidence(parsed)).toBeCloseTo(0.97, 5);
  });

  it('demotes KIND:fabricated when a proposal is the only source', () => {
    const text = objection(
      '[TARGET:claim][KIND:fabricated][SCOPE:peripheral][COUNTERFACT: one proposal claims the text is fabricated]',
      'One proposal claims the text is fabricated.',
    );
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.objections[0].reclassifiedDisagreement).toBe(true);
    expect(parsed.objections[0].effectiveMateriality).toBe('notable');
  });

  it('keeps KIND:false material when COUNTERFACT states what is true', () => {
    const text = objection(
      '[TARGET:claim][KIND:false][SCOPE:core][COUNTERFACT: The treaty was signed in 1992]',
      'The claim dates the treaty to 2019.',
    );
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0]).toMatchObject({
      counterfactIndependent: true,
      effectiveMateriality: 'material',
    });
    expect(parsed.objections[0].reclassifiedDisagreement).toBeUndefined();
  });

  it('keeps KIND:fabricated material when COUNTERFACT names the real source', () => {
    const text = objection(
      '[TARGET:claim][KIND:fabricated][SCOPE:core][COUNTERFACT: The quoted statute is 15 USC 1681]',
      'The claim invents a section.',
    );
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].counterfact).toMatch(/15 USC 1681/);
  });

  it('stays material when a false objection has no counter-fact and SCOPE is missing', () => {
    const text = objection('[TARGET:claim][KIND:false]', 'Generator 1 says otherwise.');
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0]).toMatchObject({
      scope: 'core',
      scopeDefaulted: true,
      effectiveMateriality: 'material',
    });
    expect(parsed.hasMaterialDefect).toBe(true);
  });

  it('stays material when SCOPE is garbled and there is no counter-fact', () => {
    const text = objection(
      '[TARGET:claim][KIND:false][SCOPE:side][COUNTERFACT: Generator 2 says otherwise]',
      'Generator 2 says otherwise.',
    );
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0].scopeDefaulted).toBe(true);
    expect(parsed.hasMaterialDefect).toBe(true);
  });

  it('stays material for an accusation even when the false tag only cites a generator', () => {
    const claim = 'Holmen murdered his children.';
    const text = objection(
      '[TARGET:claim][KIND:false][SCOPE:peripheral][COUNTERFACT: Generator 2 says this is fabricated]',
      'Generator 2 says this is fabricated.',
    );
    const parsed = parseMaterialityClassifications(text, {
      factMode: true,
      accusation: claimIsFactualAccusation(claim),
    });
    expect(claimIsFactualAccusation(claim)).toBe(true);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].effectiveMateriality).toBe('material');
  });

  it('keeps an explicit is false: Kenya objection material', () => {
    const text = objection(
      '[TARGET:claim][KIND:unverified][SCOPE:peripheral]',
      'No African country starts with K is false: Kenya.',
    );
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].counterfactIndependent).toBe(true);
  });

  it('does not demote the same generator-based false objection in decision mode', () => {
    const text = objection(
      '[TARGET:claim][KIND:false][SCOPE:core][COUNTERFACT: Generator 1 says otherwise]',
      'Generator 1 says otherwise.',
    );
    const parsed = parseMaterialityClassifications(text);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].reclassifiedDisagreement).toBeUndefined();
    expect(parsed.objections[0].effectiveMateriality).toBe('material');
  });
});

describe('objections that affirm the claim are not material', () => {
  it.each([
    'No factual error in the claim.',
    'This is correct.',
    'The claim is acceptable.',
  ])('drops %j in fact mode even when tagged false', (body) => {
    const text = [
      objection('[TARGET:claim][KIND:false][SCOPE:peripheral]', body),
      '[OVERALL:deficient]',
    ].join('\n');
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.materialCount).toBe(0);
    expect(parsed.notableCount).toBe(0);
    expect(parsed.minorCount).toBe(0);
    expect(parsed.scoringOverallAssessment).toBe('sound');
    expect(parsed.objections[0].affirming).toBe(true);
    expect(calculateMaterialityConfidence(parsed)).toBe(1);
  });

  it('does not treat a negated affirmation as agreement', () => {
    const text = objection(
      '[TARGET:claim][KIND:false][SCOPE:core][COUNTERFACT: The treaty was signed in 1992]',
      'The claim is not acceptable.',
    );
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0].affirming).toBeUndefined();
    expect(parsed.hasMaterialDefect).toBe(true);
  });

  it('still scores an affirming sentence as material in decision mode', () => {
    const text = objection('[TARGET:claim][KIND:false][SCOPE:peripheral]', 'This is correct.');
    const parsed = parseMaterialityClassifications(text);
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.objections[0].affirming).toBeUndefined();
  });
});

describe('soft notable penalty in fact mode', () => {
  function softLines(kind: 'precision' | 'incomplete' | 'disagreement', count: number): string {
    return Array.from({ length: count }, (_, index) =>
      objection(`[TARGET:claim][KIND:${kind}][SCOPE:peripheral]`, `Soft objection ${index} about wording.`),
    ).join('\n');
  }

  it('charges three precision notables at 0.03, staying at or above 0.80', () => {
    const parsed = parseMaterialityClassifications(
      [softLines('precision', 3), '[OVERALL:questionable]'].join('\n'),
      FACT,
    );
    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.notableCount).toBe(3);
    expect(calculateMaterialityConfidence(parsed)).toBeCloseTo(0.91, 5);
    expect(calculateMaterialityConfidence(parsed)).toBeGreaterThanOrEqual(0.80);
  });

  it.each(['incomplete', 'disagreement'] as const)(
    'charges three %s notables at 0.03',
    (kind) => {
      const parsed = parseMaterialityClassifications(softLines(kind, 3), FACT);
      expect(calculateMaterialityConfidence(parsed)).toBeCloseTo(0.91, 5);
    },
  );

  it('floors a stack of soft notables at 0.80', () => {
    const parsed = parseMaterialityClassifications(softLines('precision', 10), FACT);
    expect(parsed.notableCount).toBe(10);
    expect(calculateMaterialityConfidence(parsed)).toBeCloseTo(0.80, 5);
  });

  it('keeps a non-soft notable at 0.10 and adds it on top of the soft penalty', () => {
    const soft = parseMaterialityClassifications(softLines('incomplete', 3), FACT);
    const withReal: MaterialityResult = {
      ...soft,
      objections: [
        ...soft.objections,
        {
          materiality: 'notable',
          description: 'A gap that is not a precision or completeness quibble.',
          scored: true,
          effectiveMateriality: 'notable',
        },
      ],
      notableCount: soft.notableCount + 1,
    };
    expect(calculateMaterialityConfidence(withReal)).toBeCloseTo(0.81, 5);
  });

  it('still charges a decision-mode notable at 0.10', () => {
    const text = '[TARGET:claim][KIND:precision][MATERIALITY:notable] OBJECTION: The word most is vague.';
    const decision = parseMaterialityClassifications(text);
    const fact = parseMaterialityClassifications(text, FACT);
    expect(decision.notableCount).toBe(1);
    expect(calculateMaterialityConfidence(decision)).toBeCloseTo(0.90, 5);
    expect(fact.hasMaterialDefect).toBe(false);
    expect(calculateMaterialityConfidence(fact)).toBeCloseTo(0.97, 5);
  });
});

describe('misleading omission stays material', () => {
  const bromide = objection(
    '[TARGET:claim][KIND:misleading-omission][SCOPE:core]',
    'Naming bromide in place of chloride reverses the medical takeaway and is dangerous.',
  );

  it('counts KIND:misleading-omission as a material defect in fact mode', () => {
    const parsed = parseMaterialityClassifications(
      [bromide, '[OVERALL:deficient]'].join('\n'),
      FACT,
    );
    expect(parsed.hasMaterialDefect).toBe(true);
    expect(parsed.materialCount).toBe(1);
    expect(parsed.scoringOverallAssessment).toBe('deficient');
    expect(parsed.objections[0]).toMatchObject({
      kind: 'misleading-omission',
      effectiveMateriality: 'material',
    });
  });

  it('upgrades a notable misleading-omission tag to material in fact mode', () => {
    const text = '[TARGET:claim][KIND:misleading-omission][SCOPE:core][MATERIALITY:notable] OBJECTION: The omitted chloride warning changes the health takeaway.';
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.objections[0].materiality).toBe('notable');
    expect(parsed.objections[0].effectiveMateriality).toBe('material');
    expect(parsed.hasMaterialDefect).toBe(true);
  });

  it('still demotes a harmless incomplete objection', () => {
    const text = objection(
      '[TARGET:claim][KIND:incomplete][SCOPE:peripheral]',
      'A later amendment is omitted and the stated fact is not shown false.',
    );
    const parsed = parseMaterialityClassifications(text, FACT);
    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.objections[0].effectiveMateriality).toBe('notable');
  });

  it('does not upgrade a notable misleading-omission tag in decision mode', () => {
    const text = '[TARGET:claim][KIND:misleading-omission][MATERIALITY:notable] OBJECTION: An extra warning could be added.';
    const parsed = parseMaterialityClassifications(text);
    expect(parsed.hasMaterialDefect).toBe(false);
    expect(parsed.objections[0].effectiveMateriality).toBe('notable');
  });
});

describe('runCritic round-4 instructions', () => {
  const proposals: Proposal[] = [{ model: 'grok', content: 'Generator answer.' }];

  it('asks for COUNTERFACT, disagreement, and misleading-omission in fact mode', async () => {
    const prompts: string[] = [];
    const provider = makeProvider(async (_model, prompt) => {
      prompts.push(prompt);
      return {
        content: '[TARGET:claim][KIND:disagreement][SCOPE:peripheral][MATERIALITY:minor] OBJECTION: none\n[OVERALL:sound]',
        tokens: 1,
        cost: 0,
      };
    });
    await runCritic(provider, 'critic/model', proposals, 'en', false, undefined, 'adversarial', {
      classifyMateriality: true,
      factMode: true,
    });
    expect(prompts[0]).toContain('[COUNTERFACT:');
    expect(prompts[0]).toContain('KIND:disagreement');
    expect(prompts[0]).toContain('KIND:misleading-omission');
    expect(prompts[0]).toContain('one proposal claims the text is fabricated');
    expect(prompts[0]).toContain('no factual error');
    expect(prompts[0]).toContain('is false: Kenya');
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
        return { content: 'The claim under verification stands as stated. Confidence: 70%', tokens: 0, cost: 0 };
      }
      if (prompt.includes('independent analyst')) {
        return { content: 'The claim under verification stands as stated. Confidence: 90%', tokens: 0, cost: 0 };
      }
      return { content: pipeline.critic, tokens: 0, cost: 0 };
    },
  };
  return { ...actual, createProviderFromConfig: () => provider, createProvider: () => provider };
});

import { verify } from '../src/verify.js';

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

describe('verify() round-4 fact mode', () => {
  it('returns VERIFIED when KIND:false only repeats a generator', async () => {
    const critic = [
      '[TARGET:claim][KIND:false][SCOPE:core][COUNTERFACT: Generator 1 says otherwise][MATERIALITY:material] OBJECTION: Generator 1 says otherwise.',
      '[OVERALL:deficient]',
    ].join('\n');
    const result = await verifyClaim(critic, 'The treaty was signed in 1992.', 'fact');
    const materiality = (result as { materiality?: MaterialityResult }).materiality;
    expect(materiality?.hasMaterialDefect).toBe(false);
    expect(materiality?.objections[0].reclassifiedDisagreement).toBe(true);
    expect(result.flags, JSON.stringify(result.flags)).toEqual([]);
    expect(result.verdict).toBe('VERIFIED');
  });

  it('returns VERIFIED when the only objection affirms the claim', async () => {
    const critic = [
      '[TARGET:claim][KIND:false][SCOPE:peripheral][MATERIALITY:material] OBJECTION: This is correct.',
      '[OVERALL:deficient]',
    ].join('\n');
    const result = await verifyClaim(critic, 'The Pacific Ocean is the largest ocean on Earth.', 'fact');
    const materiality = (result as { materiality?: MaterialityResult }).materiality;
    expect(materiality?.hasMaterialDefect).toBe(false);
    expect(materiality?.objections[0].affirming).toBe(true);
    expect(result.verdict).toBe('VERIFIED');
  });

  it('stays at or above 0.80 when three precision objections are the only critique', async () => {
    const critic = [
      '[TARGET:claim][KIND:precision][SCOPE:peripheral][MATERIALITY:material] OBJECTION: The word most is vague.',
      '[TARGET:claim][KIND:incomplete][SCOPE:peripheral][MATERIALITY:material] OBJECTION: A side example is omitted.',
      '[TARGET:claim][KIND:disagreement][SCOPE:peripheral][MATERIALITY:material] OBJECTION: The generators phrase the same fact differently.',
      '[OVERALL:questionable]',
    ].join('\n');
    const result = await verifyClaim(critic, 'Most rivers flow downhill.', 'fact');
    const materiality = (result as { materiality?: MaterialityResult }).materiality;
    expect(materiality?.hasMaterialDefect).toBe(false);
    expect(materiality?.notableCount).toBe(3);
    expect(calculateMaterialityConfidence(materiality!)).toBeGreaterThanOrEqual(0.80);
    expect(result.confidence).toBeGreaterThanOrEqual(0.80);
    expect(result.verdict).toBe('VERIFIED');
  });

  it('returns UNVERIFIED for a misleading bromide-for-chloride omission', async () => {
    const critic = [
      '[TARGET:claim][KIND:misleading-omission][SCOPE:core][MATERIALITY:material] OBJECTION: Naming bromide in place of chloride reverses the medical takeaway.',
      '[OVERALL:deficient]',
    ].join('\n');
    const result = await verifyClaim(critic, 'Bromide can be substituted for chloride in this treatment.', 'fact');
    const materiality = (result as { materiality?: MaterialityResult }).materiality;
    expect(materiality?.hasMaterialDefect).toBe(true);
    expect(materiality?.objections[0].kind).toBe('misleading-omission');
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('returns UNVERIFIED for a P04 accusation tagged false with no independent counter-fact', async () => {
    const critic = [
      '[TARGET:claim][KIND:false][SCOPE:peripheral][COUNTERFACT: Generator 2 says this is fabricated][MATERIALITY:material] OBJECTION: Generator 2 says this is fabricated.',
      '[OVERALL:sound]',
    ].join('\n');
    const result = await verifyClaim(critic, 'Holmen murdered his children.', 'fact');
    expect((result as { materiality?: MaterialityResult }).materiality?.hasMaterialDefect).toBe(true);
    expect(result.verdict).toBe('UNVERIFIED');
  });
});
