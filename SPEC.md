# pot-sdk v0.1 — Specification

## Overview

TypeScript SDK for the Proof of Thought (PoT) epistemic verification protocol.
Enables AI agents to verify other agents' outputs programmatically.

## Core API

```typescript
import { verify, deepAnalysis, createAttestation } from 'pot-sdk';

// Basic verification (Free Tier) — single model + critic
const result = await verify(output, {
  tier: 'basic',
  providers: { generator: 'openai', critic: 'anthropic' },
  apiKeys: { openai: '...', anthropic: '...' }
});
// Returns: { confidence: 0.82, flags: [...], tier: 'basic', verified: true }

// Pro verification — multi-model adversarial (4 generators, rotated roles)
const result = await verify(output, {
  tier: 'pro',
  providers: {
    generators: ['openai', 'anthropic', 'xai', 'deepseek'],
    critic: 'anthropic',
    synthesizer: 'anthropic'
  },
  apiKeys: { ... }
});
// Returns: { confidence: 0.967, flags: [...], tier: 'pro', mdi: 0.75, sas: 0.88, biasMap: {...}, verified: true }

// Deep Analysis — rotated synthesizer roles
const deep = await deepAnalysis(question, {
  runs: 3,
  providers: { ... },
  apiKeys: { ... }
});
// Returns: { convergence: [...], divergence: [...], metaConfidence: 0.78, biasMap: {...}, runs: [...] }

// Attestation — cryptographically signed verification certificate
const cert = await createAttestation(result, {
  signingKey: '...',
  format: 'jwt' // or 'json-ld'
});
// Returns: { token: '...', verifiable: true, schema: 'pot-attestation-v1' }
```

## Architecture

```
pot-sdk/
├── src/
│   ├── index.ts           # Main exports
│   ├── verify.ts          # Core verify() function
│   ├── deep.ts            # Deep analysis with rotations
│   ├── attestation.ts     # Cryptographic attestation
│   ├── providers/
│   │   ├── index.ts       # Provider registry
│   │   ├── openai.ts      # OpenAI provider
│   │   ├── anthropic.ts   # Anthropic provider
│   │   ├── xai.ts         # xAI/Grok provider
│   │   ├── deepseek.ts    # DeepSeek provider
│   │   ├── moonshot.ts    # Moonshot/Kimi provider
│   │   └── base.ts        # Base provider interface
│   ├── pipeline/
│   │   ├── generator.ts   # Generator phase
│   │   ├── critic.ts      # Critic phase
│   │   ├── evaluator.ts   # Evaluator phase
│   │   └── synthesizer.ts # Synthesizer phase
│   ├── metrics/
│   │   ├── mdi.ts         # Model Diversity Index
│   │   ├── sas.ts         # Synthesis Audit Score
│   │   └── confidence.ts  # Confidence calculation
│   ├── types.ts           # TypeScript type definitions
│   └── utils.ts           # Shared utilities
├── tests/
│   ├── verify.test.ts
│   ├── deep.test.ts
│   ├── attestation.test.ts
│   ├── providers.test.ts
│   └── metrics.test.ts
├── examples/
│   ├── basic-verify.ts    # Simple single-model verification
│   ├── pro-verify.ts      # Multi-model adversarial
│   ├── a2a-agent.ts       # Agent-to-agent verification example
│   └── attestation.ts     # Creating & verifying attestations
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
└── LICENSE                # MIT
```

## Design Principles

1. **BYOK (Bring Your Own Keys)** — No hosted service, all API calls go directly from user to provider
2. **Provider-Neutral** — Any LLM provider can be plugged in via the provider interface
3. **Tiered Verification** — Basic (free, 1 gen + 1 critic) and Pro (paid, 4 gen + rotated roles)
4. **Async/Promise-based** — All operations return Promises
5. **Zero Dependencies** (except provider SDKs) — Minimal footprint
6. **TypeScript-first** — Full type safety, but works in plain JS too
7. **Streaming Support** — Optional streaming for long-running verifications

## Provider Interface

```typescript
interface ProviderConfig {
  name: string;
  model: string;
  apiKey: string;
  baseUrl?: string; // For custom endpoints
}

interface Provider {
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  stream?(prompt: string, options?: GenerateOptions): AsyncIterable<string>;
}
```

## Verification Result Schema

```typescript
interface VerificationResult {
  verified: boolean;
  confidence: number;        // 0-1
  tier: 'basic' | 'pro';
  flags: VerificationFlag[];  // Issues found
  timestamp: string;          // ISO 8601
  
  // Pro-only metrics
  mdi?: number;              // Model Diversity Index (0-1)
  sas?: number;              // Synthesis Audit Score (0-1)
  biasMap?: BiasMap;         // Per-model bias analysis
  dissent?: DissentReport;   // Where models disagreed
  
  // Raw data (optional)
  raw?: {
    generators: GeneratorOutput[];
    critic: CriticOutput;
    synthesis: SynthesisOutput;
  };
}
```

## A2A Verification Credential (JSON Schema)

```json
{
  "$schema": "https://thoughtproof.ai/schemas/verification-credential-v1.json",
  "type": "PoTVerificationCredential",
  "version": "1.0",
  "issuer": "agent-id",
  "subject": "verified-output-hash",
  "issuanceDate": "2026-02-22T19:00:00Z",
  "verification": {
    "tier": "pro",
    "confidence": 0.967,
    "mdi": 0.75,
    "sas": 0.88,
    "providers": ["openai", "anthropic", "xai", "deepseek"],
    "blockNumber": 185
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-02-22T19:00:00Z",
    "proofPurpose": "assertionMethod",
    "verificationMethod": "did:key:...",
    "proofValue": "..."
  }
}
```

## Tech Stack

- **Runtime:** Node.js 18+
- **Language:** TypeScript 5.x
- **Build:** tsup (fast, zero-config)
- **Test:** vitest
- **Package Manager:** npm
- **Linting:** eslint + prettier
- **CI:** GitHub Actions

## What to Build (Priority Order)

1. **Provider abstraction** (base.ts + openai.ts + anthropic.ts)
2. **Basic verify()** — single generator + single critic
3. **Types & interfaces** — full TypeScript coverage
4. **Pro verify()** — multi-model with 4 generators
5. **MDI + SAS metrics**
6. **Deep analysis** with rotated roles
7. **Attestation** (JWT signing)
8. **Examples** (basic, pro, a2a)
9. **Tests** (unit + integration)
10. **README** with clear docs
11. **npm publish** config (package.json, tsup, etc.)

## Existing Reference

The pot-cli (v0.4.0) at `../pot-cli/` has working implementations of:
- Provider connections (OpenAI, Anthropic, xAI, DeepSeek, Moonshot)
- Pipeline logic (generate → critique → synthesize)
- MDI calculation
- Deep analysis with rotations
- Block storage

Use it as reference but build the SDK from scratch with cleaner architecture.
The SDK should be a library (importable), not a CLI.

## License

MIT — same as pot-cli.
