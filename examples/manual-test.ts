import { chromium } from 'playwright-core';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  console.log('Testing manual browser launch...');
  const profileDir = path.join(process.cwd(), 'tests/temp-profiles', 'manual-test');
  
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  
  console.log('Profile dir:', profileDir);
  console.log('Dir exists:', fs.existsSync(profileDir));
  
  try {
    console.log('Launching...');
    const ctx = await chromium.launchPersistentContext(profileDir, { 
      headless: true,
      timeout: 5000
    });
    console.log('Context created');
    
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
