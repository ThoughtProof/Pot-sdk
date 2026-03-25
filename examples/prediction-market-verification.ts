/**
 * ThoughtProof + Polymarket: Decision Verification before Settlement
 *
 * Demo: An autonomous trading agent wants to execute a trade.
 * ThoughtProof verifies the reasoning with:
 *   1. Machine Consensus (multi-model verification)
 *   2. Human Collective Intelligence (Polymarket signals)
 *
 * Result: ALLOW / HOLD with confidence score + PM enrichment
 *
 * Usage:
 *   npx tsx examples/prediction-market-verification.ts
 */

import {
  enrichVerification,
  queryCollectiveIntelligence,
  type CollectiveIntelligenceResult,
  type PolymarketEnrichment,
} from '../packages/polymarket/src/index.js';

// ─── Simulated Agent Decision ──────────────────────────────

interface AgentDecision {
  agent: string;
  action: string;
  claim: string;
  amount: string;
  reasoning: string;
}

const agentDecision: AgentDecision = {
  agent: 'Olas Predict Agent #4721',
  action: 'BUY YES on Polymarket',
  claim: 'Will Bitcoin reach $200K by end of 2026?',
  amount: '$2,500 USDC',
  reasoning: `
    Based on my analysis:
    1. Bitcoin ETF inflows continue at record pace ($2.1B/week average)
    2. Post-halving supply shock historically drives 4-6x rallies
    3. Institutional adoption accelerating (sovereign wealth funds entering)
    4. Current price trajectory and momentum indicators suggest $200K is achievable
    5. Risk/reward ratio favorable at current levels

    Confidence: 78%
    Recommended action: BUY YES at current market price (0.35)
  `,
};

// ─── Simulated Model Consensus (normally from pot-sdk core) ──

interface ModelConsensus {
  verdict: 'ALLOW' | 'BLOCK' | 'UNCERTAIN';
  confidence: number;
  models: Array<{
    name: string;
    verdict: string;
    critique: string;
  }>;
}

const modelConsensus: ModelConsensus = {
  verdict: 'ALLOW',
  confidence: 0.72,
  models: [
    {
      name: 'DeepSeek R1',
      verdict: 'ALLOW',
      critique:
        'Reasoning is generally sound. ETF inflow data is accurate. However, the agent may underweight macro risks (recession, regulatory crackdown). The 78% confidence feels slightly high given the 10-month timeframe.',
    },
    {
      name: 'Grok 4.2',
      verdict: 'ALLOW',
      critique:
        'X/Twitter sentiment analysis supports bullish thesis. Real-time data shows institutional buying accelerating. However, $200K is a significant milestone that may face heavy resistance. Agent reasoning is directionally correct but price target is aggressive.',
    },
    {
      name: 'Claude Sonnet',
      verdict: 'UNCERTAIN',
      critique:
        'The fundamental analysis is solid, but the agent commits a base rate neglect fallacy — Bitcoin has only exceeded prior ATH by >3x twice in history. The halving correlation is real but weaker with each cycle. I would rate this at 35-40% probability, not 78%.',
    },
  ],
};

// ─── Main Demo ─────────────────────────────────────────────

