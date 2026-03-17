import { describe, it, expect } from 'vitest';
import { BrowserManager } from '../../src/core/BrowserManager';
import { ProfileVault } from '../../src/core/ProfileVault';
import path from 'path';

describe('BrowserManager', () => {
  it('should launch a browser with a profile', async () => {
    const vault = new ProfileVault(path.join(__dirname, '../temp-profiles'));
    const profile = await vault.createProfile('test-launch', 'sandbox', 'Launch test');
    const manager = new BrowserManager();
    const browser = await manager.launch(profile);
    expect(browser.browser()?.isConnected()).toBe(true);
    await manager.close();
  });
});
