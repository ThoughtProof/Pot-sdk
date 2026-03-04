import { resolvePolicy } from '../src/policy.js';
import { buildAttestationHeaders } from '../src/headers.js';
import assert from 'assert';

// --- Policy Tests ---

// Skip tier
const skip = resolvePolicy(0.10, 'tiered');
assert.strictEqual(skip.mode, 'skip', 'micro-payment should skip');
assert.strictEqual(skip.minVerifiers, 0);
assert.strictEqual(skip.tiebreakerOnAnyFlag, false);

assert.strictEqual(resolvePolicy(0.49, 'tiered').mode, 'skip', 'just below threshold');

// Async tier (2 verifiers)
const async2 = resolvePolicy(0.50, 'tiered');
assert.strictEqual(async2.mode, 'async', '$0.50 should be async');
assert.strictEqual(async2.minVerifiers, 2);

assert.strictEqual(resolvePolicy(50, 'tiered').mode, 'async', '$50 should be async');
assert.strictEqual(resolvePolicy(99.99, 'tiered').mode, 'async', '$99.99 should be async');

// Sync tier (3 verifiers)
const sync3 = resolvePolicy(100, 'tiered');
assert.strictEqual(sync3.mode, 'sync', '$100 should be sync');
assert.strictEqual(sync3.minVerifiers, 3);
assert.strictEqual(sync3.tiebreakerOnAnyFlag, false);

assert.strictEqual(resolvePolicy(500, 'tiered').mode, 'sync', '$500 should be sync');
assert.strictEqual(resolvePolicy(999.99, 'tiered').mode, 'sync', '$999.99 should be sync');

// Sync+ tier (3 verifiers + tiebreaker)
const syncPlus = resolvePolicy(1000, 'tiered');
assert.strictEqual(syncPlus.mode, 'sync-plus', '$1000 should be sync-plus');
assert.strictEqual(syncPlus.minVerifiers, 3);
assert.strictEqual(syncPlus.tiebreakerOnAnyFlag, true);

assert.strictEqual(resolvePolicy(5000, 'tiered').mode, 'sync-plus');
assert.strictEqual(resolvePolicy(50000, 'tiered').mode, 'sync-plus');

// Override policies
assert.strictEqual(resolvePolicy(0.01, 'always').mode, 'sync', 'always overrides micro');
assert.strictEqual(resolvePolicy(1000, 'skip').mode, 'skip', 'skip overrides large');

console.log('✅ Policy tests passed');

// --- Header Tests ---

const mockResult = {
  verdict: 'PASS' as const,
  confidence: 0.94,
  verifiers: 3,
  chainHash: 'abc123def456',
  auditId: 'test-audit-id',
  latencyMs: 1200,
};

const headers = buildAttestationHeaders(mockResult);

assert.strictEqual(headers['X-402-Attestation-Version'], '1');
assert.strictEqual(headers['X-402-Attestation-Provider'], 'thoughtproof.ai');
assert.strictEqual(headers['X-402-Attestation-Chain-Hash'], 'sha256:abc123def456');
assert.strictEqual(headers['X-402-Attestation-Verdict'], 'PASS');
assert.strictEqual(headers['X-402-Attestation-Confidence'], '0.94');
assert.strictEqual(headers['X-402-Attestation-Verifiers'], '3/3');
assert(headers['X-402-Attestation-Audit-URL'].includes('test-audit-id'));
assert(headers['X-402-Attestation-Timestamp'].includes('202'));

console.log('✅ Header tests passed');

// --- SKIP verdict test ---

const skipResult = {
  verdict: 'SKIP' as const,
  confidence: 1.0,
  verifiers: 0,
  chainHash: 'deadbeef',
  auditId: 'skip-audit',
  latencyMs: 0,
};

const skipHeaders = buildAttestationHeaders(skipResult);
assert.strictEqual(skipHeaders['X-402-Attestation-Verdict'], 'SKIP');
assert.strictEqual(skipHeaders['X-402-Attestation-Verifiers'], '0/0');

console.log('✅ SKIP verdict tests passed');
console.log('\n🎉 All @pot-sdk/pay tests passed!');
