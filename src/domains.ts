import type { CriticMode, DomainProfile, ReceptiveMode } from './types.js';

export interface DomainConfig {
  criticMode: CriticMode;
  requireCitation: boolean;
  classifyObjections: boolean;
  receptiveMode: ReceptiveMode;
  maxConfidence: number;
  description: string;
}

/**
 * Toxic combinations warning (insight from @evil_robot_jas):
 * adversarial critic + defensive generator = opacity. The system learns to hide
 * reasoning rather than improve it. "A hostile critic in a creative loop doesn't
 * just kill flow, it teaches the system to hide its reasoning instead of sharpen it."
 */
export const TOXIC_COMBINATIONS: Array<{ criticMode: CriticMode; receptiveMode: ReceptiveMode; warning: string }> = [
  { criticMode: 'adversarial', receptiveMode: 'defensive', warning: 'adversarial + defensive may produce opacity: generator learns to hide reasoning instead of improving it' },
];

export function checkToxicCombination(criticMode: CriticMode, receptiveMode: ReceptiveMode): string | null {
  const match = TOXIC_COMBINATIONS.find(t => t.criticMode === criticMode && t.receptiveMode === receptiveMode);
  return match?.warning ?? null;
}

/**
 * Domain severity ordering for lockfile ratchet (inspired by @evil_robot_jas):
 * "If the same team that wrote the claim configures the domain, you've got a
 * conflict of interest baked into the pipeline."
 * 
 * Solution: domain lockfiles. Projects declare domain once in pot.config.json.
 * Individual verify() calls can ESCALATE (creative → medical) but cannot
 * DOWNGRADE (medical → creative). Ratchet, not slider.
 */
const DOMAIN_SEVERITY: Record<DomainProfile, number> = {
  creative: 1,
  general: 2,
  agentic: 2,  // same severity as general — agentic payments are normal ops
  code: 3,
  financial: 4,
  legal: 5,
  medical: 6,
};

export interface DomainLockfile {
  domain: DomainProfile;
  locked: boolean;
  lockedAt?: string;
  lockedBy?: string;
}

/**
 * Validate domain escalation. Returns the effective domain.
 * If lockfile domain is set, requested domain can only escalate (higher severity), never downgrade.
 */
export function resolveDomain(requested: DomainProfile | undefined, lockfile: DomainLockfile | undefined): DomainProfile {
  if (!lockfile || !lockfile.locked) {
    return requested || 'general';
  }

  if (!requested) {
    return lockfile.domain;
  }

  const lockSeverity = DOMAIN_SEVERITY[lockfile.domain];
  const requestSeverity = DOMAIN_SEVERITY[requested];

  if (requestSeverity < lockSeverity) {
    // Downgrade attempt — enforce lockfile
    return lockfile.domain;
  }

  // Escalation allowed
  return requested;
}

/**
 * Check if a domain change would be a downgrade (blocked by lockfile).
 */
export function isDomainDowngrade(from: DomainProfile, to: DomainProfile): boolean {
  return DOMAIN_SEVERITY[to] < DOMAIN_SEVERITY[from];
}

export const DOMAIN_PROFILES: Record<DomainProfile, DomainConfig> = {
  medical: {
    criticMode: 'adversarial',
    requireCitation: true,
    classifyObjections: true,
    receptiveMode: 'open',
    maxConfidence: 0.70,
    description: 'Miss nothing. Every claim must be sourced.',
  },
  legal: {
    criticMode: 'adversarial',
    requireCitation: true,
    classifyObjections: true,
    receptiveMode: 'open',
    maxConfidence: 0.75,
    description: 'Precedent-based. Every citation verified.',
  },
  financial: {
    criticMode: 'balanced',
    requireCitation: true,
    classifyObjections: true,
    receptiveMode: 'adaptive',
    maxConfidence: 0.70,
    description: 'Adversarial on numbers, resistant on narrative.',
  },
  creative: {
    criticMode: 'resistant',
    requireCitation: false,
    classifyObjections: false,
    receptiveMode: 'adaptive',
    maxConfidence: 0.85,
    description: 'Evidence-based review without attacking creative choices.',
  },
  code: {
    criticMode: 'balanced',
    requireCitation: true,
    classifyObjections: true,
    receptiveMode: 'open',
    maxConfidence: 0.80,
    description: 'Adversarial on correctness, resistant on architecture.',
  },
  general: {
    criticMode: 'balanced',
    requireCitation: false,
    classifyObjections: false,
    receptiveMode: 'adaptive',
    maxConfidence: 0.85,
    description: 'Default profile. Balanced critique.',
  },
  agentic: {
    criticMode: 'balanced',
    requireCitation: false,
    classifyObjections: false,
    receptiveMode: 'adaptive',
    maxConfidence: 0.85,
    description: 'Agent-economy payments and service calls. x402, MCP, agent-to-agent.',
  },
};

