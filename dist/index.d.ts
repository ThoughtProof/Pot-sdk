interface GeneratorConfig {
    name: string;
    model: string;
    apiKey: string;
    provider?: 'anthropic';
    baseUrl?: string;
}
interface VerifyOptions {
    tier: 'basic' | 'pro';
    generators: GeneratorConfig[];
    critic: GeneratorConfig;
    synthesizer: GeneratorConfig;
    question: string;
    language?: 'en' | 'de';
}
interface VerificationResult {
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
interface Proposal {
    model: string;
    content: string;
}
interface Critique {
    model: string;
    content: string;
}
interface Synthesis {
    model: string;
    content: string;
}
interface APIResponse {
    content: string;
    tokens: number;
    cost: number;
}
interface Provider {
    name: string;
    call(model: string, prompt: string): Promise<APIResponse>;
    isAvailable(): boolean;
}
type VerificationFlag = string;
interface DissentReport {
    similarity_score: number;
    diverged: boolean;
}

interface VerifyParams {
    tier?: 'basic' | 'pro';
    providers?: {
        generators?: string[];
        critic?: string;
        synthesizer?: string;
    };
    apiKeys: Record<string, string>;
    question: string;
    output?: string;
    language?: 'en' | 'de';
}
declare function verify(output: string, params: VerifyParams): Promise<VerificationResult>;

declare abstract class BaseProvider implements Provider {
    abstract name: string;
    protected apiKey?: string;
    protected baseUrl: string;
    constructor(apiKey?: string);
    abstract call(model: string, prompt: string): Promise<APIResponse>;
    isAvailable(): boolean;
    protected makeRequest(url: string, body: any, headers: Record<string, string>, timeoutMs?: number, maxRetries?: number): Promise<any>;
    protected estimateCost(tokens: number, model: string): number;
}

declare class AnthropicProvider extends BaseProvider {
    name: string;
    protected baseUrl: string;
    constructor(apiKey?: string, providerName?: string);
    call(model: string, prompt: string): Promise<APIResponse>;
}

declare class OpenAIProvider extends BaseProvider {
    name: string;
    protected baseUrl: string;
    constructor(apiKey?: string, baseUrl?: string, providerName?: string);
    call(model: string, prompt: string): Promise<APIResponse>;
}
declare class XAIProvider extends OpenAIProvider {
    name: string;
    constructor(apiKey?: string);
}
declare class MoonshotProvider extends OpenAIProvider {
    name: string;
    constructor(apiKey?: string);
}
declare class DeepSeekProvider extends OpenAIProvider {
    name: string;
    constructor(apiKey?: string);
}

declare function detectBaseUrl(providerName: string, model: string): string;
declare function createProvider(config: GeneratorConfig): Provider;

declare function deepAnalysis(question: string, options: any): Promise<VerificationResult>;

declare function createAttestation(result: any, options: {
    signingKey: string;
}): Promise<{
    token: string;
    verifiable: boolean;
    schema: string;
}>;

export { type APIResponse, AnthropicProvider, type Critique, DeepSeekProvider, type DissentReport, type GeneratorConfig, MoonshotProvider, OpenAIProvider, type Proposal, type Provider, type Synthesis, type VerificationFlag, type VerificationResult, type VerifyOptions, XAIProvider, createAttestation, createProvider, deepAnalysis, detectBaseUrl, verify };
