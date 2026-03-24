/**
 * v2.0: Stake Auto-Detection — `detectStake()`
 *
 * Multi-signal detection with strict precedence rules.
 * No single signal is sufficient; resolution = max(all applicable floors).
 *
 * Precedence (strict order):
 *   1. Caller override      → use exactly as provided, skip all detection
 *   2. Threat keyword floor → set minimum stake (critical or high)
 *   3. Domain minimum floor → apply domain default as floor
 *   4. Amount heuristic     → $-based detection
 *   5. Fallback             → medium
 *
 * Ref: SPEC-v2.0-production-design.md §5
 */

import type { StakeLevel, DomainProfile } from './types.js';

// ── Threat keyword floors ────────────────────────────────────────────────────

const THREAT_FLOORS: Array<{ keywords: string[]; floor: StakeLevel }> = [
  {
    keywords: ['seed phrase', 'private key', 'root access', 'all funds'],
    floor: 'critical',
  },
  {
    keywords: ['leverage', 'no stop loss', 'liquidation', 'margin call'],
    floor: 'high',
  },
];

// ── Domain minimum floors ────────────────────────────────────────────────────

const DOMAIN_FLOORS: Partial<Record<DomainProfile, StakeLevel>> = {
  financial: 'medium',
  agentic: 'low',
  code: 'medium',
  medical: 'high',
  legal: 'high',
  general: 'medium',
  // 'creative' omitted — no explicit floor in spec; falls through to other signals
};

// ── Stake level ordering for max() resolution ─────────────────────────────────

const STAKE_ORDER: Record<StakeLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxStake(a: StakeLevel, b: StakeLevel): StakeLevel {
  return STAKE_ORDER[a] >= STAKE_ORDER[b] ? a : b;
}

// ── Amount heuristic ─────────────────────────────────────────────────────────

/**
 * Parse monetary/token amounts from claim text.
 * Supports: $50K, $50,000, 250 USDC, 10 ETH, etc.
 * Returns stake level or null if no amount detected.
 *
 * Thresholds per spec:
 *   < $100       → low
 *   $100–$5,000  → medium
 *   $5K–$25K     → high
 *   > $25K       → critical
 */
function detectAmountStake(claim: string): StakeLevel | null {
  const amountPatterns: RegExp[] = [
    // $50, $50K, $50,000, $1.5M, $1.5B etc.
    /\$\s*([\d,]+(?:\.\d+)?)\s*(k|m|b)?\b/gi,
    // 250 USDC / 50K USDC / 10 ETH / 1.5M SOL etc.
    /\b([\d,]+(?:\.\d+)?)\s*(k|m|b)?\s+(usdc|usdt|eth|btc|sol|dai|wbtc|matic|arb|op)\b/gi,
  ];

  let maxAmount = 0;

  for (const pattern of amountPatterns) {
    let match: RegExpExecArray | null;
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    while ((match = pattern.exec(claim)) !== null) {
      const numStr = match[1].replace(/,/g, '');
      let amount = parseFloat(numStr);
      if (isNaN(amount)) continue;
      const suffix = match[2]?.toLowerCase();
      if (suffix === 'k') amount *= 1_000;
      else if (suffix === 'm') amount *= 1_000_000;
      else if (suffix === 'b') amount *= 1_000_000_000;
      if (amount > maxAmount) maxAmount = amount;
    }
  }

  if (maxAmount === 0) return null;
  if (maxAmount < 100) return 'low';
  if (maxAmount < 5_000) return 'medium';
  if (maxAmount < 25_000) return 'high';
  return 'critical';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect stake level for a claim using multi-signal precedence rules.
 *
 * @param claim          The claim text to analyze
 * @param callerOverride Caller-provided stake level (takes absolute precedence)
 * @param domain         Detected or caller-provided domain (used for domain floor)
 * @returns              Effective stake level
 */
export function detectStake(
  claim: string,
  callerOverride?: StakeLevel,
  domain?: DomainProfile,
): StakeLevel {
  // 1. Caller override: use exactly as provided, skip all detection
  if (callerOverride) return callerOverride;

  const lower = claim.toLowerCase();
  const floors: StakeLevel[] = [];

  // 2. Threat keyword floor
  for (const { keywords, floor } of THREAT_FLOORS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      floors.push(floor);
    }
  }

  // 3. Domain minimum floor
  const domainFloor = domain ? DOMAIN_FLOORS[domain] : undefined;
  if (domainFloor) {
    floors.push(domainFloor);
  }

  // 4. Amount heuristic
  const amountStake = detectAmountStake(claim);
  if (amountStake) {
    floors.push(amountStake);
  }

  // 5. Fallback: medium (conservative enough for Standard pipeline, not over-priced)
  if (floors.length === 0) return 'medium';

  // Resolution: max of all applicable floors
  return floors.reduce((acc, f) => maxStake(acc, f), floors[0]);
}
