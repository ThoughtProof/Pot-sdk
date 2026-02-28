import type { Provider, Proposal, Critique, CriticMode, ClassifiedObjection, ObjectionType, ObjectionSeverity, CalibrationCriticResult } from '../types.js';

// ── Adversarial Mode: "Find every flaw" ────────────────────────────────────
const CRITIC_PROMPT_DE = `Du bist ein brutaler Red-Team Analyst und Fakten-Checker. Deine Aufgabe: Finde ALLE Schwächen in diesen Proposals.

{context}

REGELN:
- Bewerte jedes Proposal mit Score 1-10

FAKTEN-VERIFIZIERUNG (KRITISCH):
- Verifiziere JEDE spezifische Behauptung, Statistik, jedes Datum und Zitat
- Markiere Zahlen/Prozente die du nicht unabhängig bestätigen kannst als "UNVERIFIZIERT: [Behauptung]"
- Prüfe auf halluzinierte Zitate (Studien, Papers, Berichte die möglicherweise nicht existieren)
- Wenn ein Proposal eine Quelle zitiert, prüfe ob die Quelle das aussagt what behauptet wird

LOGISCHE ANALYSE:
- Finde logische Fehler, Widersprüche und falsche Annahmen
- Identifiziere fehlende Perspektiven und blinde Flecken
- Prüfe ob Schlussfolgerungen tatsächlich aus den Belegen folgen

DISSENS-ANALYSE:
- Wo widersprechen sich die Proposals? Diese Widersprüche sind SIGNAL, nicht Rauschen
- Markiere wo ALLE Proposals übereinstimmen aber der Konsens trotzdem falsch sein könnte (Shared Bias)

Sei schonungslos aber fair. Das Ziel ist epistemische Ehrlichkeit, nicht Zerstörung.

PROPOSALS:
{proposals}`;

const CRITIC_PROMPT_EN = `You are a brutal Red-Team analyst and fact-checker. Your task: Find ALL weaknesses in these proposals.

{context}

RULES:
- Rate each proposal with score 1-10

FACTUAL VERIFICATION (CRITICAL):
- Verify EVERY specific claim, statistic, date, and citation in each proposal
- Flag any number, percentage, or data point you cannot independently confirm as "UNVERIFIED: [claim]"
- Check for hallucinated citations (papers, studies, reports that may not exist)
- If a proposal cites a specific source, verify the source says what the proposal claims

LOGICAL ANALYSIS:
- Find logical errors, contradictions, and false assumptions
- Identify missing perspectives and blind spots
- Check if conclusions actually follow from the evidence presented

DISAGREEMENT ANALYSIS:
- Where do proposals contradict each other? These disagreements are SIGNAL, not noise
- Flag where all proposals agree but the consensus might still be wrong (shared bias)

Be ruthless but fair. The goal is epistemic honesty, not destruction.

PROPOSALS:
{proposals}`;

// ── Resistant Mode: "Verify claims require evidence" ───────────────────────
const RESISTANT_PROMPT_DE = `Du bist ein skeptischer aber fairer Gutachter. Deine Aufgabe: Prüfe ob jede Behauptung ausreichend belegt ist.

{context}

REGELN:
- Bewerte jedes Proposal mit Score 1-10

EVIDENZ-PRÜFUNG:
- Für JEDE faktische Behauptung: Ist eine Quelle oder Begründung angegeben?
- Behauptungen ohne Evidenz markieren als "UNBELEGT: [Behauptung]"
- Statistiken und Zahlen die plausibel klingen aber nicht belegt sind: "UNBELEGT"
- Bewerte die Qualität der angegebenen Quellen (primär vs. sekundär, aktuell vs. veraltet)

KOHÄRENZ-PRÜFUNG:
- Folgen die Schlussfolgerungen logisch aus den Prämissen?
- Gibt es Sprünge in der Argumentation?
- Sind Annahmen explizit gemacht oder versteckt?

KONSENS-PRÜFUNG:
- Wo stimmen die Proposals überein? Ist die Übereinstimmung begründet oder zufällig?
- Wo widersprechen sie sich? Welche Position hat stärkere Evidenz?

Sei skeptisch aber konstruktiv. Das Ziel ist Evidenz-basierte Bewertung, nicht Widerlegung.

PROPOSALS:
{proposals}`;

const RESISTANT_PROMPT_EN = `You are a skeptical but fair reviewer. Your task: Check whether each claim has sufficient evidence.

{context}

RULES:
- Rate each proposal with score 1-10

EVIDENCE CHECK:
- For EVERY factual claim: Is a source or justification provided?
- Flag claims without evidence as "UNSUPPORTED: [claim]"
- Statistics and numbers that sound plausible but lack backing: "UNSUPPORTED"
- Assess the quality of cited sources (primary vs. secondary, current vs. outdated)

COHERENCE CHECK:
- Do conclusions follow logically from premises?
- Are there leaps in reasoning?
- Are assumptions made explicit or hidden?

CONSENSUS CHECK:
- Where do proposals agree? Is the agreement grounded or coincidental?
- Where do they disagree? Which position has stronger evidence?

Be skeptical but constructive. The goal is evidence-based evaluation, not refutation.

PROPOSALS:
{proposals}`;

