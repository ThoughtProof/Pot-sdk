import type { Provider, Proposal, Critique, Synthesis } from '../types.js';

const SYNTHESIZER_PROMPT_DE = `Du bist der Synthesizer. Kombiniere die Proposals und die Kritik zu einer optimalen Antwort.

{context}

TRANSPARENCY — ZWINGEND EINZUHALTEN:
- Du MUSST jede Generator-Position (Proposal 1, 2, 3, ...) explizit adressieren
- Du MUSST dokumentieren, welche Argumente du VERWIRFST und WARUM
- Wenn du eine Position stark gewichtest: begründe es mit dem Evaluation/Critique-Ergebnis
- Dominanz ist OK wenn begründet — undokumentierte Dominanz ist das Problem
- Füge am Ende einen kurzen "Synthesis Decisions" Block ein: welche Argumente übernommen, welche verworfen, warum

REGELN:
- Nutze die Stärken aller Proposals
- Adressiere die Kritikpunkte explizit — besonders UNVERIFIZIERTE Behauptungen die der Critic markiert hat
- Gib eine klare Empfehlung

CONFIDENCE-BEWERTUNG (PFLICHT):
- Schreibe am Ende "Confidence: X%"
{confidenceCaps}
- Hoher Dissens zwischen Proposals = NIEDRIGERE Confidence, nicht gemittelt

DISSENS-ABSCHNITT (PFLICHT):
- Füge einen "Wo die Modelle sich widersprechen" Abschnitt ein
- Erkläre WARUM sie sich widersprechen
- Verstecke Dissens NICHT — er ist das wertvollste Signal

DISCLAIMER:
- Ende mit: "⚠️ Multi-Modell-Analyse — keine verifizierte Wahrheit. Dissens oben hervorgehoben."

- Max 800 Wörter

PROPOSALS:
{proposals}

KRITIK:
{critique}`;

const SYNTHESIZER_PROMPT_EN = `You are the Synthesizer. Combine the proposals and critique into an optimal answer.

{context}

TRANSPARENCY — MANDATORY:
- You MUST explicitly address each Generator position (Proposal 1, 2, 3, ...)
- You MUST document which arguments you REJECT and WHY
- If you weight one position heavily: justify it with the Evaluation/Critique results
- Dominance is OK when justified — undocumented dominance is the problem
- Add a brief "Synthesis Decisions" section at the end: which arguments adopted, which rejected, why

RULES:
- Use the strengths of all proposals
- Address the critique points explicitly — especially any UNVERIFIED claims flagged by the critic
- Give a clear recommendation

CONFIDENCE SCORING (MANDATORY):
- State "Confidence: X%" at the end
{confidenceCaps}
- High disagreement between proposals = LOWER confidence, not averaged confidence

DISAGREEMENT SECTION (MANDATORY):
- Include a "Where Models Disagreed" section
- Explain WHY they disagreed (different assumptions? different data? different frameworks?)
- Do NOT hide disagreement — it is the most valuable signal

DISCLAIMER:
- End with: "⚠️ Multi-model analysis — not verified truth. Disagreements highlighted above."

- Max 800 words

PROPOSALS:
{proposals}

CRITIQUE:
{critique}`;

export function extractKeywords(text: string): string[] {
  // NOTE: regex LITERALS use \s (one backslash in source). Double-backslash
  // versions deleted spaces and pinned computeMdi at 1.0 (LTS fix 49700c1).
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 4);
}

// ── Confidence cap templates ────────────────────────────────────────────────

const CONFIDENCE_CAPS_EPISTEMIC_DE = `- Maximum 85% — kein Multi-Modell-System kann Wahrheit garantieren
- Bei subjektiven/strategischen Fragen: Maximum 70%
- Bei Fragen wo alle Modelle übereinstimmen aber der Critic Shared Bias fand: Maximum 60%`;

const CONFIDENCE_CAPS_EPISTEMIC_EN = `- Cap confidence at 85% maximum — no multi-model system can guarantee truth
- For subjective/strategic questions: cap at 70%
- For questions where all models agree but the critic found shared bias: cap at 60%`;

const CONFIDENCE_CAPS_VERIFICATION_DE = `- Maximum 95% — selbst bei klaren Fakten bleibt eine Restunschärfe
- Bei faktenbasierten Claims mit klarer Evidenz: 80-95% ist korrekt
- Bei subjektiven Bewertungen oder Meinungen: Maximum 75%
- Bei Fragen wo alle Modelle übereinstimmen aber der Critic Shared Bias fand: Maximum 65%
- WICHTIG: Wenn alle Proposals den Claim klar stützen und der Critic keine materiellen Einwände hat, ist eine Confidence von 80%+ angemessen`;

const CONFIDENCE_CAPS_VERIFICATION_EN = `- Cap confidence at 95% maximum — even clear facts retain marginal uncertainty
- For fact-based claims with clear evidence: 80-95% is appropriate
- For subjective assessments or opinions: cap at 75%
- For questions where all models agree but the critic found shared bias: cap at 65%
- IMPORTANT: When all proposals clearly support the claim and the critic raised no material objections, confidence of 80%+ is warranted`;

