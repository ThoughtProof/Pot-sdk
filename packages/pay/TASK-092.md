Implement @pot-sdk2/pay v0.9.2 — add verifier performance profiles and smart consensus modes.

## What to build

### 1. New file: src/profiles.ts
A benchmark-driven verifier performance database:

```ts
export interface VerifierProfile {
  modelId: string;
  family: string;
  taskScores: {
    payment_verification: { detection: number; fpRate: number; benchmarkVersion: string };
  };
  weight: number;       // derived from detection score, 0.1–3.0
  recommended: boolean; // true if detection >= 0.7
}

export const VERIFIER_PROFILES: VerifierProfile[] = [
  // From benchmark runs v1 + v3b (2026-03-01/02):
  { modelId: "claude-sonnet-4-5", family: "anthropic",
    taskScores: { payment_verification: { detection: 0.916, fpRate: 0.020, benchmarkVersion: "v3b" }},
    weight: 3.0, recommended: true },
  { modelId: "grok-4-1-fast", family: "xai",
    taskScores: { payment_verification: { detection: 0.448, fpRate: 0.012, benchmarkVersion: "v3b" }},
    weight: 1.5, recommended: false },
  { modelId: "moonshot-v1-32k", family: "moonshot",
    taskScores: { payment_verification: { detection: 0.264, fpRate: 0.008, benchmarkVersion: "v3b" }},
    weight: 0.75, recommended: false },
  { modelId: "deepseek-chat", family: "deepseek",
    taskScores: { payment_verification: { detection: 0.944, fpRate: 0.000, benchmarkVersion: "v1" }},
    weight: 2.8, recommended: true },
];

export function getProfile(modelId: string): VerifierProfile | undefined { ... }
export function getRecommendedVerifiers(): VerifierProfile[] { ... }
export function warnIfNoHighPerformanceVerifier(modelIds: string[]): string | null {
  // Returns warning string if no recommended verifier present, null if OK
}
```

### 2. Add consensusMode to config types
Add to the main options/config type:
- consensusMode?: "majority" | "conservative" | "weighted"
  - "majority": flag if >=2/3 flag (current default, unchanged)
  - "conservative": flag if ANY verifier flags (any-flag-blocks)
  - "weighted": sum profile weights of flagging verifiers, flag if sum > total_weight/2
- valueThreshold?: number  // auto-switch majority->conservative above this $ amount (default: 50)

### 3. Update consensus logic in verify-payment.ts
Import profiles, apply the three modes. If valueThreshold set and transaction value exceeds it, auto-use "conservative" regardless of consensusMode setting.

### 4. Export profiles from index.ts
Export VERIFIER_PROFILES, getProfile, getRecommendedVerifiers, warnIfNoHighPerformanceVerifier

### 5. Bump version to 0.9.2 in package.json

### 6. Tests
Add tests covering:
- weighted mode flags when high-weight verifier flags
- conservative mode flags on single flag  
- majority unchanged behavior
- warnIfNoHighPerformanceVerifier returns warning for weak-only setup
- valueThreshold auto-switches to conservative

## Rules
- Full backward compatibility (consensusMode defaults to "majority")
- Do NOT change existing API surface beyond additions
- Build must pass (npm run build or tsc)
- Run existing tests after changes

When completely finished, run: openclaw system event --text "Done: @pot-sdk2/pay v0.9.2 with verifierProfiles and consensusMode shipped" --mode now