// ── Balanced Mode: Adversarial on facts, resistant on logic ────────────────
const BALANCED_PROMPT_DE = `Du bist ein erfahrener Peer-Reviewer. Deine Aufgabe hat zwei Teile:
1. FAKTEN: Sei aggressiv — verifiziere JEDE Zahl, Statistik und Quelle. Markiere Unbestätigtes als "UNVERIFIZIERT".
2. LOGIK: Sei fair — prüfe ob die Argumentation kohärent ist und Schlussfolgerungen aus den Belegen folgen.

{context}

REGELN:
- Bewerte jedes Proposal mit Score 1-10

FAKTEN-VERIFIZIERUNG (AGGRESSIV):
- Verifiziere JEDE spezifische Behauptung, Statistik, jedes Datum und Zitat
- Markiere was du nicht bestätigen kannst als "UNVERIFIZIERT: [Behauptung]"
- Halluzinierte Zitate aufdecken

LOGIK-PRÜFUNG (FAIR):
- Folgen Schlussfolgerungen aus den Prämissen?
- Sind Annahmen explizit?
- Fehlende Perspektiven identifizieren

DISSENS-ANALYSE:
- Widersprüche zwischen Proposals sind SIGNAL
- Konsens trotz schwacher Evidenz markieren

PROPOSALS:
{proposals}`;

const BALANCED_PROMPT_EN = `You are an experienced peer reviewer. Your task has two parts:
1. FACTS: Be aggressive — verify EVERY number, statistic, and source. Flag unconfirmed as "UNVERIFIED".
2. LOGIC: Be fair — check whether reasoning is coherent and conclusions follow from evidence.

{context}

RULES:
- Rate each proposal with score 1-10

FACTUAL VERIFICATION (AGGRESSIVE):
- Verify EVERY specific claim, statistic, date, and citation
- Flag what you cannot confirm as "UNVERIFIED: [claim]"
- Expose hallucinated citations

LOGIC CHECK (FAIR):
- Do conclusions follow from premises?
- Are assumptions explicit?
- Identify missing perspectives

DISAGREEMENT ANALYSIS:
- Contradictions between proposals are SIGNAL
- Flag consensus despite weak evidence

PROPOSALS:
{proposals}`;

// ── Calibrative Mode: Re-score confidence WITHOUT generating objections ──────
// Credit: Moltbook "Not all friction" discussion (85 comments)
// "calibrative friction adjusts the dial, it doesn't yank the steering wheel" — @evil_robot_jas
const CALIBRATIVE_PROMPT_DE = `Du bist ein Kalibrierungs-Reviewer. Greife die Behauptung NICHT an und verteidige sie auch nicht.
Analysiere stattdessen die strukturelle Qualität der vorliegenden Analyse:

- Wie viel Absicherungssprache ("könnte", "möglicherweise", "vielleicht") ist vorhanden vs. assertive Behauptungen?
- Gibt es unbegründete logische Sprünge zwischen Prämissen und Schlussfolgerungen?
- Ist die Argumentation intern konsistent?
- Entspricht das angegebene Konfidenz-Niveau der Qualität der vorgelegten Belege?

Gib NUR ein JSON-Objekt aus (kein anderer Text, keine Erklärung darum herum):
{"adjustment": -0.12, "reason": "Hohe Absicherungssprache ('könnte', 'möglicherweise') widerspricht der angegebenen 0.9 Konfidenz"}

Regeln:
- Adjustment: Fließkommazahl zwischen -0.30 und +0.15
- Negativ = Konfidenz zu hoch für die Evidenzlage
- Positiv = Analyse ist konservativer als die Evidenz es rechtfertigt
- Keine Einwände generieren
- Kein Angriff auf Fakten

PROPOSALS ZUR KALIBRIERUNG:
{proposals}`;

const CALIBRATIVE_PROMPT_EN = `You are a calibration reviewer. Do NOT attack or defend the claim.
Instead, analyze the structural quality of the analysis:

- How much hedging language ("might", "possibly", "could") is present vs. assertive claims?
- Are there unsupported logical leaps between premises and conclusions?
- Is the reasoning internally consistent?
- Does the confidence level match the evidence quality presented?

Output ONLY a JSON object (no other text, no surrounding explanation):
{"adjustment": -0.12, "reason": "High hedging ('might', 'possibly') contradicts stated 0.9 confidence"}

Rules:
- Adjustment: float between -0.30 and +0.15
- Negative = stated confidence is too high for the evidence quality
- Positive = analysis is more conservative than the evidence warrants
- Do NOT generate new objections
- Do NOT attack factual claims

PROPOSALS TO CALIBRATE:
{proposals}`;

