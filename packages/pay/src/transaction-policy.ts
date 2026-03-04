/**
 * TransactionPolicy — spending limits, address allowlists, verification thresholds
 * @pot-sdk2/pay v0.9.3
 */

export interface TransactionPolicyConfig {
  /** Max USD per single transaction */
  maxPerTransaction?: number;
  /** Max USD spent per calendar day */
  dailyCap?: number;
  /** If set, only these addresses are allowed (case-insensitive) */
  allowedAddresses?: string[];
  /** Always blocked addresses (case-insensitive) */
  blockedAddresses?: string[];
  /** Require reasoning verification above this USD amount (default: 50) */
  requireVerificationAbove?: number;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresVerification: boolean;
}

export class TransactionPolicy {
  private config: TransactionPolicyConfig;
  private dailySpend: Map<string, number> = new Map();

  constructor(config: TransactionPolicyConfig = {}) {
    this.config = {
      requireVerificationAbove: 50,
      ...config,
    };
  }

  check(tx: { to: string; amount: number }): PolicyCheckResult {
    const { to, amount } = tx;
    const threshold = this.config.requireVerificationAbove ?? 50;
    const requiresVerification = amount >= threshold;

    // 1. Blocked addresses
    if (this.config.blockedAddresses?.length) {
      const toLower = to.toLowerCase();
      if (this.config.blockedAddresses.some(a => a.toLowerCase() === toLower)) {
        return { allowed: false, reason: `Address ${to} is blocked`, requiresVerification };
      }
    }

    // 2. Allowlist check
    if (this.config.allowedAddresses?.length) {
      const toLower = to.toLowerCase();
      if (!this.config.allowedAddresses.some(a => a.toLowerCase() === toLower)) {
        return { allowed: false, reason: `Address ${to} is not in allowedAddresses`, requiresVerification };
      }
    }

    // 3. Per-transaction limit
    if (this.config.maxPerTransaction !== undefined && amount > this.config.maxPerTransaction) {
      return {
        allowed: false,
        reason: `Amount $${amount} exceeds maxPerTransaction ($${this.config.maxPerTransaction})`,
        requiresVerification,
      };
    }

    // 4. Daily cap
    if (this.config.dailyCap !== undefined) {
      const today = new Date().toISOString().slice(0, 10);
      const spent = this.dailySpend.get(today) ?? 0;
      if (spent + amount > this.config.dailyCap) {
        return {
          allowed: false,
          reason: `Daily cap ($${this.config.dailyCap}) would be exceeded. Already spent: $${spent}`,
          requiresVerification,
        };
      }
      // Record spend
      this.dailySpend.set(today, spent + amount);
    }

    return { allowed: true, requiresVerification };
  }

  /** Reset daily spend tracking (useful for testing) */
  resetDailySpend(): void {
    this.dailySpend.clear();
  }
}
