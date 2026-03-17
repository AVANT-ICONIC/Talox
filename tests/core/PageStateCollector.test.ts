import { describe, it, expect } from 'vitest';
import { PageStateCollector } from '../../src/core/PageStateCollector';
import { BrowserManager } from '../../src/core/BrowserManager';
import { ProfileVault } from '../../src/core/ProfileVault';
import path from 'path';

describe('PageStateCollector', () => {
  it('should collect basic page state', async () => {
    const vault = new ProfileVault(path.join(__dirname, '../temp-profiles'));
    const profile = await vault.createProfile('test-state', 'sandbox', 'State test');
    const manager = new BrowserManager();
    const context = await manager.launch(profile);
    const page = await context.newPage();
    await page.goto('about:blank');
    
    const collector = new PageStateCollector(page);
    const state = await collector.collect();
    expect(state.url).toBe('about:blank');
    expect(state.console.errors).toEqual([]);
    await manager.close();
  }, 30000);
});