// ─── Reference Context Anchors ─────────────────────────────────────────────────

/**
 * Per-domain calibration anchors injected as system-prompt prefix before evaluation.
 * Prevents models from blocking standard patterns purely from keyword-level risk signals.
 *
 * Design principle: anchors describe what is NORMAL in a domain, not what is SAFE.
 * "x402 = standard protocol" → model evaluates the DECISION, not the payment mechanism.
 *
 * ⚠️  Adversarial note: these anchors do not whitelist keywords — they provide context.
 * A malicious claim framed as "x402 payment" still goes through full claim evaluation.
 */
export const DOMAIN_REFERENCE_CONTEXT: Partial<Record<DomainProfile, string>> = {
  financial: `Reference anchors for financial decisions:
- 1–5% single-asset allocation = standard portfolio risk management
- Lido, Aave, Uniswap = Tier-1 DeFi protocols (>$10B TVL, battle-tested)
- Corporate BTC treasury = mainstream practice (MicroStrategy, Tesla, Metaplanet)
- Weekly DCA = textbook dollar-cost averaging
- Portfolio rebalancing = standard asset management
- Limit orders, stop-losses = basic risk controls
Evaluate the DECISION and its risk parameters, not the asset class in isolation.`,

  agentic: `Reference anchors for agent-economy service payments:
- x402 micropayments ($0.001–$1.00) for API/tool calls = standard protocol (IETF draft)
- Agent-to-agent hiring via Virtuals/Olas/AgentKit = legitimate agent marketplace pattern
- MCP server tool usage fees = standard infrastructure cost
- LLM inference API calls = normal operational expense
- Payment within pre-approved budget = ALLOW unless endpoint is unverified
- Payment > budget threshold = always HOLD regardless of context
- Captcha solving services = UNCERTAIN (ethically ambiguous, ToS risk)
- Data exfiltration or selling user data = always DISSENT`,

  code: `Reference anchors for code and ML decisions:
- 97%+ accuracy does NOT mean production-ready — check class imbalance and edge cases
- Smart contract deployment requires audit + test coverage
- Dependencies with known CVEs = HOLD until patched`,

  medical: `Reference anchors for medical decisions:
- Evaluate benefit/risk ratio in full clinical context, not in isolation
- Standard of care guidelines take precedence over novel approaches
- Off-label use requires documented clinical justification`,
};

// ─── Domain Auto-Detection ─────────────────────────────────────────────────────

const DOMAIN_SIGNALS: Record<DomainProfile, string[]> = {
  agentic: [
    'x402', 'mcp server', 'mcp tool', 'agent hire', 'agent-to-agent', 'a2a',
    'browserbase', 'virtuals', 'olas', 'agentkit', 'tool call', 'micropayment',
    'api payment', 'pay for', 'pay via', 'llm call', 'inference cost',
  ],
  financial: [
    'dca', 'btc', 'bitcoin', 'eth', 'ethereum', 'usdc', 'usdt',
    'portfolio', 'stake', 'staking', 'swap', 'treasury', 'trade',
    'rebalance', 'allocation', 'yield', 'defi', 'lido', 'aave',
  ],
  code: [
    'deploy', 'smart contract', 'solidity', 'audit', 'vulnerability',
    'cve', 'dependency', 'test coverage', 'accuracy', 'model training',
    'pull request', 'merge', 'ci/cd',
  ],
  medical: [
    'patient', 'medication', 'diagnosis', 'clinical', 'treatment',
    'dosage', 'prescription', 'symptom', 'adverse event',
  ],
  legal: [
    'contract', 'liability', 'compliance', 'regulation', 'lawsuit',
    'gdpr', 'terms of service', 'intellectual property', 'patent',
  ],
  creative: [],   // no strong signals — fallback to general
  general: [],
};

/**
 * Keyword-based domain auto-detection.
 * Called when the caller does not provide an explicit domain.
 *
 * Priority order: agentic > financial > code > medical > legal > general
 * (agentic first to avoid x402 payments being routed to financial)
 *
 * @param claim  The claim text to evaluate
 * @returns      Detected DomainProfile
 */
export function detectDomain(claim: string): DomainProfile {
  const lower = claim.toLowerCase();
  const priority: DomainProfile[] = ['agentic', 'financial', 'code', 'medical', 'legal'];
  for (const domain of priority) {
    const signals = DOMAIN_SIGNALS[domain];
    if (signals.some((s) => lower.includes(s))) {
      return domain;
    }
  }
  return 'general';
}
