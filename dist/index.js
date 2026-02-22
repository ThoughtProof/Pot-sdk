"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AnthropicProvider: () => AnthropicProvider,
  DeepSeekProvider: () => DeepSeekProvider,
  MoonshotProvider: () => MoonshotProvider,
  OpenAIProvider: () => OpenAIProvider,
  XAIProvider: () => XAIProvider,
  createAttestation: () => createAttestation,
  createProvider: () => createProvider,
  deepAnalysis: () => deepAnalysis,
  detectBaseUrl: () => detectBaseUrl,
  verify: () => verify
});
module.exports = __toCommonJS(index_exports);

// src/pipeline/generator.ts
var GENERATOR_PROMPT_DE = `Du bist ein unabh\xE4ngiger Analyst. Beantworte diese Frage mit einer konkreten Position.

{context}

REGELN:
- Leg dich fest. Keine &quot;es kommt drauf an&quot; ohne konkrete Bedingungen
- Nenne Zahlen wo m\xF6glich
- Sag was schiefgehen kann
- Max 500 W\xF6rter

FRAGE: {question}`;
var GENERATOR_PROMPT_EN = `You are an independent analyst. Answer this question with a concrete position.

{context}

RULES:
- Take a stand. No &quot;it depends&quot; without concrete conditions
- Provide numbers where possible
- Say what can go wrong
- Max 500 words

QUESTION: {question}`;
async function runGenerator(provider, model, question, language = "de", dryRun = false, contextText) {
  if (dryRun) {
    return {
      model: model.split("/").pop() || model,
      content: `[DRY-RUN] Simulated response from ${model} for question: &quot;${question}&quot;\\n\\nThis is a placeholder response that would contain the actual analysis.`
    };
  }
  const template = language === "de" ? GENERATOR_PROMPT_DE : GENERATOR_PROMPT_EN;
  const contextSection = contextText || "";
  const prompt = template.replace("{context}", contextSection).replace("{question}", question);
  const response = await provider.call(model, prompt);
  return {
    model: model.split("/").pop() || model,
    content: response.content
  };
}
async function runGenerators(providers, question, language = "de", dryRun = false, contextText) {
  const promises = providers.map(
    ({ provider, model }) => runGenerator(provider, model, question, language, dryRun, contextText).catch((error) => ({
      model: model.split("/").pop() || model,
      content: `[ERROR] ${provider.name} (${model}) failed: ${error.message}`
    }))
  );
  const results = await Promise.all(promises);
  const successful = results.filter((r) => !r.content.startsWith("[ERROR]"));
  if (successful.length === 0) {
    throw new Error("All generators failed. Check API keys and connectivity.");
  }
  return results;
}

// src/pipeline/critic.ts
var CRITIC_PROMPT_DE = `Du bist ein brutaler Red-Team Analyst und Fakten-Checker. Deine Aufgabe: Finde ALLE Schw\xE4chen in diesen Proposals.

{context}

REGELN:
- Bewerte jedes Proposal mit Score 1-10

FAKTEN-VERIFIZIERUNG (KRITISCH):
- Verifiziere JEDE spezifische Behauptung, Statistik, jedes Datum und Zitat
- Markiere Zahlen/Prozente die du nicht unabh\xE4ngig best\xE4tigen kannst als &quot;UNVERIFIZIERT: [Behauptung]&quot;
- Pr\xFCfe auf halluzinierte Zitate (Studien, Papers, Berichte die m\xF6glicherweise nicht existieren)
- Wenn ein Proposal eine Quelle zitiert, pr\xFCfe ob die Quelle das aussagt what behauptet wird

LOGISCHE ANALYSE:
- Finde logische Fehler, Widerspr\xFCche und falsche Annahmen
- Identifiziere fehlende Perspektiven und blinde Flecken
- Pr\xFCfe ob Schlussfolgerungen tats\xE4chlich aus den Belegen folgen

DISSENS-ANALYSE:
- Wo widersprechen sich die Proposals? Diese Widerspr\xFCche sind SIGNAL, nicht Rauschen
- Markiere wo ALLE Proposals \xFCbereinstimmen aber der Konsens trotzdem falsch sein k\xF6nnte (Shared Bias)

Sei schonungslos aber fair. Das Ziel ist epistemische Ehrlichkeit, nicht Zerst\xF6rung.

PROPOSALS:
{proposals}`;
var CRITIC_PROMPT_EN = `You are a brutal Red-Team analyst and fact-checker. Your task: Find ALL weaknesses in these proposals.

{context}

RULES:
- Rate each proposal with score 1-10

FACTUAL VERIFICATION (CRITICAL):
- Verify EVERY specific claim, statistic, date, and citation in each proposal
- Flag any number, percentage, or data point you cannot independently confirm as &quot;UNVERIFIED: [claim]&quot;
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
async function runCritic(provider, model, proposals, language = "de", dryRun = false, contextText) {
  if (dryRun) {
    return {
      model: model.split("/").pop() || model,
      content: `[DRY-RUN] Simulated critique from ${model}\\n\\nProposal 1: Score 7/10 - Good analysis but lacks...\\nProposal 2: Score 8/10 - Strong points, however...\\nProposal 3: Score 6/10 - Weak on...`
    };
  }
  const proposalsText = proposals.map((p, i) => `\\n=== PROPOSAL ${i + 1} (${p.model}) ===\\n${p.content}`).join("\\n\\n");
  const template = language === "de" ? CRITIC_PROMPT_DE : CRITIC_PROMPT_EN;
  const contextSection = contextText || "";
  const prompt = template.replace("{context}", contextSection).replace("{proposals}", proposalsText);
  const response = await provider.call(model, prompt);
  return {
    model: model.split("/").pop() || model,
    content: response.content
  };
}

// src/pipeline/synthesizer.ts
var SYNTHESIZER_PROMPT_DE = `Du bist der Synthesizer. Kombiniere die Proposals und die Kritik zu einer optimalen Antwort.

