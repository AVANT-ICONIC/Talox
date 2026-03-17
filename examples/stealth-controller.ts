import { TaloxController } from '../src/core/TaloxController.js';
import * as path from 'path';

async function main() {
  console.log('Testing TaloxController with stealth mode...');
  const baseDir = path.join(process.cwd(), 'tests/temp-profiles');
  const controller = new TaloxController(baseDir);
  
  try {
    console.log('Launching in stealth mode...');
    await controller.launch('stealth-test', 'sandbox', 'stealth');
    console.log('Browser launched!');
    
    console.log('Navigating to example.com...');
    const state = await controller.navigate('https://example.com');
    console.log('Title:', state.title);
    console.log('Nodes:', state.nodes.length);
    
    await controller.stop();
    console.log('Done!');
  } catch (e) {
    console.error('Error:', e.message);
    try { await controller.stop(); } catch(e2) {}
  }
}

main();
