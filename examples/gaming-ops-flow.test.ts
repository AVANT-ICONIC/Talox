import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaloxController } from 'talox';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('End-to-End Gaming/Ops Flow', () => {
  it('interacts smoothly with human-paced settings', async () => {
    console.log('🎮 Starting Talox Gaming/Ops Flow...');
    const controller = new TaloxController(path.join(__dirname, '../tests/temp-profiles'), {
      settings: {
        humanStealth: 1,
        fidgetEnabled: true,
        navigationWaitUntil: 'domcontentloaded',
      },
    });

    try {
      await controller.launch('gaming-session', 'sandbox', 'chromium');

      const localFile = `file://${path.resolve(__dirname, '../tests/manual/clicker.html')}`;
      console.log(`🌐 Navigating to: ${localFile}`);
      await controller.navigate(localFile);

      for (let i = 0; i < 3; i++) {
        console.log(`🎯 Clicking target (Turn ${i + 1})...`);
        await controller.click('#target');
      }

      console.log('⌨️ Typing name...');
      await controller.type('#nameInput', 'Agent Biomech');

      const score = await controller.evaluate<string>('document.querySelector("#score")?.textContent ?? ""');
      const greeting = await controller.evaluate<string>(
        'document.querySelector("#greeting")?.textContent ?? ""',
      );

      console.log(`📈 Final Results: ${score}, ${greeting}`);

      expect(score).toContain('3');
      expect(greeting).toContain('Agent Biomech');

      console.log('\n✅ Gaming/Ops Flow Complete.');
    } finally {
      await controller.stop();
    }
  }, 120_000);
});