async function runDemo() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ThoughtProof — Decision Verification before Settlement');
  console.log('  Machine Consensus + Human Collective Intelligence');
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Show the agent's decision
  console.log('📋 AGENT DECISION REQUEST');
  console.log('─────────────────────────');
  console.log(`Agent:   ${agentDecision.agent}`);
  console.log(`Action:  ${agentDecision.action}`);
  console.log(`Claim:   ${agentDecision.claim}`);
  console.log(`Amount:  ${agentDecision.amount}`);
  console.log(`\nAgent Reasoning:\n${agentDecision.reasoning}`);

  // Step 2: Show model consensus
  console.log('\n🤖 MACHINE CONSENSUS (Multi-Model Verification)');
  console.log('────────────────────────────────────────────────');
  console.log(`Verdict:    ${modelConsensus.verdict}`);
  console.log(
    `Confidence: ${(modelConsensus.confidence * 100).toFixed(0)}%`
  );
  console.log('\nModel Critiques:');
  for (const model of modelConsensus.models) {
    console.log(`\n  ${model.name}: ${model.verdict}`);
    console.log(`  → ${model.critique}`);
  }

  // Step 3: Query Polymarket for Human Collective Intelligence
  console.log(
    '\n\n🌍 HUMAN COLLECTIVE INTELLIGENCE (Prediction Market Signals)'
  );
  console.log('────────────────────────────────────────────────────────');
  console.log('Querying Polymarket for relevant market data...\n');

  let pmResult: CollectiveIntelligenceResult;
  try {
    pmResult = await queryCollectiveIntelligence(agentDecision.claim);

    if (pmResult.primarySignal) {
      const signal = pmResult.primarySignal;
      console.log(`Markets found:     ${pmResult.signals.length}`);
      console.log(
        `Primary market:    "${signal.market.question}"`
      );
      console.log(
        `Market probability: ${(signal.probability * 100).toFixed(1)}%`
      );
      console.log(`Signal strength:    ${signal.strength}`);
      console.log(
        `Open Interest:      $${(signal.backedBy / 1_000_000).toFixed(1)}M`
      );
      console.log(
        `Signal confidence:  ${(signal.signalConfidence * 100).toFixed(1)}%`
      );
      console.log(
        `\nAlignment with claim: ${pmResult.alignment}`
      );
      console.log(`\n${pmResult.synthesis}`);
    } else {
      console.log(
        'No relevant prediction market data found.'
      );
      console.log('Proceeding with Machine Consensus only.');
    }
  } catch (error) {
    console.log(
      `⚠️ Polymarket API unavailable: ${error instanceof Error ? error.message : 'unknown'}`
    );
    console.log('Proceeding with Machine Consensus only (fail-open).');
  }

  // Step 4: Enrichment — combine both signals
  console.log(
    '\n\n🔗 ENRICHED VERIFICATION (Machine + Human Intelligence)'
  );
  console.log('──────────────────────────────────────────────────────');

  let enrichment: PolymarketEnrichment;
  try {
    enrichment = await enrichVerification({
      claim: agentDecision.claim,
      modelVerdict: modelConsensus.verdict,
      modelConfidence: modelConsensus.confidence,
      stakeLevel: 'high',
    });

    console.log(`PM Data Available:    ${enrichment.available}`);
    console.log(`Modifies Verdict:     ${enrichment.modifiesVerdict}`);
    console.log(`Verdict Adjustment:   ${enrichment.verdictAdjustment}`);
    console.log(`\n${enrichment.contextForSynthesis}`);
  } catch {
    console.log('Enrichment unavailable. Using model consensus only.');
    enrichment = {
      available: false,
      result: null,
      modifiesVerdict: false,
      verdictAdjustment: 'none',
      contextForSynthesis: 'PM data unavailable.',
    };
  }

  // Step 5: Final verdict
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  📜 FINAL VERIFICATION RESULT');
  console.log('═══════════════════════════════════════════════════════\n');

  const finalVerdict =
    enrichment.verdictAdjustment === 'flag' ? 'HOLD' : modelConsensus.verdict;
  const emoji = finalVerdict === 'ALLOW' ? '✅' : '⏸️';

  console.log(`  ${emoji} Verdict: ${finalVerdict}`);
  console.log(
    `  Machine Confidence: ${(modelConsensus.confidence * 100).toFixed(0)}%`
  );

  if (enrichment.available && enrichment.result?.collectiveConfidence) {
    console.log(
      `  Collective Intelligence: ${(enrichment.result.collectiveConfidence * 100).toFixed(0)}%`
    );
  }

  if (finalVerdict === 'HOLD') {
    console.log(
      '\n  ⚠️ HOLD: Prediction market data contradicts model consensus.'
    );
    console.log(
      '  The crowd sees something the models may have missed.'
    );
    console.log('  Recommend human review before settlement.');
  } else if (enrichment.verdictAdjustment === 'strengthen') {
    console.log(
      '\n  ✅ STRENGTHENED: Machine + Human intelligence are aligned.'
    );
    console.log('  Higher confidence in this verification.');
  }

  console.log(
    '\n  ThoughtProof: Decision Verification before Settlement.'
  );
  console.log('  No single model. No blind trust. Verify everything.\n');
}

// Run the demo
runDemo().catch(console.error);