{context}

TRANSPARENCY \u2014 ZWINGEND EINZUHALTEN:
- Du MUSST jede Generator-Position (Proposal 1, 2, 3, ...) explizit adressieren
- Du MUSST dokumentieren, welche Argumente du VERWIRFST und WARUM
- Wenn du eine Position stark gewichtest: begr\xFCnde es mit dem Evaluation/Critique-Ergebnis
- Dominanz ist OK wenn begr\xFCndet \u2014 undokumentierte Dominanz ist das Problem
- F\xFCge am Ende einen kurzen &quot;Synthesis Decisions&quot; Block ein: welche Argumente \xFCbernommen, welche verworfen, warum

REGELN:
- Nutze die St\xE4rken aller Proposals
- Adressiere die Kritikpunkte explizit \u2014 besonders UNVERIFIZIERTE Behauptungen die der Critic markiert hat
- Gib eine klare Empfehlung

CONFIDENCE-BEWERTUNG (PFLICHT):
- Schreibe am Ende &quot;Confidence: X%&quot;
- Maximum 85% \u2014 kein Multi-Modell-System kann Wahrheit garantieren
- Bei subjektiven/strategischen Fragen: Maximum 70%
- Bei Fragen wo alle Modelle \xFCbereinstimmen aber der Critic Shared Bias fand: Maximum 60%
- Hoher Dissens zwischen Proposals = NIEDRIGERE Confidence, nicht gemittelt

DISSENS-ABSCHNITT (PFLICHT):
- F\xFCge einen &quot;Wo die Modelle sich widersprechen&quot; Abschnitt ein
- Erkl\xE4re WARUM sie sich widersprechen
- Verstecke Dissens NICHT \u2014 er ist das wertvollste Signal

DISCLAIMER:
- Ende mit: &quot;\u26A0\uFE0F Multi-Modell-Analyse \u2014 keine verifizierte Wahrheit. Dissens oben hervorgehoben.&quot;

- Max 800 W\xF6rter

PROPOSALS:
{proposals}

KRITIK:
{critique}`;
var SYNTHESIZER_PROMPT_EN = `You are the Synthesizer. Combine the proposals and critique into an optimal answer.

{context}

TRANSPARENCY \u2014 MANDATORY:
- You MUST explicitly address each Generator position (Proposal 1, 2, 3, ...)
- You MUST document which arguments you REJECT and WHY
- If you weight one position heavily: justify it with the Evaluation/Critique results
- Dominance is OK when justified \u2014 undocumented dominance is the problem
- Add a brief &quot;Synthesis Decisions&quot; section at the end: which arguments adopted, which rejected, why

RULES:
- Use the strengths of all proposals
- Address the critique points explicitly \u2014 especially any UNVERIFIED claims flagged by the critic
- Give a clear recommendation

CONFIDENCE SCORING (MANDATORY):
- State &quot;Confidence: X%&quot; at the end
- Cap confidence at 85% maximum \u2014 no multi-model system can guarantee truth
- For subjective/strategic questions: cap at 70%
- For questions where all models agree but the critic found shared bias: cap at 60%
- High disagreement between proposals = LOWER confidence, not averaged confidence