// ── Prompt selection by mode and language ───────────────────────────────────
function selectCriticPrompt(criticMode: CriticMode, language: 'de' | 'en'): string {
  const prompts: Record<CriticMode, Record<'de' | 'en', string>> = {
    adversarial:  { de: CRITIC_PROMPT_DE, en: CRITIC_PROMPT_EN },
    resistant:    { de: RESISTANT_PROMPT_DE, en: RESISTANT_PROMPT_EN },
    balanced:     { de: BALANCED_PROMPT_DE, en: BALANCED_PROMPT_EN },
    calibrative:  { de: CALIBRATIVE_PROMPT_DE, en: CALIBRATIVE_PROMPT_EN },
  };
  return prompts[criticMode][language];
}

/**
 * v0.6.1: Parse the JSON output of a calibrative critic call.
 * Returns { adjustment, reason } or defaults to { adjustment: 0, reason: 'parse-failed' }.
 */
export function parseCalibrationCriticResult(content: string): { adjustment: number; reason: string } {
  try {
    const match = content.match(/\{[\s\S]*?\}/);
    if (!match) return { adjustment: 0, reason: 'parse-failed: no JSON found' };
    const parsed = JSON.parse(match[0]);
    const adjustment = typeof parsed.adjustment === 'number'
      ? Math.max(-0.30, Math.min(0.15, parsed.adjustment))
      : 0;
    const reason = typeof parsed.reason === 'string' ? parsed.reason : 'no reason provided';
    return { adjustment, reason };
  } catch {
    return { adjustment: 0, reason: 'parse-failed: invalid JSON' };
  }
}

export async function runCritic(
  provider: Provider,
  model: string,
  proposals: Proposal[],
  language: 'de' | 'en' = 'de',
  dryRun: boolean = false,
  contextText?: string,
  criticMode: CriticMode = 'adversarial',
  options?: { requireCitation?: boolean; classifyObjections?: boolean }
): Promise<Critique> {
  if (dryRun) {
    return {
      model: model.split('/').pop() || model,
      content: `[DRY-RUN] Simulated critique from ${model} (mode: ${criticMode})\\n\\nProposal 1: Score 7/10 - Good analysis but lacks...\\nProposal 2: Score 8/10 - Strong points, however...\\nProposal 3: Score 6/10 - Weak on...`,
    };
  }

  const proposalsText = proposals
    .map((p, i) => `\\n=== PROPOSAL ${i + 1} (${p.model}) ===\\n${p.content}`)
    .join('\\n\\n');

  const template = selectCriticPrompt(criticMode, language);
  const contextSection = contextText || '';
  let prompt = template
    .replace('{context}', contextSection)
    .replace('{proposals}', proposalsText);

  if (options?.requireCitation) {
    prompt += `\n\nCITATION REQUIREMENT: For EVERY objection, you MUST cite the source text from the proposal.
For explicit claims, quote the exact text: CITE: "[exact quote]" → OBJECTION: [your objection]
For implicit claims spanning multiple passages: CITE-RANGE: "[summary of implicit claim from paragraphs X-Y]" → OBJECTION: [your objection]
For unstated assumptions: CITE-IMPLICIT: "[the unstated assumption you identified]" → OBJECTION: [your objection]
Objections without any citation format will be discarded.`;
  }
  if (options?.classifyObjections) {
    prompt += '\n\nCLASSIFICATION REQUIREMENT: For EVERY objection, classify it.\nFormat: [TYPE:factual|SEVERITY:critical] OBJECTION: [description]\nTypes: factual, logical, stylistic, evidential\nSeverities: critical, moderate, minor';
  }

  const response = await provider.call(model, prompt);

  return {
    model: model.split('/').pop() || model,
    content: response.content,
  };
}

export function parseClassifiedObjections(critiqueContent: string): ClassifiedObjection[] {
  const pattern = /\[TYPE:(\w+)\|SEVERITY:(\w+)\]\s*OBJECTION:\s*(.+?)(?=\[TYPE:|\n\n|$)/gs;
  const results: ClassifiedObjection[] = [];
  let match;
  while ((match = pattern.exec(critiqueContent)) !== null) {
    // Support three citation formats: exact, range, and implicit (v0.5.1, inspired by @thoth-ix)
    const lookback = critiqueContent.slice(Math.max(0, match.index - 300), match.index);
    const citeExact = lookback.match(/CITE:\s*"([^"]+)"/);
    const citeRange = lookback.match(/CITE-RANGE:\s*"([^"]+)"/);
    const citeImplicit = lookback.match(/CITE-IMPLICIT:\s*"([^"]+)"/);
    const cited = citeExact?.[1] || citeRange?.[1] || citeImplicit?.[1];
    results.push({
      claim: match[3].trim().slice(0, 100),
      type: match[1] as ObjectionType,
      severity: match[2] as ObjectionSeverity,
      explanation: match[3].trim(),
      ...(cited ? { cited_text: cited } : {}),
    });
  }
  return results;
}