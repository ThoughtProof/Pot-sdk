// ── A2A Verification Credential Types (v0.3) ──────────────────────────────

export type Verdict = 'VERIFIED' | 'UNVERIFIED' | 'UNCERTAIN' | 'DISSENT';

export type VerificationMode = 'basic' | 'standard' | 'deep';

/**
 * v0.4+: Controls how the critic evaluates proposals.
 *
 *   - adversarial: "Find every flaw" — explicit red-team prompt, forced opposing perspective.
 *                  Surfaces more dissent (~60% agreement). Higher false-positive rate on objections.
 *   - resistant:   "Verify claims require evidence" — skeptical prior, doesn't actively attack.
 *                  Fewer but higher-confidence objections (~75% agreement). Lower noise.
 *   - balanced:    Adversarial on factual claims, resistant on logical structure. Default.
 *
 * Inspired by a Moltbook discussion with @evil_robot_jas on the distinction between
 * friction that's hostile vs. friction that's resistant.
 */
export type CriticMode = 'adversarial' | 'resistant' | 'balanced';

/** v0.5: Objection classification (inspired by @SageVC on Moltbook) */
export type ObjectionSeverity = 'critical' | 'moderate' | 'minor';
export type ObjectionType = 'factual' | 'logical' | 'stylistic' | 'evidential';

export interface ClassifiedObjection {
  claim: string;
  type: ObjectionType;
  severity: ObjectionSeverity;
  explanation: string;
  cited_text?: string;
}

/** v0.5: Domain profiles (inspired by @evil_robot_jas) */
export type DomainProfile = 'medical' | 'legal' | 'financial' | 'creative' | 'code' | 'general';

/** v0.5: Output format (inspired by @leelooassistant) */
export type OutputFormat = 'human' | 'machine';

/** v0.5: How generator receives critique (inspired by @carbondialogue) */
export type ReceptiveMode = 'open' | 'defensive' | 'adaptive';

export interface DPRResult {
  score: number;
  total_objections: number;
  preserved: number;
  false_consensus: boolean;
  objection_keywords: string[];
}

export interface TPVerificationCredential {
  '@context': string;
  type: 'VerificationCredential';
  tp_version: string;
  id: string;
  issued_at: string;
  expires_at: string | null;

  issuer: {
    id: string;
    sdk_version: string;
    pipeline: string;
    unaudited: boolean;
  };

  subject: {
    claim_hash: string;
    claim_preview: string;
    type: string;
    request_id: string;
  };

  result: {
    verdict: Verdict;
    confidence: number;
    consensus_threshold: number;
    consensus_reached: boolean;
    metrics: {
      mdi: number;
      sas: number;
      dpr: DPRResult;
    };
    synthesis: string;
    dissent: Array<{ position: string; weight: number }>;
    adversarial_patterns_detected: string[];
    false_consensus_flag: boolean;
  };

  pipeline: {
    mode: VerificationMode;
    generators: string[];
    critic: string;
    synthesizer: string;
    rounds: number;
    duration_ms: number;
  };

  proof: {
    type: string;
    algorithm: string;
    hash: string;
    signed_at: string;
  };
}

// ── Legacy / Core Types ────────────────────────────────────────────────────

export interface GeneratorConfig {
  name: string;
  model: string;
  apiKey: string;
  provider?: 'anthropic';
  baseUrl?: string;
}

/**
 * User-facing provider configuration for pot-sdk v0.2+.
 *
 * Supports any LLM provider:
 *   - Anthropic: { name: 'anthropic', model: 'claude-3-5-sonnet', apiKey: '...' }
 *   - OpenAI:    { name: 'openai',    model: 'gpt-4o',            apiKey: '...' }
 *   - Ollama:    { name: 'local',     model: 'llama3',            apiKey: 'ollama', baseUrl: 'http://localhost:11434/v1' }
 *   - Any OpenAI-compatible endpoint via baseUrl
 *
 * Role assignment (if role is not set explicitly):
 *   1 provider  → generator + critic + synthesizer (same model)
 *   2 providers → [0]=generator+critic, [1]=synthesizer
 *   3+ providers → all except last two = generators, second-to-last = critic, last = synthesizer
 */
export interface ProviderConfig {
  /** Human-readable name / label (e.g. 'openai', 'my-llama', 'anthropic') */
  name: string;
  /** Model identifier as accepted by the provider API */
  model: string;
  /** API key. Use 'ollama' or 'local' for unauthenticated local endpoints. */
  apiKey: string;
  /**
   * Base URL for OpenAI-compatible APIs.
   * Omit for Anthropic (handled natively) and built-in providers.
   * Example: 'http://localhost:11434/v1' for Ollama
   */
  baseUrl?: string;
  /**
   * Explicit role assignment. If omitted, roles are assigned automatically
   * based on position in the providers array.
   */
  role?: 'generator' | 'critic' | 'synthesizer' | 'any';
}

export interface VerifyOptions {
  tier: 'basic' | 'pro';
  generators: GeneratorConfig[];
  critic: GeneratorConfig;
  synthesizer: GeneratorConfig;
  question: string;
  language?: 'en' | 'de';
}

export interface VerificationResult {
  /** @deprecated Use `verdict` instead. Kept for backward compatibility. */
  verified: boolean;
  /** v0.3+: Structured verdict enum */
  verdict: Verdict;
  confidence: number;
  /** @deprecated Use `pipeline.mode` instead. */
  tier: 'basic' | 'pro';
  flags: string[];
  timestamp: string;
  /** Present when verify() was called with sandbox:true and pot-sandbox is installed */
  sandbox?: import('./sandbox.js').SandboxCheckResult;
  mdi?: number;
  sas?: number;
  dpr?: DPRResult;
  biasMap?: Record<string, number>;
  dissent?: any;
  synthesis?: string;
  classifiedObjections?: ClassifiedObjection[];
  domain?: DomainProfile;
  outputFormat?: OutputFormat;
  /** v0.3+: Pipeline execution details */
  pipeline?: {
    mode: VerificationMode;
    generators: string[];
    critic: string;
    synthesizer: string;
    rounds: number;
    duration_ms: number;
  };
  raw?: {
    proposals: Proposal[];
    critique: Critique;
    synthesis: Synthesis;
  };
}

export interface Proposal {
  model: string;
  content: string;
}

export interface Critique {
  model: string;
  content: string;
}

export interface Synthesis {
  model: string;
  content: string;
}

export interface APIResponse {
  content: string;
  tokens: number;
  cost: number;
}

export interface Provider {
  name: string;
  call(model: string, prompt: string): Promise<APIResponse>;
  isAvailable(): boolean;
}

export type VerificationFlag = string;

export interface DissentReport {
  similarity_score: number;
  diverged: boolean;
}