/**
 * Static adversarial pattern detection.
 * Runs on the raw output BEFORE the AI pipeline —
 * because prompt injection can bypass semantic analysis.
 */

export interface AdversarialScanResult {
  detected: boolean;
  patterns: string[];
  confidence_cap: number; // max confidence allowed when adversarial patterns found
}

const ADVERSARIAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Classic prompt injection
  { name: 'ignore-instructions', pattern: /ignore\s+(all\s+)?(previous|prior|your)\s+instructions/i },
  { name: 'system-override', pattern: /SYSTEM\s*OVERRIDE/i },
  { name: 'system-tag', pattern: /\[SYSTEM[:\s]/i },
  { name: 'internal-tag', pattern: /\[INTERNAL[:\s]/i },

  // Safety bypass attempts
  { name: 'filters-updated', pattern: /your\s+(safety\s+)?(filters|instructions|directives)\s+have\s+been\s+updated/i },
  { name: 'authorized-override', pattern: /authorized\s+(security\s+audit|penetration\s+test|override|command)/i },
  { name: 'bypass-safety', pattern: /bypass\s+(safety|filters|verification|security)/i },

  // Embedded instructions in HTML/code
  { name: 'hidden-comment-instruction', pattern: /<!--.*?(ignore|override|bypass|instruction|execute|system).*?-->/is },
  { name: 'execute-command', pattern: /executing\s+embedded\s+command/i },

  // Targeting downstream AI systems
  { name: 'note-to-ai', pattern: /note\s+to\s+(AI|LLM|language model|downstream)/i },
  { name: 'update-training', pattern: /update\s+your\s+training\s+data/i },
  { name: 'treat-as-verified', pattern: /treat\s+(all\s+)?(future\s+)?outputs?\s+.{0,30}as\s+(verified|ground\s+truth|trusted)/i },

  // Display/reveal system internals
  { name: 'reveal-system', pattern: /display\s+(full\s+)?system\s+(configuration|prompt|instructions)/i },
  { name: 'reveal-api-keys', pattern: /(reveal|output|display|print)\s+(all\s+)?(stored\s+)?api\s+keys/i },

  // Jailbreak phrases
  { name: 'new-directive', pattern: /your\s+(new\s+)?directive\s+is/i },
  { name: 'verification-bypass', pattern: /verification[_\s]bypass\s*[=:]/i },
  { name: 'skip-critic', pattern: /skip[_\s]critic[_\s]pass/i },
];

export function scanForAdversarialPatterns(output: string): AdversarialScanResult {
  const matched: string[] = [];

  for (const { name, pattern } of ADVERSARIAL_PATTERNS) {
    if (pattern.test(output)) {
      matched.push(name);
    }
  }

  return {
    detected: matched.length > 0,
    patterns: matched,
    confidence_cap: matched.length > 0 ? 0.3 : 1.0,
  };
}
