import { describe, it, expect } from 'vitest';

// We test the barrel export by importing from the index.
// We only check that the exports exist (are not undefined) to avoid
// pulling in heavy dependencies like puppeteer, tesseract, etc.

describe('index.ts barrel exports', () => {
  it('exports PRESETS and PresetName type', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.PRESETS).toBeDefined();
    expect(typeof mod.PRESETS).toBe('object');
    // PresetName is a type-only export — verify the object has expected keys
    expect(mod.PRESETS).toHaveProperty('ops');
    expect(mod.PRESETS).toHaveProperty('qa');
    expect(mod.PRESETS).toHaveProperty('observe');
    expect(mod.PRESETS).toHaveProperty('research');
    expect(mod.PRESETS).toHaveProperty('login-heavy');
  });

  it('exports DEFAULT_SETTINGS', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.DEFAULT_SETTINGS).toBeDefined();
    expect(mod.DEFAULT_SETTINGS).toHaveProperty('mouseSpeed');
    expect(mod.DEFAULT_SETTINGS).toHaveProperty('stealthLevel');
    expect(mod.DEFAULT_SETTINGS).toHaveProperty('headed');
  });

  it('exports legacy mode utilities', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.isLegacyMode).toBeDefined();
    expect(typeof mod.isLegacyMode).toBe('function');
    expect(mod.resolveLegacyMode).toBeDefined();
    expect(typeof mod.resolveLegacyMode).toBe('function');
    expect(mod.LEGACY_MODE_VALUES).toBeDefined();
    expect(Array.isArray(mod.LEGACY_MODE_VALUES)).toBe(true);
  });

  it('exports type-only constructs via re-exports', async () => {
    const mod = await import('../../src/index.js');
    // These are type-only exports, but we can verify the module loads without error
    // and runtime values exist where applicable.
    expect(mod.PRESETS).toBeDefined();
    expect(mod.DEFAULT_SETTINGS).toBeDefined();
    // STRATEGIES is a runtime export
    expect(mod.STRATEGIES).toBeDefined();
  });

  it('exports ANNOTATION_LABEL_EMOJI and getLabelEmoji', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.ANNOTATION_LABEL_EMOJI).toBeDefined();
    expect(typeof mod.getLabelEmoji).toBe('function');
  });
});
