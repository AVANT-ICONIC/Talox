import { describe, it } from 'vitest';
import { TaloxController } from '../src/core/TaloxController.js';
import { BugEngine } from '../src/core/BugEngine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('End-to-End QA Flow', () => {
  it('should detect bugs on the buggy page', async () => {
    console.log("🚀 Starting Talox QA Flow...");
    const controller = new TaloxController(path.join(__dirname, '../tests/temp-profiles'));
    const bugEngine = new BugEngine();
    
    try {
        // 1. Launch in Debug mode for full perception
        await controller.launch('qa-session', 'qa', 'debug');
        
        // 2. Navigate to the buggy local page
        const localFile = `file://${path.resolve(__dirname, '../tests/manual/buggy.html')}`;
        console.log(`🌐 Navigating to: ${localFile}`);
        const state = await controller.navigate(localFile);
        
        console.log(`🔍 Detected ${state.bugs.length} potential bugs.`);
        
        // 3. Log bugs found
        state.bugs.forEach(bug => {
            console.log(`   - [${bug.type}] ${bug.description} (Severity: ${bug.severity})`);
        });

        // 4. Generate report
        const report = bugEngine.generateReport(state.bugs);
        console.log("\n📄 Bug Report Summary:");
        console.log(report.substring(0, 500) + "...");
        
        // 5. Clean up
        await controller.stop();
        console.log("\n✅ QA Flow Complete.");
    } catch (error) {
        console.error("❌ QA Flow Failed:", error);
        await controller.stop();
        throw error;
    }
  }, 60000);
});