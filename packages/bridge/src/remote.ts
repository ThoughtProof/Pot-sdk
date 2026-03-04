/**
 * @pot-sdk2/bridge — Remote Verification via ThoughtProof API
 *
 * Adds a `verify()` function that supports two modes:
 * - 'local'  — multi-model verification using local API keys (default pot-sdk behavior)
 * - 'remote' — delegates to thoughtproof-api.vercel.app and returns a signed receipt
 *
 * @example
 * // Remote mode — requires ThoughtProof API key
 * const receipt = await verify({
 *   claim: "Transfer $500 to vendor — invoice matches PO #4421",
 *   context: "Payment agent",
 *   mode: 'remote',
 *   apiKey: 'tp_op_YOUR_KEY',
 * });
 * if (receipt.verdict === 'PASS') { proceed(); }
 *
 * @example
 * // Local mode — uses your own LLM API keys
 * const receipt = await verify({
 *   claim: "Transfer $500 to vendor",
 *   mode: 'local',
 *   models: [{ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: '...' }],
 * });
 */

export const THOUGHTPROOF_API_URL = 'https://thoughtproof-api.vercel.app';

// ─── Types ───────────────────────────────────────────────────────────────────

export type VerifyMode = 'remote' | 'local';
export type Verdict = 'PASS' | 'FAIL' | 'UNCERTAIN';

export interface VerifierResult {
  model: string;
  verdict: Verdict;
  confidence: number;
  reasoning?: string;
}

export interface VerificationReceipt {
  receipt_id: string;
  verdict: Verdict;
  confidence: number;
  signed_at: string;
  signature: string;
  verifier_count: number;
  verifiers: VerifierResult[];
  receipt_url: string;
  /** Mode used for this verification */
  mode: VerifyMode;
}

export interface RemoteVerifyOptions {
  /** The reasoning chain or conclusion to verify */
  claim: string;
  /** Background context for the verifiers */
  context?: string;
  /** Use 'remote' to call ThoughtProof API, 'local' for local multi-model verification */
  mode: 'remote';
  /** ThoughtProof API key (tp_op_...) — required for remote mode */
  apiKey: string;
  /** Optional agent ID to track trust score history */
  agentId?: string;
  /** Verifier models. Default: ['claude-sonnet-4-5', 'grok-4-1-fast'] */
  models?: string[];
  /** Custom API endpoint. Defaults to https://thoughtproof-api.vercel.app */
  endpoint?: string;
}

export interface LocalModelConfig {
  provider: 'anthropic' | 'openai' | 'xai' | 'moonshot' | 'deepseek';
  model: string;
  apiKey: string;
}

export interface LocalVerifyOptions {
  /** The reasoning chain or conclusion to verify */
  claim: string;
  /** Background context for the verifiers */
  context?: string;
  /** Use 'local' to run verification with your own API keys */
  mode: 'local';
  /** Verifier models with their API keys */
  models: LocalModelConfig[];
  /** Optional agent ID for tracking */
  agentId?: string;
}

export type VerifyOptions = RemoteVerifyOptions | LocalVerifyOptions;

// ─── Remote Verification ────────────────────────────────────────────────────

async function verifyRemote(options: RemoteVerifyOptions): Promise<VerificationReceipt> {
  const endpoint = options.endpoint ?? THOUGHTPROOF_API_URL;
  const url = `${endpoint}/v1/verify`;

  const body: Record<string, unknown> = {
    claim: options.claim,
  };
  if (options.context) body.context = options.context;
  if (options.agentId) body.agent_id = options.agentId;
  if (options.models) body.models = options.models;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': '@pot-sdk2/bridge',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ThoughtProof API error ${response.status}: ${error}`);
  }

  const data = await response.json() as Omit<VerificationReceipt, 'mode'>;
  return { ...data, mode: 'remote' };
}

// ─── Local Verification ─────────────────────────────────────────────────────

