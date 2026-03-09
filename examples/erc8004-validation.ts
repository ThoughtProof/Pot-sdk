/**
 * Example: Using pot-sdk as an ERC-8004 Validation Provider
 *
 * This example shows the full flow:
 * 1. Verify an agent's output using pot-sdk
 * 2. Create an attestation (TP-VC)
 * 3. Build ERC-8004 evidence payload
 * 4. Generate a validation record for the Validation Registry
 * 5. Generate a trust declaration for agent registration
 *
 * In production, you would:
 * - Pin the evidence to IPFS
 * - Submit the validation record to the ERC-8004 Validation Registry contract
 * - Include the trust declaration in your agent's registration metadata
 */

import {
  verify,
  createAttestation,
  toValidationRecord,
  buildEvidence,
  createTrustDeclaration,
  getFinalityLevel,
} from 'pot-sdk';

async function main() {
  // ── Step 1: Verify an agent's output ──────────────────────────────────

  const agentOutput = `
    Based on analysis of the smart contract, the function implements
    a reentrancy guard correctly. The mutex lock is acquired before
    the external call and released after. No vulnerability found.
  `;

  const result = await verify(agentOutput, {
    claim: 'Smart contract reentrancy guard is correctly implemented',
    mode: 'standard',
    providers: [
      { name: 'openai',   model: 'gpt-4o',         apiKey: process.env.OPENAI_API_KEY! },
      { name: 'anthropic', model: 'claude-sonnet-4-5', apiKey: process.env.ANTHROPIC_API_KEY! },
      { name: 'deepseek', model: 'deepseek-chat',   apiKey: process.env.DEEPSEEK_API_KEY!, baseUrl: 'https://api.deepseek.com/v1' },
      { name: 'xai',      model: 'grok-3',          apiKey: process.env.XAI_API_KEY!, baseUrl: 'https://api.x.ai/v1' },
    ],
  });

  console.log(`Verdict: ${result.verdict}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Finality: ${getFinalityLevel(result)}`);

  // ── Step 2: Create attestation (TP-VC) ────────────────────────────────

  const credential = createAttestation(result, {
    claim: 'Smart contract reentrancy guard is correctly implemented',
    type: 'code',
  });

  console.log(`Credential ID: ${credential.id}`);

  // ── Step 3: Build evidence for IPFS ───────────────────────────────────

  const evidence = buildEvidence(result, credential);

  console.log(`Evidence hash: ${evidence.metadata.evidence_hash}`);
  console.log(`Evidence size: ${JSON.stringify(evidence).length} bytes`);

  // In production: pin to IPFS
  // const cid = await ipfs.pin(JSON.stringify(evidence));
  const evidenceUri = 'ipfs://QmYourEvidenceCIDHere';

  // ── Step 4: Create ERC-8004 Validation Record ─────────────────────────

  const record = toValidationRecord(result, {
    evidenceUri,
    validatorAgentId: 'erc8004:1:12345',   // ThoughtProof's agent ID
    targetAgentId:    'erc8004:1:67890',    // Agent being validated
    chainId:          8453,                  // Base
  });

  console.log('\nERC-8004 Validation Record:');
  console.log(JSON.stringify(record, null, 2));

  // In production: submit to Validation Registry contract
  // await validationRegistry.submitValidation(record);

  // ── Step 5: Trust Declaration for agent registration ──────────────────

  const trustDecl = createTrustDeclaration(
    ['openai', 'anthropic', 'xai', 'deepseek'],
  );

  console.log('\nERC-8004 Trust Declaration (for agent registration):');
  console.log(JSON.stringify(trustDecl, null, 2));

  // Include in agent registration file:
  // { "supportedTrust": [trustDecl] }
}

main().catch(console.error);
