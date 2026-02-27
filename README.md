# pot-sdk

> **ThoughtProof SDK** — Multi-model verification for AI outputs

[![npm version](https://img.shields.io/npm/v/pot-sdk)](https://www.npmjs.com/package/pot-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The TypeScript/JavaScript SDK for the [ThoughtProof Protocol](https://thoughtproof.ai). Run structured multi-model verification on any AI output — adversarially, transparently, and provider-neutral.

## Why?

Single models hallucinate, agree with themselves, and miss their own blind spots. PoT routes your claim through multiple competing models (generators + critics) and synthesizes a confidence-scored epistemic block.

**Signing proves WHO. Multi-model adversarial verification proves WHAT.**

## Install

```bash
npm install pot-sdk
```

## Quick Start

```typescript
import { verify } from 'pot-sdk';

const result = await verify('GPT-4o claims the Eiffel Tower is 330m tall.', {
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    xai:       { apiKey: process.env.XAI_API_KEY },
    deepseek:  { apiKey: process.env.DEEPSEEK_API_KEY },
    moonshot:  { apiKey: process.env.MOONSHOT_API_KEY },
  }
});

console.log(result.confidence);    // 0.94
console.log(result.synthesis);     // "Claim is accurate. The Eiffel Tower..."
console.log(result.mdi);           // 0.87 — Model Diversity Index
console.log(result.sas);           // 0.91 — Synthesis Audit Score
```

## API

### `verify(claim, options)`

Run a standard verification (3 generators + 1 critic + 1 synthesizer).

### `deepAnalysis(claim, options)`

Full deep run with rotated synthesizers — use for strategic decisions.

### `createAttestation(result)`

Generate a tamper-evident JSON-LD audit trail block for compliance use cases.

### `pot.with_oversight(fn)`

Human-in-the-loop hook for EU AI Act Art. 12-14 compliance.

## Metrics

| Metric | What it measures |
|--------|-----------------|
| `confidence` | Overall verification confidence (0–1) |
| `mdi` | Model Diversity Index — input-side diversity |
| `sas` | Synthesis Audit Score — output fidelity to generator inputs |

## BYOK

Bring your own API keys. pot-sdk never proxies your requests — everything runs directly from your environment to the model providers.

## Supported Providers

Built-in: Anthropic, OpenAI, xAI, DeepSeek, Moonshot

Any OpenAI-compatible endpoint works via `baseUrl` (Ollama, Together.ai, custom deployments). BYOK — no keys bundled, everything runs on your infrastructure.

## Learn More

- [Protocol Specification](https://thoughtproof.ai)
- [pot-cli](https://github.com/ThoughtProof/pot-cli) — CLI version
- [Benchmarks](https://thoughtproof.ai/blog) — 96.7% adversarial detection, 92% hallucination detection

---

Built with the [ThoughtProof Protocol](https://thoughtproof.ai). MIT License.
