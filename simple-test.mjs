import { TaloxController } from './dist/index.js';

async function main() {
  console.log('🔍 Simple test...');
  
  // Just use observe mode - that's the simplest
  const talox = new TaloxController('.', {
    observe: true,
  });

  await talox.launch('test', 'sandbox');
  
  const page = talox._session.getPlaywrightPage();
  
  // Check everything
  const check = await page.evaluate(() => {
    const overlay = document.getElementById('__talox-overlay');
    const btn = document.getElementById('__talox-takeover-btn');
    const cursor = document.getElementById('__talox-fake-cursor');
    return {
      overlay: !!overlay,
      btn: !!btn,
      cursor: !!cursor,
      overlayPointerEvents: getComputedStyle(overlay || document.body).pointerEvents,
      bodyCursor: document.body.style.cursor || getComputedStyle(document.body).cursor,
    };
  });
  
  console.log('Check:', check);
  
  await talox.stop();
}

main().catch(console.error);
