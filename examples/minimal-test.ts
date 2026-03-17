import { chromium } from 'playwright-core';

async function main() {
  console.log('Starting minimal test...');
  try {
    const browser = await chromium.launch({ headless: true });
    console.log('Browser launched');
    const page = await browser.newPage();
    console.log('Page created');
    await page.goto('https://example.com');
    console.log('Navigated, title:', await page.title());
    await browser.close();
    console.log('Done!');
  } catch (e) {
    console.error('Error:', e);
  }
}

main();
