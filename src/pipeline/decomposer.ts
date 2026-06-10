import type { ProviderConfig } from '../types.js';
import { createProviderFromConfig } from '../providers/index.js';

export interface SubClaim {
  claim: string;
  stakeLevel?: string;
}

export interface DecompositionResult {
  isCompound: boolean;
  subClaims: SubClaim[];
  dependencies: string[];
}

const DECOMPOSER_PROMPT = `You are a claim decomposer. Analyze the following claim and determine if it is compound (made up of multiple distinct sub-steps or sub-claims that each have their own risk profile).

CLAIM: {claim}

Respond ONLY with a valid JSON object in this exact format:
{
  "isCompound": boolean,
  "subClaims": [
    { "claim": "string describing the sub-claim", "stakeLevel": "micro|low|medium|high|critical" }
  ],
  "dependencies": [
    "string describing a dependency relationship, e.g., 'step 2 depends on step 1'"
  ]
}

Rules:
- Set isCompound to true only if the claim contains 2+ logically distinct steps or actions with separate risk profiles
- List each sub-claim as an atomic, independently verifiable claim
- Set stakeLevel based on the risk of each sub-claim (financial transfers = high, reads/info = low, etc.)
- List dependencies as plain-English descriptions of ordering constraints between steps
- If not compound, return isCompound: false with empty subClaims and dependencies arrays

Respond with ONLY the JSON object, no other text.`;

/**
 * Select the cheapest available provider from the list.
 * Prefers non-Anthropic (OpenAI-compatible) providers as they tend to be cheaper.
 * Falls back to the first provider if all are Anthropic.
 * Credit: RECURSIVE-VERIFY-SPEC.md — "Uses cheapest available model (Grok/Kimi)"
 */
function selectCheapestProvider(providers: ProviderConfig[]): ProviderConfig {
  const cheap = providers.find(p => {
    const nameLower = p.name.toLowerCase();
    return nameLower !== 'anthropic' && !p.model.toLowerCase().startsWith('claude');
  });
  return cheap || providers[0];
}

/**
 * v1.3+: Decompose a compound claim into sub-claims using a single cheap LLM call.
 * Returns isCompound=false if the claim is atomic or if decomposition fails (safe fallback).
 * Credit: arxiv:2512.24601 (Recursive Language Models)
 */
export async function decomposeClaim(
  claim: string,
  providers: ProviderConfig[],
): Promise<DecompositionResult> {
  if (providers.length === 0) {
    return { isCompound: false, subClaims: [], dependencies: [] };
  }

  const cfg = selectCheapestProvider(providers);
  const provider = createProviderFromConfig(cfg);
  const prompt = DECOMPOSER_PROMPT.replace('{claim}', claim);

  try {
    const response = await provider.call(cfg.model, prompt);
    const content = response.content.trim();

    // Extract JSON — handle markdown code blocks and bare JSON
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content;

    const parsed = JSON.parse(jsonStr) as DecompositionResult;

    if (typeof parsed.isCompound !== 'boolean') {
      return { isCompound: false, subClaims: [], dependencies: [] };
    }

    return {
      isCompound: parsed.isCompound === true,
      subClaims: Array.isArray(parsed.subClaims) ? parsed.subClaims : [],
      dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
    };
  } catch (err) {
    console.warn('[pot-sdk] Claim decomposition failed, treating claim as atomic:', err instanceof Error ? err.message : err);
    return { isCompound: false, subClaims: [], dependencies: [] };
  }
}
