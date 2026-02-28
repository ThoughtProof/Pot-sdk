/**
 * @pot-sdk/friend tests
 * Uses Node.js built-in test runner (node:test) — no Vite/esbuild, no node:sqlite issues.
 *
 * Run with: node --experimental-sqlite --import tsx/esm tests/friend.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';

import { FriendMemoryStore } from '../src/memory.js';
import { shouldRaiseEyebrow, generateEyebrowCritique } from '../src/eyebrow.js';
import type { FriendMemory, FriendCriticResult } from '../src/types.js';

const TEST_DB = '.test-pot-friend.db';

function makeEntry(overrides: Partial<FriendMemory> = {}): FriendMemory {
  return {
    sessionId: 'test-session',
    claimHash: 'abc123',
    claim: 'The Earth is flat',
    verdict: 'Incorrect — overwhelming evidence for spherical Earth.',
    objections: ['no scientific basis', 'ignores satellite data'],
    confidence: 0.1,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── FriendMemoryStore ────────────────────────────────────────────────────────

describe('FriendMemoryStore', () => {
  let store: FriendMemoryStore;

  before(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new FriendMemoryStore(TEST_DB);
  });

  after(() => {
    store.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('saves and retrieves an entry', () => {
    const entry = makeEntry();
    store.save(entry);

    const results = store.getRecentBySession('test-session');
    assert.equal(results.length, 1);
    assert.equal(results[0].claim, entry.claim);
    assert.equal(results[0].confidence, entry.confidence);
    assert.deepEqual(results[0].objections, entry.objections);
  });

  it('isolates entries by sessionId', () => {
    store.save(makeEntry({ sessionId: 'session-A', claimHash: 'sa1' }));
    store.save(makeEntry({ sessionId: 'session-B', claimHash: 'sb1', claim: 'Water is dry' }));

    const a = store.getRecentBySession('session-A');
    const b = store.getRecentBySession('session-B');

    assert.ok(a.length >= 1);
    assert.ok(b.length >= 1);
    assert.ok(a.every((e) => e.sessionId === 'session-A'));
    assert.equal(b.find((e) => e.claim === 'Water is dry')?.claim, 'Water is dry');
  });

  it('respects the limit param in getRecentBySession', () => {
    const session = 'limit-test';
    for (let i = 0; i < 10; i++) {
      store.save(makeEntry({ sessionId: session, claimHash: `hash${i}`, claim: `Claim ${i}`, timestamp: Date.now() + i }));
    }

    const results = store.getRecentBySession(session, 3);
    assert.equal(results.length, 3);
  });

  it('returns recurring objections that appear 2+ times', () => {
    const session = 'recurring-test';
    store.save(makeEntry({ sessionId: session, claimHash: 'r1', objections: ['no scientific basis', 'ignores data'] }));
    store.save(makeEntry({ sessionId: session, claimHash: 'r2', objections: ['no scientific basis', 'cherry picking'] }));
    store.save(makeEntry({ sessionId: session, claimHash: 'r3', objections: ['cherry picking', 'overgeneralization'] }));

    const recurring = store.getRecurringObjections(session);
    assert.ok(recurring.includes('no scientific basis'), 'should include "no scientific basis"');
    assert.ok(recurring.includes('cherry picking'), 'should include "cherry picking"');
    assert.ok(!recurring.includes('overgeneralization'), 'should NOT include "overgeneralization"');
  });

  it('returns empty recurring objections for fresh session', () => {
    const recurring = store.getRecurringObjections('empty-session-xyz');
    assert.equal(recurring.length, 0);
  });

  it('getSimilarClaims returns low-confidence entries only', () => {
    const session = 'similar-test';
    store.save(makeEntry({ sessionId: session, claimHash: 'low1', confidence: 0.2 }));
    store.save(makeEntry({ sessionId: session, claimHash: 'high1', confidence: 0.9 }));

    const similar = store.getSimilarClaims('different-hash', session);
    assert.ok(similar.every((e) => e.confidence < 0.5));
    assert.ok(!similar.find((e) => e.confidence === 0.9));
  });
});

// ── shouldRaiseEyebrow ───────────────────────────────────────────────────────

describe('shouldRaiseEyebrow', () => {
  it('does NOT raise on a fresh session with no patterns', () => {
    const result = shouldRaiseEyebrow('The sky is blue', [], [], 0.15);
    assert.equal(result.raise, false);
  });

  it('raises when current claim overlaps with recurring patterns', () => {
    const result = shouldRaiseEyebrow(
      'Vaccines cause autism based on Andrew Wakefield study',
      ['vaccines cause autism wakefield study'],
      [],
      0.15,
    );
    assert.equal(result.raise, true);
    assert.ok(result.reason?.includes('recurring pattern'));
  });

  it('raises when current claim is similar to past low-confidence claims', () => {
    const pastClaim: FriendMemory = makeEntry({
      claim: 'Drinking bleach cures viruses because bleach kills viruses effectively',
      confidence: 0.05,
    });

    const result = shouldRaiseEyebrow(
      'Bleach solutions effectively treat and kill viruses in infections',
      [],
      [pastClaim],
      0.15,
    );
    assert.equal(result.raise, true);
    assert.ok(result.reason !== undefined);
  });

  it('does NOT raise when overlap is below threshold', () => {
    const pastClaim: FriendMemory = makeEntry({
      claim: 'Unicorns exist in Scotland officially',
      confidence: 0.1,
    });

    const result = shouldRaiseEyebrow(
      'Quantum entanglement enables faster communication',
      [],
      [pastClaim],
      0.15,
    );
    assert.equal(result.raise, false);
  });
});

// ── generateEyebrowCritique ──────────────────────────────────────────────────

describe('generateEyebrowCritique', () => {
  it('returns a short, low-key critique with past example', () => {
    const past = makeEntry({ claim: 'The Earth is flat', verdict: 'Definitively false.' });
    const critique = generateEyebrowCritique('The Earth has edges', 'similar to past claim', past);

    assert.ok(critique.includes('...really?'));
    assert.ok(critique.includes('The Earth is flat'));
    assert.ok(critique.includes('Definitively false'));
  });

  it('returns a critique without past example', () => {
    const critique = generateEyebrowCritique('Water is dry', 'recurring pattern: "water dry"');

    assert.ok(critique.includes('...really?'));
    assert.ok(critique.includes('familiar pattern'));
  });
});

// ── FriendCriticResult shape ─────────────────────────────────────────────────

describe('FriendCriticResult shape', () => {
  it('satisfies the expected interface shape for a non-eyebrow result', () => {
    const result: FriendCriticResult = {
      critique: 'Some critique text',
      isEyebrow: false,
      recurringPatterns: ['pattern one'],
      memoryUsed: 3,
    };

    assert.equal(typeof result.critique, 'string');
    assert.equal(typeof result.isEyebrow, 'boolean');
    assert.ok(Array.isArray(result.recurringPatterns));
    assert.equal(typeof result.memoryUsed, 'number');
  });

  it('accepts optional eyebrowReason for eyebrow mode results', () => {
    const result: FriendCriticResult = {
      critique: '...really?',
      isEyebrow: true,
      eyebrowReason: 'recurring pattern: "vaccines autism"',
      recurringPatterns: ['vaccines autism'],
      memoryUsed: 5,
    };

    assert.ok(result.eyebrowReason !== undefined);
    assert.equal(result.isEyebrow, true);
  });
});
