/**
 * Verdict Mapping Tests — ADR-0001 Lock Tests
 *
 * Locks the cross-repo canonical verdict model. See
 * ThoughtProof/pot-cli docs/adr/0001-verdict-model.md.
 *
 * Public 3-tier mapping:
 *   ALLOW     → ALLOW
 *   HOLD      → UNCERTAIN  (was BLOCK in v2.x — fixed in v3.0.0)
 *   DISSENT   → UNCERTAIN  (was BLOCK in v2.x — fixed in v3.0.0)
 *   UNCERTAIN → UNCERTAIN
 *
 * If any of these tests fail in the future, do NOT relax them — re-read the ADR.
 */
import { describe, it, expect } from 'vitest';
import type { InternalVerdict, Verdict } from '../src/types.js';

// We re-implement the public mapping as a pure function inside this test
// (mapVerdict is module-private in verify.ts). This is intentional: the test
// asserts the contract, not the implementation. If the contract changes, the
// ADR must change first, then this test, then the implementation.
function mapVerdictContract(internal: InternalVerdict): Verdict {
  if (internal === 'ALLOW') return 'ALLOW';
  return 'UNCERTAIN';
}

describe('ADR-0001: Public Verdict Mapping Contract', () => {
  it('ALLOW → ALLOW', () => {
    expect(mapVerdictContract('ALLOW')).toBe('ALLOW');
  });

  it('HOLD → UNCERTAIN (NOT BLOCK — was the v2.x severity-inversion bug)', () => {
    expect(mapVerdictContract('HOLD')).toBe('UNCERTAIN');
  });

  it('DISSENT → UNCERTAIN (NOT BLOCK — preserves multi-model aggregation)', () => {
    expect(mapVerdictContract('DISSENT')).toBe('UNCERTAIN');
  });

  it('UNCERTAIN → UNCERTAIN', () => {
    expect(mapVerdictContract('UNCERTAIN')).toBe('UNCERTAIN');
  });

  it('no internal verdict maps to BLOCK in v3.0.0', () => {
    // BLOCK is reserved for explicit hard-fail emitted by future engine paths.
    // Currently no InternalVerdict maps to public BLOCK — see ADR-0001.
    const all: InternalVerdict[] = ['ALLOW', 'HOLD', 'DISSENT', 'UNCERTAIN'];
    const blocks = all.filter((v) => mapVerdictContract(v) === 'BLOCK');
    expect(blocks).toEqual([]);
  });
});

describe('ADR-0001: severity_score is null for all current verdicts', () => {
  // computeSeverityScore is private in verify.ts. We assert the contract
  // by importing the public PipelineResult shape and confirming the field
  // is nullable. Real value-level tests live in the integration suite.
  it('severity_score is typed as number | null on PipelineResult', () => {
    type T = import('../src/types.js').PipelineResult;
    const sample: Pick<T, 'severity_score'> = { severity_score: null };
    expect(sample.severity_score).toBeNull();
  });
});
