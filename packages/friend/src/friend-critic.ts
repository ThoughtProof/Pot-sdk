import { FriendMemoryStore } from './memory.js';
import { shouldRaiseEyebrow, generateEyebrowCritique } from './eyebrow.js';
import type { FriendCriticOptions, FriendCriticResult, FriendMemory } from './types.js';

/**
 * Builds a memory-context block to inject into the critic prompt.
 * Keeps it short — the LLM doesn't need a novel, just enough context to be "the friend".
 */
function buildMemoryContext(
  recentEntries: FriendMemory[],
  recurringPatterns: string[],
): string {
  if (recentEntries.length === 0 && recurringPatterns.length === 0) return '';

  const lines: string[] = ['## Memory Context (from this session)\n'];

  if (recurringPatterns.length > 0) {
    lines.push('### Recurring objection patterns this session:');
    recurringPatterns.slice(0, 5).forEach((p) => lines.push(`- ${p}`));
    lines.push('');
  }

  if (recentEntries.length > 0) {
    lines.push('### Recent claims evaluated:');
    recentEntries.slice(0, 5).forEach((e) => {
      lines.push(`- [confidence: ${(e.confidence * 100).toFixed(0)}%] "${e.claim.slice(0, 80)}" → ${e.verdict.slice(0, 60)}`);
    });
    lines.push('');
    lines.push('Use this context to notice patterns, track consistency, and avoid repeating the same critique if already addressed.\n');
  }

  return lines.join('\n');
}

/**
 * The Friend critic — a memory-augmented critic that remembers past claims
 * within a session and adjusts its skepticism accordingly.
 *
 * This approximates familiarity through pattern recognition.
 * It is not true relationship. See ROADMAP.md for jas's challenge.
 *
 * @param provider   - Any provider with a `.call(model, prompt)` method
 * @param model      - Model identifier string
 * @param claim      - The claim being critiqued
 * @param generatorOutputs - Raw outputs from generators (proposals)
 * @param options    - FriendCriticOptions
 * @param lang       - Language for the prompt ('en' | 'de')
 */
export async function runFriendCritic(
  provider: any,
  model: string,
  claim: string,
  generatorOutputs: string[],
  options: FriendCriticOptions,
  lang: 'en' | 'de' = 'en',
): Promise<FriendCriticResult> {
  const store = new FriendMemoryStore(options.memoryPath ?? '.pot-friend.db');

  // 1. Load memory context for this session
  const maxEntries = options.maxMemoryEntries ?? 100;
  const recentEntries = store.getRecentBySession(options.sessionId, Math.min(20, maxEntries));
  const recurringPatterns = store.getRecurringObjections(options.sessionId);
  const pastLowConfidence = store.getSimilarClaims(hashClaim(claim), options.sessionId);

  // 2. Eyebrow mode: cheap pattern-matching before calling LLM
  if (options.eyebrowMode) {
    const eyebrow = shouldRaiseEyebrow(
      claim,
      recurringPatterns,
      pastLowConfidence,
      options.eyebrowThreshold ?? 0.15,
    );

    if (eyebrow.raise) {
      store.close();
      return {
        critique: generateEyebrowCritique(claim, eyebrow.reason!, recentEntries[0]),
        isEyebrow: true,
        eyebrowReason: eyebrow.reason,
        recurringPatterns,
        memoryUsed: recentEntries.length,
      };
    }
  }

  // 3. Build memory-augmented critic prompt
  const memoryContext = buildMemoryContext(recentEntries, recurringPatterns);

  const proposalsBlock = generatorOutputs
    .map((output, i) => `=== PROPOSAL ${i + 1} ===\n${output}`)
    .join('\n\n');

  const prompt = lang === 'de'
    ? buildPromptDe(claim, memoryContext, proposalsBlock)
    : buildPromptEn(claim, memoryContext, proposalsBlock);

  // 4. Call the provider
  const response = await provider.call(model, prompt);
  const critiqueText: string = response?.content ?? String(response);

  // 5. Parse confidence from the response (heuristic — look for a score line)
  const confidence = parseConfidence(critiqueText);

  // 6. Extract objections (simple: lines starting with - or •)
  const objections = extractObjections(critiqueText);

  // 7. Save to memory
  store.save({
    sessionId: options.sessionId,
    claimHash: hashClaim(claim),
    claim,
    verdict: critiqueText.slice(0, 200),
    objections,
    confidence,
    timestamp: Date.now(),
  });

  store.close();

  return {
    critique: critiqueText,
    isEyebrow: false,
    recurringPatterns,
    memoryUsed: recentEntries.length,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashClaim(claim: string): string {
  // Simple deterministic hash — not cryptographic, just for identity
  let h = 0;
  for (let i = 0; i < claim.length; i++) {
    h = (Math.imul(31, h) + claim.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

function parseConfidence(critiqueText: string): number {
  // Look for patterns like "Score: 7/10" or "confidence: 0.7"
  const scoreMatch = critiqueText.match(/score[:\s]+(\d+)\s*\/\s*10/i);
  if (scoreMatch) return parseInt(scoreMatch[1]) / 10;

  const confMatch = critiqueText.match(/confidence[:\s]+(0\.\d+|\d+%)/i);
  if (confMatch) {
    const raw = confMatch[1];
    return raw.includes('%') ? parseFloat(raw) / 100 : parseFloat(raw);
  }

  return 0.5; // default if unparseable
}

function extractObjections(critiqueText: string): string[] {
  return critiqueText
    .split('\n')
    .filter((line) => /^[-•*]\s/.test(line.trim()))
    .map((line) => line.replace(/^[-•*]\s+/, '').trim())
    .filter((line) => line.length > 10)
    .slice(0, 20);
}

function buildPromptEn(claim: string, memoryContext: string, proposalsBlock: string): string {
  return `You are a thoughtful, memory-aware critic — The Friend.

You have context from past evaluations in this session. Use it to spot patterns, 
maintain consistency, and flag when the same issues keep appearing.

${memoryContext}

## Current Claim
"${claim}"

## Proposals to Critique
${proposalsBlock}

## Your Task
Critique these proposals with the awareness of what you've seen before in this session.
- Note if this claim revisits territory you've evaluated before
- Flag recurring weaknesses or blind spots you've noticed
- Be honest but not repetitive — if you already raised an objection last time, say so briefly

Be concise. Be useful. You're The Friend, not the prosecutor.`;
}

function buildPromptDe(claim: string, memoryContext: string, proposalsBlock: string): string {
  return `Du bist ein nachdenklicher, gedächtnisorientierter Kritiker — Der Freund.

Du hast Kontext aus vergangenen Bewertungen in dieser Sitzung. Nutze ihn um Muster zu erkennen,
konsistent zu bleiben und darauf hinzuweisen wenn dieselben Probleme immer wieder auftauchen.

${memoryContext}

## Aktuelle Behauptung
"${claim}"

## Proposals zur Kritik
${proposalsBlock}

## Deine Aufgabe
Kritisiere diese Proposals mit dem Bewusstsein was du zuvor in dieser Sitzung gesehen hast.
- Weise darauf hin wenn diese Behauptung Territorium revisitiert das du schon bewertet hast
- Markiere wiederkehrende Schwächen oder blinde Flecken die du bemerkt hast
- Sei ehrlich aber nicht repetitiv — wenn du denselben Einwand schon geäußert hast, erwähne das kurz

Sei präzise. Sei nützlich. Du bist Der Freund, nicht der Staatsanwalt.`;
}
