export interface GeneratorConfig {
  name: string;
  model: string;
  apiKey: string;
  provider?: 'anthropic';
  baseUrl?: string;
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
  verified: boolean;
  confidence: number;
  tier: 'basic' | 'pro';
  flags: string[];
  timestamp: string;
  mdi?: number;
  sas?: number;
  biasMap?: Record<string, number>;
  dissent?: any;
  raw: {
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