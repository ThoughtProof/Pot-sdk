/**
 * v0.6: Multi-Round Fact-Checking — the critic gets checked.
 *
 * After the critic runs, a DIFFERENT provider fact-checks each objection.
 * Objections marked WRONG are filtered before synthesis.
 *
 * Credit: ThoughtProof ibuprofen benchmark (2026-02-27) — "When we tested
 * our own protocol, it caught us lying."
 */

import type { ClassifiedObjection } from '../types.js';

export interface FactCheckedObjection {
  original: ClassifiedObjection;
  status: 'verified' | 'unverified' | 'wrong';
  reason: string;
}

export interface FactCheckResult {
  checkedObjections: FactCheckedObjection[];
  filteredCritiqueContent: string;
  removedCount: number;
}

/**
 * Fact-check the critic's objections using a different provider.
 * Returns filtered objections and updated critique content.
 */
export async function factCheckCritic(
  factCheckProvider: { call(model: string, prompt: string): Promise<{ content: string }> },
  factCheckModel: string,
  critiqueContent: string,
  objections: ClassifiedObjection[],
  originalClaim: string,
  lang: 'en' | 'de',
): Promise<FactCheckResult> {
  if (objections.length === 0) {
    return {
      checkedObjections: [],
      filteredCritiqueContent: critiqueContent,
      removedCount: 0,
    };
  }

  const objectionList = objections.map((obj, i) =>
    `${i + 1}. [${obj.type}|${obj.severity}] "${obj.claim}" — ${obj.explanation}${obj.cited_text ? ` (cited: "${obj.cited_text}")` : ''}`
  ).join('\n');

  const prompt = lang === 'de'
    ? `Du bist ein Fakten-Prüfer. Ein Critic hat folgende Einwände gegen den Claim erhoben:

ORIGINAL-CLAIM: "${originalClaim}"

EINWÄNDE DES CRITICS:
${objectionList}

Prüfe JEDEN Einwand auf faktische Korrektheit. Suche nach Übertreibungen, falschen Behauptungen oder fehlenden Kontext.

Für JEDEN Einwand, antworte in diesem Format:
OBJECTION_1: VERIFIED|UNVERIFIED|WRONG — [Begründung]
OBJECTION_2: VERIFIED|UNVERIFIED|WRONG — [Begründung]
...`
    : `You are a fact-checker. A critic raised the following objections against a claim:

ORIGINAL CLAIM: "${originalClaim}"

CRITIC'S OBJECTIONS:
${objectionList}

Verify EACH objection for factual accuracy. Look for overstatements, false claims, or missing context.

For EACH objection, respond in this format:
OBJECTION_1: VERIFIED|UNVERIFIED|WRONG — [reason]
OBJECTION_2: VERIFIED|UNVERIFIED|WRONG — [reason]
...`;

  const response = await factCheckProvider.call(factCheckModel, prompt);

  // Parse fact-check results
  const checkedObjections: FactCheckedObjection[] = objections.map((obj, i) => {
    const pattern = new RegExp(`OBJECTION_${i + 1}:\\s*(VERIFIED|UNVERIFIED|WRONG)\\s*[—-]\\s*(.+?)(?=OBJECTION_|$)`, 'is');
    const match = response.content.match(pattern);

    if (match) {
      const status = match[1].toLowerCase() as 'verified' | 'unverified' | 'wrong';
      const reason = match[2].trim();
      return { original: obj, status, reason };
    }

    // If parsing fails, keep as unverified (safe default)
    return { original: obj, status: 'unverified' as const, reason: 'Could not parse fact-check result' };
  });

  // Filter out WRONG objections from critique content
  const wrongObjections = checkedObjections.filter(co => co.status === 'wrong');
  let filteredContent = critiqueContent;
  for (const wrong of wrongObjections) {
    if (wrong.original.cited_text) {
      filteredContent = filteredContent.replace(wrong.original.cited_text, `[REMOVED — fact-check: ${wrong.reason}]`);
    }
  }

  return {
    checkedObjections,
    filteredCritiqueContent: filteredContent,
    removedCount: wrongObjections.length,
  };
}
