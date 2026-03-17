import { chromium } from 'playwright-core';

async function main() {
  console.log('Testing with system Chrome...');
  
  try {
    const ctx = await chromium.launch({
      channel: 'chrome',
      headless: true,
      timeout: 15000
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
