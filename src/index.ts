// ── pot-sdk v2.0.0 ────────────────────────────────────────────────────────────
//
// Public API surface. Internal types (InternalVerdict, VerificationMode) are
// intentionally NOT re-exported here — they must not appear in API responses
// or be matched by external consumers.
//
// Breaking changes from v1.x:
//   - Verdict: ALLOW | BLOCK | UNCERTAIN  (was VERIFIED | UNVERIFIED | UNCERTAIN | DISSENT)
//   - tier:    'lite' | 'standard'        (was 'basic' | 'pro')
//   - StakeLevel: 'low' | 'medium' | 'high' | 'critical'  (removed 'micro')
//   - New required fields: severity_score, mdi, objections, domain, stakeLevel, durationMs
// ─────────────────────────────────────────────────────────────────────────────

// ── Core public types ─────────────────────────────────────────────────────────
export type {
  Verdict,
  PublicTier,
  StakeLevel,
  CriticMode,
  ObjectionSeverity,
  ObjectionType,
  ClassifiedObjection,
  DomainProfile,
  TrustContext,
  OutputFormat,
  Audience,
  CalibrationCriticResult,
  PipelineResult,
  ReceptiveMode,
  FailureCost,
  DPRResult,
  TPVerificationCredential,
  GeneratorConfig,
  ProviderConfig,
  VerifyOptions,
  VerificationResult,
  Proposal,
  Critique,
  Synthesis,
  APIResponse,
  Provider,
  VerificationFlag,
  DissentReport,
} from './types.js';

// ── Stake detection (v2.0) ────────────────────────────────────────────────────
export { detectStake } from './stake.js';

// ── Stake thresholds (public) ─────────────────────────────────────────────────
export { STAKE_THRESHOLDS } from './types.js';

// ── Domain utilities ──────────────────────────────────────────────────────────
export {
  DOMAIN_PROFILES,
  DOMAIN_REFERENCE_CONTEXT,
  resolveDomain,
  isDomainDowngrade,
  detectDomain,
} from './domains.js';
export type { DomainConfig, DomainLockfile } from './domains.js';

// ── Pipeline utilities ────────────────────────────────────────────────────────
export {
  parseCalibrationCriticResult,
  parseMaterialityClassifications,
  calculateMaterialityConfidence,
} from './pipeline/critic.js';
export type {
  MaterialityLevel,
  OverallAssessment,
  MaterialityObjection,
  MaterialityResult,
} from './pipeline/critic.js';

export { calibrateConfidence, calibrateByModel } from './calibration.js';
export type { CalibrationResult } from './calibration.js';

export { factCheckCritic } from './pipeline/factcheck.js';
export type { FactCheckedObjection, FactCheckResult } from './pipeline/factcheck.js';

export { runGuard } from './pipeline/guard.js';
export type { GuardResult } from './pipeline/guard.js';

export {
  runExtractor,
  extractFeaturesStatic,
  reconstructFromFeatures,
  validateExtractedClaims,
} from './pipeline/extractor.js';

export { aggregateFromReasoning } from './pipeline/aggregator.js';
export type { AggregationResult, AggregationSignal } from './pipeline/aggregator.js';

export { diversifyInput } from './pipeline/diversifier.js';
export type { DiversifiedInput, RepresentationType } from './pipeline/diversifier.js';

export type { ExtractedFeature, ExtractionResult } from './pipeline/extractor.js';

// ── Core verify() ─────────────────────────────────────────────────────────────
export * from './verify.js';

// ── Provider utilities ────────────────────────────────────────────────────────
export { createProvider, createProviderFromConfig, assignRoles } from './providers/index.js';

// ── Advanced pipeline ─────────────────────────────────────────────────────────
export { deepAnalysis } from './deep.js';

// ── Credential / attestation ──────────────────────────────────────────────────
export { createAttestation } from './attestation.js';
export type { AttestationOptions } from './attestation.js';

export { verifyCredential } from './credential.js';
export type { CredentialVerifyResult } from './credential.js';

// ── Security ──────────────────────────────────────────────────────────────────
export { scanForAdversarialPatterns } from './security.js';
export type { AdversarialScanResult } from './security.js';

// ── Divergence ────────────────────────────────────────────────────────────────
export { formatDivergenceReport } from './divergence.js';
export type { DivergenceReport, DivergenceLevel } from './divergence.js';

// ── Metrics ───────────────────────────────────────────────────────────────────
export { computeDPR } from './metrics/dpr.js';

// ── Schema ────────────────────────────────────────────────────────────────────
export { signSchema, verifySchema, canonicalize } from './schema.js';
export type { SchemaSignature, SchemaVerifyResult } from './schema.js';

// ── Sandbox ───────────────────────────────────────────────────────────────────
export { runSandboxCheck, extractCodeBlocks } from './sandbox.js';
export type { SandboxCheckResult, SandboxAttestation } from './sandbox.js';

// ── Calibrated normalize prompts ──────────────────────────────────────────────
export {
  CALIBRATED_NORMALIZE_SYSTEM,
  CALIBRATED_NORMALIZE_USER_TEMPLATE,
  buildCalibratedNormalizePrompt,
  parseCalibratedNormalizeOutput,
} from './prompts/calibrated-normalize.js';
export type { NormalizeInput, NormalizeOutput } from './prompts/calibrated-normalize.js';

// ── ERC-8004 Validation Provider ──────────────────────────────────────────────
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
