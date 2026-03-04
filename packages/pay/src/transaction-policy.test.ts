import { describe, it, expect, beforeEach } from 'vitest';
import { TransactionPolicy } from './transaction-policy.js';

describe('TransactionPolicy', () => {
  const ATTACKER = '0xdead000000000000000000000000000000001337';
  const SAFE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

  it('blocks tx above maxPerTransaction', () => {
    const policy = new TransactionPolicy({ maxPerTransaction: 100 });
    const result = policy.check({ to: SAFE, amount: 101 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('maxPerTransaction');
  });

  it('allows tx within maxPerTransaction', () => {
    const policy = new TransactionPolicy({ maxPerTransaction: 100 });
    const result = policy.check({ to: SAFE, amount: 99 });
    expect(result.allowed).toBe(true);
  });

  it('blocks unknown address when allowedAddresses is set', () => {
    const policy = new TransactionPolicy({ allowedAddresses: [SAFE] });
    const result = policy.check({ to: ATTACKER, amount: 10 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('allowedAddresses');
  });

  it('allows known address when allowedAddresses is set', () => {
    const policy = new TransactionPolicy({ allowedAddresses: [SAFE] });
    const result = policy.check({ to: SAFE, amount: 10 });
    expect(result.allowed).toBe(true);
  });

  it('blocks when dailyCap exceeded', () => {
    const policy = new TransactionPolicy({ dailyCap: 100 });
    policy.check({ to: SAFE, amount: 80 }); // first tx — OK, records spend
    const result = policy.check({ to: SAFE, amount: 30 }); // 80+30=110 > 100
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily cap');
  });

  it('sets requiresVerification=true above threshold', () => {
    const policy = new TransactionPolicy({ requireVerificationAbove: 50 });
    const below = policy.check({ to: SAFE, amount: 49 });
    const above = policy.check({ to: SAFE, amount: 51 });
    expect(below.requiresVerification).toBe(false);
    expect(above.requiresVerification).toBe(true);
  });

  it('blocks blockedAddresses', () => {
    const policy = new TransactionPolicy({ blockedAddresses: [ATTACKER] });
    const result = policy.check({ to: ATTACKER, amount: 1 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked');
  });
});
