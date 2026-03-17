import { TaloxController } from '../src/core/TaloxController.js';
import * as path from 'path';

async function main() {
  console.log('Starting TaloxController test...');
  const baseDir = path.join(process.cwd(), 'tests/temp-profiles');
  console.log('Base dir:', baseDir);
  
  const controller = new TaloxController(baseDir);
  console.log('Controller created');
  
  try {
    console.log('Creating profile...');
    // Skip launch and try step by step
    const { ProfileVault } = await import('../src/core/ProfileVault.js');
    const vault = new ProfileVault(baseDir);
    const profile = await vault.createProfile('debug-test', 'sandbox', 'test');
    console.log('Profile created:', profile.id);
    
    console.log('Launching browser...');
    const { BrowserManager } = await import('../src/core/BrowserManager.js');
    const bm = new BrowserManager();
    const ctx = await bm.launch(profile);
    console.log('Browser launched');
    
    const page = await ctx.newPage();
    console.log('Page created');
    await page.goto('https://example.com');
    console.log('Title:', await page.title());
    
    await ctx.close();
    console.log('Done!');
  } catch (e) {
    console.error('Error:', e);
  }
}

main();
