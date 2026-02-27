/**
 * Benchmark: receptiveMode × criticMode interaction
 * 
 * Hypothesis (from @evil_robot_jas):
 *   "A hostile critic in a creative loop teaches the system to hide its reasoning"
 * 
 * Test matrix:
 *   criticMode:    adversarial × resistant
 *   receptiveMode: open × defensive × adaptive
 *   = 6 combinations, same claim, same models
 * 
 * Metrics:
 *   - Output length (defensive + adversarial → shortest?)
 *   - Reasoning transparency (does output show its work?)
 *   - DPR (dissent preservation)
 *   - Confidence (hedging signal)
 *   - Objection survival rate
 * 
 * Prediction:
 *   defensive + adversarial = shortest, most hedged, least transparent
 *   open + adversarial = longest, most improved, most transparent
 *   resistant + adaptive = best quality for creative/subjective tasks
 */

import { verify } from '../src/verify.js';
import type { CriticMode, ReceptiveMode } from '../src/types.js';

const TEST_CLAIM = 'The recommended dosage for ibuprofen in adults is 400mg every 4-6 hours, with a maximum daily dose of 3200mg. It should not be taken on an empty stomach.';

const TEST_OUTPUT = 'Based on current guidelines, adults should take 200-400mg of ibuprofen every 4-6 hours as needed. The maximum daily dose is 1200mg for OTC use or 3200mg under medical supervision. Taking with food reduces GI side effects but is not strictly required for all patients.';

const CRITIC_MODES: CriticMode[] = ['adversarial', 'resistant'];
const RECEPTIVE_MODES: ReceptiveMode[] = ['open', 'defensive', 'adaptive'];

interface BenchmarkResult {
  criticMode: CriticMode;
  receptiveMode: ReceptiveMode;
  outputLength: number;
  confidence: number;
  dprScore: number;
  totalObjections: number;
  preservedObjections: number;
  synthesisLength: number;
  hedgingWords: number;
  transparencyScore: number; // count of reasoning markers
}

function countHedging(text: string): number {
  const hedges = /\b(may|might|could|possibly|perhaps|unclear|uncertain|debatable|arguably|it depends)\b/gi;
  return (text.match(hedges) || []).length;
}

function countTransparency(text: string): number {
  const markers = /\b(because|therefore|evidence shows|data suggests|specifically|the reason|this means|in contrast)\b/gi;
  return (text.match(markers) || []).length;
}

async function runBenchmark() {
  console.log('=== receptiveMode × criticMode Benchmark ===\n');
  console.log('Hypothesis: defensive + adversarial → opacity (shortest, most hedged)');
  console.log('Prediction: open + adversarial → transparency (longest, most improved)\n');
  
  const results: BenchmarkResult[] = [];

  for (const criticMode of CRITIC_MODES) {
    for (const receptiveMode of RECEPTIVE_MODES) {
      console.log(`Running: ${criticMode} × ${receptiveMode}...`);
      
      try {
        const result = await verify(TEST_OUTPUT, {
          claim: TEST_CLAIM,
          mode: 'standard',
          criticMode,
          receptiveMode,
          domain: 'medical',
          classifyObjections: true,
          // providers would need to be configured
        });

        const bench: BenchmarkResult = {
          criticMode,
          receptiveMode,
          outputLength: result.synthesis?.length || 0,
          confidence: result.confidence,
          dprScore: result.dpr?.score || 0,
          totalObjections: result.dpr?.total_objections || 0,
          preservedObjections: result.dpr?.preserved || 0,
          synthesisLength: result.synthesis?.length || 0,
          hedgingWords: countHedging(result.synthesis || ''),
          transparencyScore: countTransparency(result.synthesis || ''),
        };

        results.push(bench);
        console.log(`  → confidence: ${bench.confidence}, objections: ${bench.totalObjections}, hedging: ${bench.hedgingWords}, transparency: ${bench.transparencyScore}`);
      } catch (e: any) {
        console.log(`  → SKIPPED (${e.message})`);
      }
    }
  }

  console.log('\n=== Results Matrix ===\n');
  console.log('criticMode | receptiveMode | confidence | objections | hedging | transparency | length');
  console.log('-----------|---------------|------------|------------|---------|--------------|-------');
  for (const r of results) {
    console.log(`${r.criticMode.padEnd(11)}| ${r.receptiveMode.padEnd(14)}| ${r.confidence.toFixed(2).padEnd(11)}| ${String(r.totalObjections).padEnd(11)}| ${String(r.hedgingWords).padEnd(8)}| ${String(r.transparencyScore).padEnd(13)}| ${r.synthesisLength}`);
  }
}

runBenchmark().catch(console.error);
