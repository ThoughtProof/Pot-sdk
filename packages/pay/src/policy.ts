/**
 * Tiered verification policy
 *
 * < $0.50    → skip    (no verification)
 * $0.50-$100 → async   (2 verifiers, background, don't block)
 * $100-$1000 → sync    (3 verifiers, block until done)
 * >= $1000   → sync+   (3 verifiers + tiebreaker on ANY flag)
 */

export type VerificationMode = 'skip' | 'async' | 'sync' | 'sync-plus';

export interface PolicyResult {
  mode: VerificationMode;
  minVerifiers: number;
  tiebreakerOnAnyFlag: boolean;
}

export function resolvePolicy(
  amount: number,
  policy: 'tiered' | 'always' | 'skip' = 'tiered'
): PolicyResult {
  if (policy === 'skip') return { mode: 'skip', minVerifiers: 0, tiebreakerOnAnyFlag: false };
  if (policy === 'always') return { mode: 'sync', minVerifiers: 3, tiebreakerOnAnyFlag: false };

  // Tiered
  if (amount < 0.50) return { mode: 'skip', minVerifiers: 0, tiebreakerOnAnyFlag: false };
  if (amount < 100)  return { mode: 'async', minVerifiers: 2, tiebreakerOnAnyFlag: false };
  if (amount < 1000) return { mode: 'sync', minVerifiers: 3, tiebreakerOnAnyFlag: false };
  
  // >= $1000: sync+ — 3 verifiers, but if ANY flags → call 4th as tiebreaker
  return { mode: 'sync-plus', minVerifiers: 3, tiebreakerOnAnyFlag: true };
}
