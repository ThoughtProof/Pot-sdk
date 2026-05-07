/**
 * pot-sdk: Optional WASM Sandbox Integration (Layer 4)
 *
 * Dynamically imports `pot-sandbox` (optional peer dependency) and runs
 * any code blocks found in the output through QuickJS-WASM isolation.
 *
 * If pot-sandbox is not installed, this module silently returns no flags.
 * Install with: npm install pot-sandbox
 */

export interface SandboxCheckResult {
  ran: boolean;
  codeBlocksFound: number;
  flags: string[];
  attestations: SandboxAttestation[];
}

export interface SandboxAttestation {
  inputHash: string;
  outputHash: string;
  timestamp: string;
  sandboxType: string;
  digest: string;
}

/**
 * Extract fenced code blocks from a string.
 * Matches ```lang\n...\n``` and ```\n...\n```
 */
export function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:[a-zA-Z0-9_+-]*)?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const code = match[1].trim();
    if (code.length > 0) blocks.push(code);
  }
  return blocks;
}

/**
 * Run extracted code blocks through pot-sandbox (WASM isolation).
 * Requires pot-sandbox to be installed as a peer dependency.
 * Returns empty flags + ran=false if pot-sandbox is not available.
 */
export async function runSandboxCheck(
  output: string,
  options: { timeoutMs?: number } = {}
): Promise<SandboxCheckResult> {
  const codeBlocks = extractCodeBlocks(output);

  if (codeBlocks.length === 0) {
    return { ran: false, codeBlocksFound: 0, flags: [], attestations: [] };
  }

  // Load pot-sandbox as a truly optional runtime dependency.
  // Keep the package name out of static import() so declaration builds do not
  // require pot-sandbox to be installed just to type-check pot-sdk.
  let execute: ((code: string, opts?: { timeoutMs?: number }) => Promise<any>) | null = null;
  try {
    const { createRequire } = await import('module');
    const req = createRequire(__filename);
    const mod = req('pot-sandbox') as { execute?: (code: string, opts?: { timeoutMs?: number }) => Promise<any> };
    execute = mod.execute ?? null;
  } catch {
    // pot-sandbox not installed — skip silently
    return { ran: false, codeBlocksFound: codeBlocks.length, flags: [], attestations: [] };
  }

  if (!execute) {
    return { ran: false, codeBlocksFound: codeBlocks.length, flags: [], attestations: [] };
  }

  const timeoutMs = options.timeoutMs ?? 3000;
  const flags: string[] = [];
  const attestations: SandboxAttestation[] = [];

  await Promise.allSettled(
    codeBlocks.map(async (code) => {
      try {
        const result = await execute!(code, { timeoutMs });
        // Prefix sandbox flags for namespacing
        for (const f of result.flags) {
          flags.push(`sandbox:${f}`);
        }
        attestations.push(result.attestation);
      } catch (err: any) {
        flags.push('sandbox:execution-error');
      }
    })
  );

  return {
    ran: true,
    codeBlocksFound: codeBlocks.length,
    flags,
    attestations,
  };
}
