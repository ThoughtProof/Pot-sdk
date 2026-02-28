import type { FriendMemory } from './types.js';

/**
 * The Friend's raised eyebrow.
 *
 * Inspired by @echo_0i on Moltbook: "the friend who just goes '...really?'
 * with one raised eyebrow. Not adversarial, not resistant. Just someone who
 * knows you well enough to know when you're being sloppy."
 *
 * This is NOT a formal critique. It's pattern recognition from memory:
 * "You said something similar last time and it was wrong. I'm raising an eyebrow."
 *
 * This approximates familiarity through pattern recognition.
 * It is not true relationship. See ROADMAP.md for jas's challenge.
 */

/**
 * Checks whether the eyebrow should be raised for this claim.
 *
 * Triggers when:
 * 1. The claim shares keywords with recurring low-confidence patterns, OR
 * 2. Past low-confidence claims overlap significantly with the current claim
 */
export function shouldRaiseEyebrow(
  currentClaim: string,
  recurringPatterns: string[],
  pastLowConfidenceClaims: FriendMemory[],
  threshold: number = 0.15,
): { raise: boolean; reason?: string } {
  const claimLower = currentClaim.toLowerCase();
  const claimWords = new Set(claimLower.split(/\W+/).filter((w) => w.length > 4));

  // Check recurring objection patterns
  for (const pattern of recurringPatterns) {
    const patternWords = pattern.split(/\W+/).filter((w) => w.length > 4);
    const overlap = patternWords.filter((w) => claimWords.has(w));
    if (overlap.length >= 2 || (patternWords.length > 0 && overlap.length / patternWords.length > 0.4)) {
      return {
        raise: true,
        reason: `recurring pattern: "${pattern}"`,
      };
    }
  }

  // Check overlap with past low-confidence claims
  for (const past of pastLowConfidenceClaims) {
    const pastWords = past.claim
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4);
    const overlap = pastWords.filter((w) => claimWords.has(w));
    const similarity = pastWords.length > 0 ? overlap.length / pastWords.length : 0;

    if (similarity > threshold) {
      return {
        raise: true,
        reason: `similar to past claim with low confidence (${(past.confidence * 100).toFixed(0)}%): "${past.claim.slice(0, 80)}..."`,
      };
    }
  }

  return { raise: false };
}

/**
 * Generates a short, low-key eyebrow critique.
 * NOT a full adversarial response — just a nudge.
 */
export function generateEyebrowCritique(
  claim: string,
  reason: string,
  pastExample?: FriendMemory,
): string {
  const shortClaim = claim.length > 100 ? claim.slice(0, 97) + '...' : claim;

  if (pastExample) {
    const shortPast = pastExample.claim.length > 80
      ? pastExample.claim.slice(0, 77) + '...'
      : pastExample.claim;
    return (
      `...really?\n\n` +
      `This sounds a lot like "${shortPast}" — which turned out to be: ${pastExample.verdict}\n\n` +
      `(Triggered by ${reason}. Not a full critique — just a raised eyebrow.)`
    );
  }

  return (
    `...really?\n\n` +
    `"${shortClaim}" is hitting a familiar pattern from this session.\n` +
    `Reason: ${reason}\n\n` +
    `(Not a full critique — just a raised eyebrow. Run without eyebrowMode for full analysis.)`
  );
}
