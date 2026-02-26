/**
 * Schema Signing — Layer 0 of the PoT verification pipeline.
 *
 * Verify the *contract* before verifying the *output*.
 *
 * Use case: Sign a tool schema at deployment time and verify it at
 * runtime. If the hash differs, the schema was tampered — abort.
 *
 * Usage:
 *   const sig = signSchema(myToolSchema);
 *   // store sig in env / secrets manager
 *
 *   const check = verifySchema(myToolSchema, sig);
 *   if (check.drifted) throw new Error('Schema tampered!');
 */

import { createHash } from 'crypto';

export interface SchemaSignature {
  /** SHA-256 hash of the canonical schema JSON */
  hash: string;
  /** ISO timestamp of when the schema was signed */
  signedAt: string;
  /** pot-sdk version that produced this signature */
  sdkVersion: string;
  /** Optional label for the schema (e.g. "weather-tool-v1") */
  label?: string;
}

export interface SchemaVerifyResult {
  /** true if the schema matches the signature */
  valid: boolean;
  /** true if the schema has changed since signing */
  drifted: boolean;
  /** hash of the current schema */
  currentHash: string;
  /** hash from the original signature */
  expectedHash: string;
  /** human-readable status */
  status: 'clean' | 'drifted' | 'invalid-signature';
}

const SDK_VERSION = '0.3.0';

/**
 * Canonicalize any value to a stable JSON string.
 * Keys are sorted recursively to ensure determinism.
 * Exported for use by attestation.ts and credential.ts (v0.3+).
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(k => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]))
    .join(',');
  return '{' + sorted + '}';
}

/**
 * Compute a SHA-256 hash of any schema value.
 * Schema is canonicalized before hashing — key order doesn't matter.
 */
function hashSchema(schema: unknown): string {
  const canonical = canonicalize(schema);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Sign a schema at deployment time.
 * Store the returned SchemaSignature securely (env var, secrets manager).
 *
 * @param schema  Any JSON-serializable value (object, array, string…)
 * @param label   Optional human-readable name for the schema
 */
export function signSchema(schema: unknown, label?: string): SchemaSignature {
  return {
    hash: hashSchema(schema),
    signedAt: new Date().toISOString(),
    sdkVersion: SDK_VERSION,
    ...(label ? { label } : {}),
  };
}

/**
 * Verify a schema against a previously created signature.
 * Returns drifted=true if the schema has changed.
 *
 * @param schema     The current schema to verify
 * @param signature  The SchemaSignature produced at deployment
 */
export function verifySchema(schema: unknown, signature: SchemaSignature): SchemaVerifyResult {
  if (!signature || !signature.hash) {
    return {
      valid: false,
      drifted: true,
      currentHash: hashSchema(schema),
      expectedHash: '',
      status: 'invalid-signature',
    };
  }

  const currentHash = hashSchema(schema);
  const drifted = currentHash !== signature.hash;

  return {
    valid: !drifted,
    drifted,
    currentHash,
    expectedHash: signature.hash,
    status: drifted ? 'drifted' : 'clean',
  };
}
