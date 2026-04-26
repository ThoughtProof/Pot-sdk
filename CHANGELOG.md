# Changelog

## v3.0.0-rc.1 — 2026-04-27

**Breaking:** Public verdict mapping fix per [ADR-0001 in pot-cli](https://github.com/ThoughtProof/pot-cli/blob/main/docs/adr/0001-verdict-model.md).

### What changed

| Internal verdict | Public verdict (v2.x) | Public verdict (v3.0) |
|---|---|---|
| `ALLOW` | `ALLOW` | `ALLOW` (unchanged) |
| `HOLD` | `BLOCK` ❌ | `UNCERTAIN` ✓ |
| `DISSENT` | `BLOCK` ❌ | `UNCERTAIN` ✓ |
| `UNCERTAIN` | `UNCERTAIN` | `UNCERTAIN` (unchanged) |

`severity_score` is now `null` for all current verdicts (was 0.30–0.65 for HOLD and 0.70–1.0 for DISSENT). It is reserved for future use when the engine emits an explicit hard-BLOCK internal verdict.

### Why

In v2.x, internal `HOLD` (an epistemic state — "we have moderate concerns but not enough evidence to definitively reject") was surfaced to API consumers as `BLOCK` ("definitively rejected"). This was a severity inversion that lost information consumers needed for human-review escalation.

`DISSENT` has the same fix for a different reason: mapping it to `BLOCK` lets a single contrarian model override a majority of approvers, which undermines the multi-model aggregation principle. UNCERTAIN with `dissent: true` metadata preserves the signal without giving any single model a veto.

Full rationale: pot-cli `docs/adr/0001-verdict-model.md`.

### Migration

If your code branched on `verdict === 'BLOCK'` to handle "human review needed" cases, switch to `verdict === 'UNCERTAIN'`:

```diff
- if (result.verdict === 'BLOCK') {
+ if (result.verdict === 'UNCERTAIN') {
    sendForHumanReview(result);
  }
```

If you consumed `severity_score` for HOLD or DISSENT cases: it is now `null`. Use the metadata flags (`review_needed`, `dissent`) and the internal trace fields if you need granular signal data.

### Safety-critical consumers

Per ADR-0001 §"Consumer-side recommendation": safety-critical consumers (medical dosing, financial-risk gating, access control over sensitive resources) **SHOULD** treat `dissent: true` and `review_needed: true` as `BLOCK` in their own policy layer:

```typescript
function applySafetyCriticalPolicy(result: PipelineResult) {
  if (result.verdict === 'BLOCK') return 'reject';
  if (result.verdict === 'UNCERTAIN' && (result.metadata?.dissent || result.metadata?.review_needed)) {
    return 'reject';  // promote epistemic uncertainty to hard block
  }
  return 'allow';
}
```

### What's coming next

- **v3.0.0**: stable release after PR-G2 lands `CONDITIONAL_ALLOW` support (`ALLOW + conditions: string[]`), aligning with pot-cli PR-E (#12).
- **PR-F** (pot-cli): deterministic count-based aggregator replacing the regex-based `extractMinorityPositions` heuristic. Pot-sdk's regex aggregator becomes a fallback, not the primary path.