/** Resolve synthesizer confidence-cap instructions (testable without LLM calls). */
export function resolveConfidenceCaps(
  language: 'de' | 'en' = 'en',
  verificationMode?: boolean,
): string {
  if (verificationMode) {
    return language === 'de' ? CONFIDENCE_CAPS_VERIFICATION_DE : CONFIDENCE_CAPS_VERIFICATION_EN;
  }
  return language === 'de' ? CONFIDENCE_CAPS_EPISTEMIC_DE : CONFIDENCE_CAPS_EPISTEMIC_EN;
}

export interface SynthesisBalanceDetail {
  generator: string;
  coverage: number;
  share: number;
}

export interface SynthesisBalance {
  score: number;
  generator_coverage: SynthesisBalanceDetail[];
  dominated_by?: string;
  dominance_justified?: boolean;
  warning: boolean;
}

export function computeSynthesisBalance(
  proposals: Proposal[],
  synthesisContent: string
): SynthesisBalance {
  const synthesisWords = new Set(extractKeywords(synthesisContent));
  const N = proposals.length;

  const coverageRaw = proposals.map(p => {
    const kw = extractKeywords(p.content);
    if (kw.length === 0) return { model: p.model, hits: 0, total: 0 };
    const hits = kw.filter(w => synthesisWords.has(w)).length;
    return { model: p.model, hits, total: kw.length };
  });

  const coverageScores = coverageRaw.map(c => (c.total > 0 ? c.hits / c.total : 0));
  const totalCoverage = coverageScores.reduce((a, b) => a + b, 0);

  const shares = coverageScores.map(c => (totalCoverage > 0 ? c / totalCoverage : 1 / N));

  const ideal = 1 / N;
  const mad = shares.reduce((a, s) => a + Math.abs(s - ideal), 0) / N;
  const score = Math.max(0, 1 - mad / ideal);

  let dominated_by: string | undefined;
  let dominance_justified = false;
  shares.forEach((s, i) => {
    if (s > 0.6) {
      dominated_by = proposals[i].model;
      const othersAvg = shares
        .filter((_, j) => j !== i)
        .reduce((a, b) => a + b, 0) / (N - 1);
      dominance_justified = othersAvg < 0.15;
    }
  });

  const details = proposals.map((p, i) => ({
    generator: p.model,
    coverage: coverageScores[i],
    share: shares[i],
  }));

  return {
    score: parseFloat(score.toFixed(4)),
    generator_coverage: details,
    dominated_by,
    dominance_justified,
    warning: !!dominated_by && !dominance_justified,
  };
}

export async function runSynthesizer(
  provider: Provider,
  model: string,
  proposals: Proposal[],
  critique: Critique,
  language: 'de' | 'en' = 'de',
  dryRun: boolean = false,
  contextText?: string,
  receptiveMode?: 'open' | 'defensive' | 'adaptive',
  /** When true, uses verification-mode confidence caps (higher ceilings for factual claims) */
  verificationMode?: boolean,
): Promise<Synthesis> {
  if (dryRun) {
    return {
      model: model.split('/').pop() || model,
      content: `[DRY-RUN] Simulated synthesis from ${model}\\n\\nCombining insights from all three proposals...\\nAddressing critique points...\\n\\nFinal recommendation: [placeholder]\\nConfidence: 85%`,
    };
  }

  const proposalsText = proposals
    .map((p, i) => `\\n=== PROPOSAL ${i + 1} (${p.model}) ===\\n${p.content}`)
    .join('\\n\\n');

  const rawTemplate = language === 'de' ? SYNTHESIZER_PROMPT_DE : SYNTHESIZER_PROMPT_EN;
  const confidenceCaps = resolveConfidenceCaps(language, verificationMode);
  const template = rawTemplate.replace('{confidenceCaps}', confidenceCaps);
  const contextSection = contextText || '';

  let receptionPrefix = '';
  if (receptiveMode === 'open') {
    receptionPrefix = 'RECEPTION MODE: You are fully open to critique. Incorporate valid objections. Do not defend — adapt.\n\n';
  } else if (receptiveMode === 'defensive') {
    receptionPrefix = 'RECEPTION MODE: You represent the original proposals. Push back on weak critique. Defend sound reasoning.\n\n';
  } else if (receptiveMode === 'adaptive') {
    receptionPrefix = 'RECEPTION MODE: Evaluate each critique on its merits. Incorporate strong objections, push back on weak ones.\n\n';
  }

  const prompt = receptionPrefix + template
    .replace('{context}', contextSection)
    .replace('{proposals}', proposalsText)
    .replace('{critique}', critique.content);

  const response = await provider.call(model, prompt);

  return {
    model: model.split('/').pop() || model,
    content: response.content,
  };
}