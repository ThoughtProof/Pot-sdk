export * from './types.js';
export { DOMAIN_PROFILES, resolveDomain, isDomainDowngrade } from './domains.js';
export type { DomainConfig, DomainLockfile } from './domains.js';
export type { DomainProfile, OutputFormat, ReceptiveMode, ClassifiedObjection, ObjectionType, ObjectionSeverity, FailureCost, Audience, PipelineResult, CalibrationCriticResult } from './types.js';
export { parseCalibrationCriticResult } from './pipeline/critic.js';
export { calibrateConfidence } from './calibration.js';
export type { CalibrationResult } from './calibration.js';
export { factCheckCritic } from './pipeline/factcheck.js';
export type { FactCheckedObjection, FactCheckResult } from './pipeline/factcheck.js';
export { runGuard } from './pipeline/guard.js';
export type { GuardResult } from './pipeline/guard.js';
export { runExtractor, extractFeaturesStatic, reconstructFromFeatures, validateExtractedClaims } from './pipeline/extractor.js';
export { aggregateFromReasoning } from './pipeline/aggregator.js';
export type { AggregationResult, AggregationSignal } from './pipeline/aggregator.js';
export { diversifyInput } from './pipeline/diversifier.js';
export type { DiversifiedInput, RepresentationType } from './pipeline/diversifier.js';
export type { ExtractedFeature, ExtractionResult } from './pipeline/extractor.js';
export * from './verify.js';
export { createProvider, createProviderFromConfig, assignRoles } from './providers/index.js';
export { deepAnalysis } from './deep.js';
export { createAttestation } from './attestation.js';
export type { AttestationOptions } from './attestation.js';
export { verifyCredential } from './credential.js';
export type { CredentialVerifyResult } from './credential.js';
export { scanForAdversarialPatterns } from './security.js';
export type { AdversarialScanResult } from './security.js';
export { formatDivergenceReport } from './divergence.js';
export type { DivergenceReport, DivergenceLevel } from './divergence.js';
export { computeDPR } from './metrics/dpr.js';
export { signSchema, verifySchema, canonicalize } from './schema.js';
export type { SchemaSignature, SchemaVerifyResult } from './schema.js';
export { runSandboxCheck, extractCodeBlocks } from './sandbox.js';
export type { SandboxCheckResult, SandboxAttestation } from './sandbox.js';
export {
  CALIBRATED_NORMALIZE_SYSTEM,
  CALIBRATED_NORMALIZE_USER_TEMPLATE,
  buildCalibratedNormalizePrompt,
  parseCalibratedNormalizeOutput,
} from './prompts/calibrated-normalize.js';
export type { NormalizeInput, NormalizeOutput } from './prompts/calibrated-normalize.js';

// ── ERC-8004 Validation Provider ───────────────────────────────────────────
export {
  toValidationRecord,
  buildEvidence,
  createTrustDeclaration,
  getFinalityLevel,
} from './erc8004.js';
export type {
  ERC8004ValidationRecord,
  ERC8004TrustDeclaration,
  ERC8004Evidence,
  ERC8004Options,
} from './erc8004.js';