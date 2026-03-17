const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

async function main() {
  console.log('Testing browser launch...');
  const profileDir = path.join(process.cwd(), 'tests/temp-profiles', 'quick-test');
  
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  
  try {
    const ctx = await chromium.launchPersistentContext(profileDir, { 
      headless: true,
      timeout: 10000
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