async function verifyLocal(options: LocalVerifyOptions): Promise<VerificationReceipt> {
  const results: VerifierResult[] = await Promise.allSettled(
    options.models.map(model => callVerifierModel(model, options.claim, options.context))
  ).then(settled =>
    settled
      .filter((r): r is PromiseFulfilledResult<VerifierResult> => r.status === 'fulfilled')
      .map(r => r.value)
  );

  if (results.length === 0) {
    throw new Error('All local verifier models failed');
  }

  const passCount = results.filter(r => r.verdict === 'PASS').length;
  const verdict: Verdict = passCount > results.length / 2 ? 'PASS' : 'FAIL';
  const confidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

  return {
    receipt_id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    verdict,
    confidence,
    signed_at: new Date().toISOString(),
    signature: 'local:unsigned',
    verifier_count: results.length,
    verifiers: results,
    receipt_url: '',
    mode: 'local',
  };
}

async function callVerifierModel(
  model: LocalModelConfig,
  claim: string,
  context?: string
): Promise<VerifierResult> {
  const prompt = `You are an adversarial reasoning verifier. Your job is to find flaws, hallucinations, or manipulation in the following reasoning chain.

${context ? `Context: ${context}\n\n` : ''}Claim to verify:
"${claim}"

Respond with a JSON object:
{
  "verdict": "PASS" | "FAIL" | "UNCERTAIN",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation>"
}`;

  const apiBaseMap: Record<string, string> = {
    anthropic: 'https://api.anthropic.com/v1',
    openai: 'https://api.openai.com/v1',
    xai: 'https://api.x.ai/v1',
    moonshot: 'https://api.moonshot.cn/v1',
    deepseek: 'https://api.deepseek.com/v1',
  };

  const base = apiBaseMap[model.provider];
  const isAnthropic = model.provider === 'anthropic';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(isAnthropic
      ? { 'x-api-key': model.apiKey, 'anthropic-version': '2023-06-01' }
      : { 'Authorization': `Bearer ${model.apiKey}` }),
  };

  const requestBody = isAnthropic
    ? { model: model.model, max_tokens: 256, messages: [{ role: 'user', content: prompt }] }
    : { model: model.model, max_tokens: 256, messages: [{ role: 'user', content: prompt }] };

  const response = await fetch(`${base}/messages`, { method: 'POST', headers, body: JSON.stringify(requestBody) });
  const data = await response.json() as { content?: Array<{ text?: string }>; choices?: Array<{ message?: { content?: string } }> };

  const text = isAnthropic
    ? data.content?.[0]?.text ?? ''
    : data.choices?.[0]?.message?.content ?? '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { model: model.model, verdict: 'UNCERTAIN', confidence: 0.5, reasoning: 'Failed to parse response' };
  }

  const parsed = JSON.parse(jsonMatch[0]) as { verdict?: Verdict; confidence?: number; reasoning?: string };
  return {
    model: model.model,
    verdict: parsed.verdict ?? 'UNCERTAIN',
    confidence: parsed.confidence ?? 0.5,
    reasoning: parsed.reasoning,
  };
}

// ─── Main verify() ──────────────────────────────────────────────────────────

/**
 * Verify an AI reasoning chain before taking action.
 *
 * @param options - VerifyOptions with mode 'remote' or 'local'
 * @returns VerificationReceipt with verdict, confidence, and signature
 *
 * @example
 * const receipt = await verify({
 *   claim: "Transfer $500 to vendor",
 *   mode: 'remote',
 *   apiKey: 'tp_op_...',
 * });
 */
export async function verify(options: VerifyOptions): Promise<VerificationReceipt> {
  if (options.mode === 'remote') {
    return verifyRemote(options);
  }
  return verifyLocal(options);
}

/**
 * Quick verify shorthand for remote mode.
 * Reads THOUGHTPROOF_API_KEY from environment if apiKey not provided.
 */
export async function quickVerify(
  claim: string,
  options?: Partial<RemoteVerifyOptions>
): Promise<VerificationReceipt> {
  const apiKey = options?.apiKey ?? (typeof process !== 'undefined' ? process.env.THOUGHTPROOF_API_KEY : undefined);
  if (!apiKey) {
    throw new Error('ThoughtProof API key required. Pass apiKey or set THOUGHTPROOF_API_KEY env var.');
  }
  return verify({ claim, mode: 'remote', apiKey, ...options });
}