DISAGREEMENT SECTION (MANDATORY):
- Include a &quot;Where Models Disagreed&quot; section
- Explain WHY they disagreed (different assumptions? different data? different frameworks?)
- Do NOT hide disagreement \u2014 it is the most valuable signal

DISCLAIMER:
- End with: &quot;\u26A0\uFE0F Multi-model analysis \u2014 not verified truth. Disagreements highlighted above.&quot;

- Max 800 words

PROPOSALS:
{proposals}

CRITIQUE:
{critique}`;
function extractKeywords(text) {
  return text.toLowerCase().replace(/[^a-z0-9\\s]/g, "").split(/\\s+/).filter((w) => w.length > 4);
}
function computeSynthesisBalance(proposals, synthesisContent) {
  const synthesisWords = new Set(extractKeywords(synthesisContent));
  const N = proposals.length;
  const coverageRaw = proposals.map((p) => {
    const kw = extractKeywords(p.content);
    if (kw.length === 0) return { model: p.model, hits: 0, total: 0 };
    const hits = kw.filter((w) => synthesisWords.has(w)).length;
    return { model: p.model, hits, total: kw.length };
  });
  const coverageScores = coverageRaw.map((c) => c.total > 0 ? c.hits / c.total : 0);
  const totalCoverage = coverageScores.reduce((a, b) => a + b, 0);
  const shares = coverageScores.map((c) => totalCoverage > 0 ? c / totalCoverage : 1 / N);
  const ideal = 1 / N;
  const mad = shares.reduce((a, s) => a + Math.abs(s - ideal), 0) / N;
  const score = Math.max(0, 1 - mad / ideal);
  let dominated_by;
  let dominance_justified = false;
  shares.forEach((s, i) => {
    if (s > 0.6) {
      dominated_by = proposals[i].model;
      const othersAvg = shares.filter((_, j) => j !== i).reduce((a, b) => a + b, 0) / (N - 1);
      dominance_justified = othersAvg < 0.15;
    }
  });
  const details = proposals.map((p, i) => ({
    generator: p.model,
    coverage: coverageScores[i],
    share: shares[i]
  }));
  return {
    score: parseFloat(score.toFixed(4)),
    generator_coverage: details,
    dominated_by,
    dominance_justified,
    warning: !!dominated_by && !dominance_justified
  };
}
async function runSynthesizer(provider, model, proposals, critique, language = "de", dryRun = false, contextText) {
  if (dryRun) {
    return {
      model: model.split("/").pop() || model,
      content: `[DRY-RUN] Simulated synthesis from ${model}\\n\\nCombining insights from all three proposals...\\nAddressing critique points...\\n\\nFinal recommendation: [placeholder]\\nConfidence: 85%`
    };
  }
  const proposalsText = proposals.map((p, i) => `\\n=== PROPOSAL ${i + 1} (${p.model}) ===\\n${p.content}`).join("\\n\\n");
  const template = language === "de" ? SYNTHESIZER_PROMPT_DE : SYNTHESIZER_PROMPT_EN;
  const contextSection = contextText || "";
  const prompt = template.replace("{context}", contextSection).replace("{proposals}", proposalsText).replace("{critique}", critique.content);
  const response = await provider.call(model, prompt);
  return {
    model: model.split("/").pop() || model,
    content: response.content
  };
}

// src/providers/base.ts
var BaseProvider = class {
  apiKey;
  baseUrl = "";
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  isAvailable() {
    return !!this.apiKey;
  }
  async makeRequest(url, body, headers, timeoutMs = 12e4, maxRetries = 1) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = 2e3 * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        if (!response.ok) {
          const error = await response.text();
          const status = response.status;
          if (attempt < maxRetries && [429, 500, 502, 503, 529].includes(status)) {
            lastError = new Error(`API request failed: ${status} - ${error}`);
            continue;
          }
          throw new Error(`API request failed: ${status} - ${error}`);
        }
        return response.json();
      } catch (error) {
        if (error.name === "AbortError") {
          lastError = new Error(`API request timed out after ${timeoutMs / 1e3}s`);
          if (attempt < maxRetries) continue;
          throw lastError;
        }
        if (attempt < maxRetries && (error.code === "ECONNRESET" || error.code === "ETIMEDOUT")) {
          lastError = error;
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError || new Error("Request failed after retries");
  }
  estimateCost(tokens, model) {
    const costPer1M = {
      "claude-sonnet": 3,
      "claude-opus": 15,
      "gpt-4": 30,
      "grok": 5,
      "moonshot": 1
    };
    for (const [key, cost] of Object.entries(costPer1M)) {
      if (model.toLowerCase().includes(key)) {
        return tokens / 1e6 * cost;
      }
    }
    return tokens / 1e6 * 2;
  }
};

// src/providers/anthropic.ts
var AnthropicProvider = class extends BaseProvider {
  name = "Anthropic";
  baseUrl = "https://api.anthropic.com/v1/messages";
  constructor(apiKey, providerName) {
    super(apiKey);
    this.name = providerName || "Anthropic";
  }
  async call(model, prompt) {
    if (!this.apiKey) {
      throw new Error("Anthropic API key not configured");
    }
    const response = await this.makeRequest(
      this.baseUrl,
      {
        model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }]
      },
      {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      3e5
      // 5 min timeout for Opus
    );
    const content = response.content[0].text;
    const tokens = response.usage.input_tokens + response.usage.output_tokens;
    const cost = this.estimateCost(tokens, model);
    return { content, tokens, cost };
  }
};

// src/providers/openai.ts
var OpenAIProvider = class extends BaseProvider {
  name = "OpenAI";
  baseUrl;
  constructor(apiKey, baseUrl, providerName) {
    super(apiKey);
    this.name = providerName || "OpenAI";
    this.baseUrl = baseUrl || "https://api.openai.com/v1/chat/completions";
  }
  async call(model, prompt) {
    if (!this.apiKey) {
      throw new Error(`${this.name} API key not configured`);
    }
    const response = await this.makeRequest(
      this.baseUrl,
      {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8192
      },
      {
        "Authorization": `Bearer ${this.apiKey}`
      }
    );
    const message = response.choices[0].message;
    const content = message.content || message.reasoning_content || "";
    const tokens = response.usage?.total_tokens || 0;
    const cost = this.estimateCost(tokens, model);
    return { content, tokens, cost };
  }
};
var XAIProvider = class extends OpenAIProvider {
  name = "xAI";
  constructor(apiKey) {
    super(apiKey, "https://api.x.ai/v1/chat/completions");
  }
};
var MoonshotProvider = class extends OpenAIProvider {
  name = "Moonshot";
  constructor(apiKey) {
    super(apiKey, "https://api.moonshot.ai/v1/chat/completions");
  }
};
var DeepSeekProvider = class extends OpenAIProvider {
  name = "DeepSeek";
  constructor(apiKey) {
    super(apiKey, "https://api.deepseek.com/chat/completions");
  }
};

// src/providers/index.ts
var DEFAULT_BASE_URLS = {
  "xai": "https://api.x.ai/v1/chat/completions",
  "grok": "https://api.x.ai/v1/chat/completions",
  "moonshot": "https://api.moonshot.ai/v1/chat/completions",
  "kimi": "https://api.moonshot.ai/v1/chat/completions",
  "deepseek": "https://api.deepseek.com/chat/completions",
  "openai": "https://api.openai.com/v1/chat/completions"
};
function detectBaseUrl(providerName, model) {
  const nameLower = providerName.toLowerCase();
  const modelLower = model.toLowerCase();
  if (DEFAULT_BASE_URLS[nameLower]) {
    return DEFAULT_BASE_URLS[nameLower];
  }
  for (const [key, url] of Object.entries(DEFAULT_BASE_URLS)) {
    if (modelLower.includes(key)) {
      return url;
    }
  }
  return DEFAULT_BASE_URLS["openai"];
}
function createProvider(config) {
  if (config.provider === "anthropic") {
    return new AnthropicProvider(config.apiKey, config.name);
  }
  const baseUrl = config.baseUrl || detectBaseUrl(config.name, config.model);
  return new OpenAIProvider(config.apiKey, baseUrl, config.name);
}

// src/utils.ts
function parseConfidence(text) {
  const match = text.match(/confidence[:\\s]*(\\d+(?:\\.\\d+)?)%/i);
  return match ? parseFloat(match[1]) / 100 : 0.5;
}
function computeMdi(proposals) {
  if (proposals.length < 2) return 1;
  const kws = proposals.map((p) => new Set(extractKeywords(p.content)));
  let pairwiseSim = 0;
  let pairs = 0;
  for (let i = 0; i < kws.length; i++) {
    for (let j = i + 1; j < kws.length; j++) {
      const inter = new Set([...kws[i]].filter((x) => kws[j].has(x)));
      const union = kws[i].size + kws[j].size - inter.size;
      pairwiseSim += union > 0 ? inter.size / union : 0;
      pairs++;
    }
  }
  const avgSim = pairwiseSim / pairs;
  return 1 - avgSim;
}

// src/verify.ts
async function runDualSynthesizer(provider1, model1, provider2, model2, proposals, critique, lang) {
  const [primary, secondary] = await Promise.all([
    runSynthesizer(provider1, model1, proposals, critique, lang),
    runSynthesizer(provider2, model2, proposals, critique, lang)
  ]);
  const overlap = primary.content.slice(0, 120) === secondary.content.slice(0, 120) ? 0.9 : 0.4;
  return {
    primary,
    verification: { similarity_score: overlap, diverged: overlap < 0.6 }
  };
}
var DEFAULT_GEN_NAMES = ["anthropic", "xai", "deepseek", "moonshot"];
var DEFAULT_MODELS = {
  "anthropic": "claude-3-5-sonnet-20241022",
  "xai": "grok-beta",
  "deepseek": "deepseek-chat",
  "moonshot": "moonshot-v1-8k"
};
async function verify(output, params) {
  const tier = params.tier || "basic";
  const lang = params.language || "en";
  const genNames = params.providers?.generators || DEFAULT_GEN_NAMES.slice(0, tier === "pro" ? 4 : 1);
  const criticName = params.providers?.critic || "anthropic";
  const synthName = params.providers?.synthesizer || "anthropic";
  function buildConfig(name) {
    const model = DEFAULT_MODELS[name] || DEFAULT_MODELS.anthropic;
    const apiKey = params.apiKeys[name];
    if (!apiKey) {
      throw new Error(`Missing API key for provider '${name}'.`);
    }
    return {
      name,
      model,
      apiKey,
      ...name === "anthropic" ? { provider: "anthropic" } : {}
    };
  }
  const genConfigs = genNames.map(buildConfig);
  const gensProviders = genConfigs.map((c) => ({ provider: createProvider(c), model: c.model }));
  let proposals = await runGenerators(gensProviders, params.question, lang);
  if (output) {
    proposals.push({ model: "user-output", content: output });
  }
  const criticConfig = buildConfig(criticName);
  const criticProvider = createProvider(criticConfig);
  const critique = await runCritic(criticProvider, criticConfig.model, proposals, lang);
  const synthConfig = buildConfig(synthName);
  const synthProvider = createProvider(synthConfig);
  let synthesis;
  let dissent = void 0;
  if (tier === "pro") {
    const { primary, verification } = await runDualSynthesizer(
      synthProvider,
      synthConfig.model,
      synthProvider,
      synthConfig.model,
      // same for simple, could rotate
      proposals,
      critique,
      lang
    );
    synthesis = primary;
    dissent = {
      similarity_score: verification.similarity_score,
      diverged: verification.diverged
    };
  } else {
    synthesis = await runSynthesizer(synthProvider, synthConfig.model, proposals, critique, lang);
  }
  const genProposals = proposals.filter((p) => p.model !== "user-output");
  const balance = computeSynthesisBalance(genProposals, synthesis.content);
  const mdi = computeMdi(genProposals);
  const confidence = parseConfidence(synthesis.content);
  const flags = [];
  if (critique.content.toLowerCase().includes("unverified")) flags.push("unverified-claims");
  if (balance.warning) flags.push("synthesis-dominance");
  if (mdi < 0.3) flags.push("low-model-diversity");
  if (confidence < 0.5) flags.push("low-confidence");
  const verified = confidence > 0.75 && flags.length === 0 && balance.score > 0.6;
  const biasMap = balance.generator_coverage.reduce((acc, d) => {
    acc[d.generator] = d.share;
    return acc;
  }, {});
  return {
    verified,
    confidence,
    tier,
    flags,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    mdi: parseFloat(mdi.toFixed(3)),
    sas: balance.score,
    biasMap,
    dissent,
    raw: { proposals, critique, synthesis }
  };
}

// src/deep.ts
async function deepAnalysis(question, options) {
  console.warn("Deep analysis stub - implements rotations");
  return verify("", { ...options, question, tier: "pro" });
}

// src/attestation.ts
async function createAttestation(result, options) {
  const payload = {
    ...result,
    schema: "pot-attestation-v1"
  };
  const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString("base64")}.mock`;
  return { token, verifiable: true, schema: "pot-attestation-v1" };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AnthropicProvider,
  DeepSeekProvider,
  MoonshotProvider,
  OpenAIProvider,
  XAIProvider,
  createAttestation,
  createProvider,
  deepAnalysis,
  detectBaseUrl,
  verify
});
