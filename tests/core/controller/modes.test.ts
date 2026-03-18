import { describe, it, expect } from 'vitest';
import { resolveMode, CANONICAL_MODES, DEPRECATED_MODE_MAP } from '../../../src/types/modes';

describe('resolveMode()', () => {
  it('passes canonical modes through unchanged', () => {
    for (const mode of CANONICAL_MODES) {
      expect(resolveMode(mode)).toBe(mode);
    }
  });

  it('maps every deprecated alias to a canonical mode', () => {
    for (const [alias, canonical] of Object.entries(DEPRECATED_MODE_MAP)) {
      const resolved = resolveMode(alias);
      expect(CANONICAL_MODES.has(resolved as any)).toBe(true);
      expect(resolved).toBe(canonical);
    }
  });

  it('"adaptive" → "smart"', () => expect(resolveMode('adaptive')).toBe('smart'));
  it('"stealth"  → "smart"', () => expect(resolveMode('stealth')).toBe('smart'));
  it('"balanced" → "smart"', () => expect(resolveMode('balanced')).toBe('smart'));
  it('"browse"   → "smart"', () => expect(resolveMode('browse')).toBe('smart'));
  it('"qa"       → "smart"', () => expect(resolveMode('qa')).toBe('smart'));
  it('"hybrid"   → "smart"', () => expect(resolveMode('hybrid')).toBe('smart'));

  it('unknown string falls back to "smart"', () => {
    expect(resolveMode('totally-made-up')).toBe('smart');
  });

  it('CANONICAL_MODES contains exactly the 4 expected modes', () => {
    expect(CANONICAL_MODES.size).toBe(4);
    expect(CANONICAL_MODES.has('smart')).toBe(true);
    expect(CANONICAL_MODES.has('speed')).toBe(true);
    expect(CANONICAL_MODES.has('debug')).toBe(true);
    expect(CANONICAL_MODES.has('observe')).toBe(true);
  });
});
