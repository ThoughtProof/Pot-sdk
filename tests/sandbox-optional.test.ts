import { describe, expect, it } from 'vitest';

import { runSandboxCheck } from '../src/sandbox.js';

describe('optional pot-sandbox integration', () => {
  it('does not require pot-sandbox when no code blocks are present', async () => {
    const result = await runSandboxCheck('plain text without executable snippets');

    expect(result).toEqual({
      ran: false,
      codeBlocksFound: 0,
      flags: [],
      attestations: [],
    });
  });

  it('fails closed when code blocks are present but optional pot-sandbox is unavailable', async () => {
    const result = await runSandboxCheck('```js\nconsole.log("hello")\n```');

    expect(result.ran).toBe(false);
    expect(result.codeBlocksFound).toBe(1);
    expect(result.flags).toEqual([]);
    expect(result.attestations).toEqual([]);
  });
});
