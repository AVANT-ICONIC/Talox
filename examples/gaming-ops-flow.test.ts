import { describe, it, expect } from 'vitest';
import { TaloxController } from '../src/core/TaloxController.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('End-to-End Gaming/Ops Flow', () => {
  it('should interact smoothly in Browse mode', async () => {
    console.log("🎮 Starting Talox Gaming/Ops Flow...");
    const controller = new TaloxController(path.join(__dirname, '../tests/temp-profiles'));
    
    try {
        // 1. Launch in Browse mode (Biomechanical Ghost)
        await controller.launch('gaming-session', 'sandbox', 'browse');
        
        // 2. Navigate to the clicker game
        const localFile = `file://${path.resolve(__dirname, '../tests/manual/clicker.html')}`;
        console.log(`🌐 Navigating to: ${localFile}`);
        await controller.navigate(localFile);
        
        // 3. Play the game: Click the target 3 times
        for (let i = 0; i < 3; i++) {
            console.log(`🎯 Clicking target (Turn ${i+1})...`);
            await controller.click('#target');
        }

        // 4. Fill in the name
        console.log(`⌨️ Typing name...`);
        await controller.type('#nameInput', 'Agent Biomech');

        // 5. Verify score and greeting
        const page = (controller as any).getPage();
        const score = await page.innerText('#score');
        const greeting = await page.innerText('#greeting');
        
        console.log(`📈 Final Results: ${score}, ${greeting}`);
        
        expect(score).toContain('3');
        expect(greeting).toContain('Agent Biomech');

        // 6. Clean up
        await controller.stop();
        console.log("\n✅ Gaming/Ops Flow Complete.");
    } catch (error) {
        console.error("❌ Gaming/Ops Flow Failed:", error);
        await controller.stop();
        throw error;
    }
  }, 60000);
});