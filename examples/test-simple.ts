import { TaloxController } from '../src/core/TaloxController.js';
import * as path from 'path';

async function main() {
  console.log('Testing TaloxController...');
  const baseDir = path.join(process.cwd(), 'tests/temp-profiles');
  const controller = new TaloxController(baseDir);
  
  try {
    await controller.launch('test', 'sandbox', 'speed');
    console.log('Browser launched!');
    
    // Just use the underlying page directly
    const state = await controller.navigate('https://example.com');
    console.log('Title:', state.title);
    console.log('URL:', state.url);
    
    await controller.stop();
    console.log('Done!');
  } catch (e) {
    console.error('Error:', e.message);
    try { await controller.stop(); } catch(e2) {}
  }
}

main();
