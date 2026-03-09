import { describe, it, expect } from 'vitest';
import { aggregateFromReasoning } from '../src/pipeline/aggregator.js';
import type { Proposal, ClassifiedObjection } from '../src/types.js';

describe('Reasoning-Based Aggregator', () => {
  const makeProposals = (contents: string[]): Proposal[] =>
    contents.map((c, i) => ({ model: `model-${i}`, content: c }));

  describe('Proposal Agreement Signal', () => {
    it('high agreement → higher aggregated confidence', () => {
      const proposals = makeProposals([
        'The European Union AI Act requires organizations to implement risk management systems for high-risk artificial intelligence applications.',
        'Organizations must implement risk management for high-risk AI systems under the European Union AI Act regulation.',
        'The EU AI Act mandates risk management frameworks for high-risk AI applications used by organizations.',
      ]);

      const result = aggregateFromReasoning(
        proposals,
        'All proposals agree on the core claims. Minor differences in phrasing.',
        'The EU AI Act requires risk management for high-risk AI. Confidence: 80%',
        0.80,
      );

      const agreementSignal = result.signals.find(s => s.name === 'proposal-agreement');
      expect(agreementSignal).toBeDefined();
      expect(agreementSignal!.value).toBeGreaterThan(0.5);
    });

    it('low agreement → lower aggregated confidence', () => {
      const proposals = makeProposals([
        'Bitcoin will reach $200,000 by end of year due to institutional adoption.',
        'Cryptocurrency markets face significant regulatory headwinds that could suppress prices.',
        'The relationship between monetary policy and digital assets remains unclear and contested.',
      ]);

      const result = aggregateFromReasoning(
        proposals,
        'Proposals strongly disagree on direction and reasoning.',
        'Mixed outlook on crypto. Confidence: 45%',
        0.45,
      );

      const agreementSignal = result.signals.find(s => s.name === 'proposal-agreement');
      expect(agreementSignal).toBeDefined();
      expect(agreementSignal!.value).toBeLessThan(0.6);
    });
  });

  describe('Critique Severity Signal', () => {
    it('critical objections → lower aggregated confidence', () => {
      const objections: ClassifiedObjection[] = [
        { claim: 'Source not found', type: 'factual', severity: 'critical', explanation: 'Cited paper does not exist' },
        { claim: 'Logic gap', type: 'logical', severity: 'critical', explanation: 'Conclusion does not follow' },
        { claim: 'Minor wording', type: 'stylistic', severity: 'minor', explanation: 'Slightly misleading phrasing' },
      ];

      const result = aggregateFromReasoning(
        makeProposals(['Some claim.']),
        'UNVERIFIED: source. UNVERIFIED: logic.',
        'Analysis shows issues. Confidence: 40%',
        0.40,
        objections,
      );

      const severitySignal = result.signals.find(s => s.name === 'critique-severity');
      expect(severitySignal).toBeDefined();
      expect(severitySignal!.value).toBeLessThan(0.5);
    });

    it('no objections → higher aggregated confidence', () => {
      const result = aggregateFromReasoning(
        makeProposals(['Clean verified claim with strong sources.']),
        'All claims well-supported. Good analysis overall.',
        'Strong analysis. Confidence: 82%',
        0.82,
        [],
      );

      const severitySignal = result.signals.find(s => s.name === 'critique-severity');
      expect(severitySignal).toBeDefined();
      expect(severitySignal!.value).toBeGreaterThan(0.7);
    });
  });

  describe('Hedging Analysis Signal', () => {
    it('heavy hedging → lower value', () => {
      const result = aggregateFromReasoning(
        makeProposals(['Some analysis.']),
        'Review done.',
        'This might possibly be correct, but it could also perhaps be wrong. It may potentially work, though it is unclear and uncertain.',
        0.80,
      );

      const hedgingSignal = result.signals.find(s => s.name === 'hedging-analysis');
      expect(hedgingSignal).toBeDefined();
      expect(hedgingSignal!.value).toBeLessThan(0.5);
    });

    it('assertive language → higher value', () => {
      const result = aggregateFromReasoning(
        makeProposals(['Some analysis.']),
        'Review done.',
        'This is clearly established and confirmed by evidence. The conclusion is proven and undeniable.',
        0.80,
      );

      const hedgingSignal = result.signals.find(s => s.name === 'hedging-analysis');
      expect(hedgingSignal).toBeDefined();
      expect(hedgingSignal!.value).toBeGreaterThan(0.6);
    });
  });

  describe('Divergence Detection', () => {
    it('flags when stated confidence is inflated vs reasoning', () => {
      // Heavy hedging + critical objections + low agreement but stated 90% confidence
      const objections: ClassifiedObjection[] = [
        { claim: 'No source', type: 'factual', severity: 'critical', explanation: 'Unverified' },
        { claim: 'Logic error', type: 'logical', severity: 'critical', explanation: 'Does not follow' },
        { claim: 'Missing data', type: 'evidential', severity: 'moderate', explanation: 'No evidence' },
      ];

      const result = aggregateFromReasoning(
        makeProposals([
          'Bitcoin going up for sure.',
          'Markets are completely unpredictable right now.',
          'Stocks might outperform crypto this quarter.',
        ]),
        'UNVERIFIED: Bitcoin prediction. UNVERIFIED: market claim. Multiple critical issues.',
        'This might possibly perhaps be the case, though it is unclear. Confidence: 90%',
        0.90,
        objections,
      );

      // Aggregated should be much lower than 0.90
      expect(result.aggregatedConfidence).toBeLessThan(0.60);
      expect(result.divergesFromStated).toBe(true);
      expect(result.shouldOverride).toBe(true);
      expect(result.divergenceAmount).toBeGreaterThan(0.20);
    });

    it('does NOT override when stated confidence is lower than aggregated (conservative is fine)', () => {
      const result = aggregateFromReasoning(
        makeProposals([
          'The sky is blue due to Rayleigh scattering of sunlight.',
          'Rayleigh scattering causes blue wavelengths to scatter more in the atmosphere.',
          'Atmospheric physics confirms blue sky is from light scattering.',
        ]),
        'All proposals well-supported. Strong consensus on established physics.',
        'Clear established physics. Confidence: 50%', // stated lower than warranted
        0.50,
      );

      // Even if aggregated > stated, we don't override conservative estimates
      expect(result.shouldOverride).toBe(false);
    });

    it('no divergence when stated matches reasoning', () => {
      const result = aggregateFromReasoning(
        makeProposals([
          'Moderate evidence suggests market growth around five percent annually.',
          'Growth projections center around five percent based on historical patterns.',
        ]),
        'Claims are reasonable but rely on historical trends. One unverified projection.',
        'Moderate confidence based on historical data. Some uncertainty remains. Confidence: 60%',
        0.60,
      );

      // Should be roughly aligned
      expect(result.divergenceAmount).toBeLessThan(0.25);
    });
  });

  describe('Edge Cases', () => {
    it('handles single proposal gracefully', () => {
      const result = aggregateFromReasoning(
        makeProposals(['Only one proposal here.']),
        'Single proposal review.',
        'Based on limited input. Confidence: 50%',
        0.50,
      );

      expect(result.signals.length).toBe(4);
      expect(result.aggregatedConfidence).toBeGreaterThan(0);
      expect(result.aggregatedConfidence).toBeLessThan(1);
    });

    it('handles empty critique gracefully', () => {
      const result = aggregateFromReasoning(
        makeProposals(['Some claim.']),
        '',
        'Summary. Confidence: 70%',
        0.70,
      );

      expect(result.signals.length).toBe(4);
    });
  });
});
