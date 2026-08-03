import { describe, it, expect } from 'vitest';
import { resolveConfidenceCaps } from '../src/pipeline/synthesizer.js';

describe('resolveConfidenceCaps', () => {
  it('epistemic mode keeps the classic 85% ceiling language', () => {
    const en = resolveConfidenceCaps('en', false);
    expect(en).toContain('85%');
    expect(en).not.toContain('80-95%');
  });

  it('verification mode raises ceiling and allows 80%+ on clear facts', () => {
    const en = resolveConfidenceCaps('en', true);
    expect(en).toContain('95%');
    expect(en).toContain('80-95%');
    expect(en).toMatch(/80%\+/);
  });

  it('supports German templates for both modes', () => {
    expect(resolveConfidenceCaps('de', false)).toContain('85%');
    expect(resolveConfidenceCaps('de', true)).toContain('95%');
    expect(resolveConfidenceCaps('de', true)).toContain('80%+');
  });
});
