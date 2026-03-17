import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfileVault } from '../../src/core/ProfileVault';
import fs from 'fs';
import path from 'path';

describe('ProfileVault', () => {
  const testDir = path.join(__dirname, '../temp-profiles');
  
  beforeEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should create a new profile', async () => {
    const vault = new ProfileVault(testDir);
    const profile = await vault.createProfile('test-qa', 'qa', 'Testing');
    expect(profile.id).toBe('test-qa');
    expect(profile.class).toBe('qa');
    expect(fs.existsSync(path.join(testDir, 'test-qa'))).toBe(true);
  });
});
