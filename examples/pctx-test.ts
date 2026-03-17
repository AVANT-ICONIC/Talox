import { chromium } from 'playwright-core';
import * as path from 'path';

async function main() {
  console.log('Testing launchPersistentContext...');
  const profileDir = path.join(process.cwd(), 'tests/temp-profiles', 'quicktest');
  
  try {
    const ctx = await chromium.launchPersistentContext(profileDir, { 
      headless: true,
      timeout: 10000
    });
    console.log('Got context');
    const page = await ctx.newPage();
    await page.goto('https://example.com');
    console.log('Title:', await page.title());
    await ctx.close();
    console.log('Done!');
  } catch (e) {
    console.error('Error:', e);
  }
}

main();
