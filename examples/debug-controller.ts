import { TaloxController } from '../src/core/TaloxController.js';
import * as path from 'path';

async function main() {
  console.log('Loading TaloxController...');
  const baseDir = path.join(process.cwd(), 'tests/temp-profiles');
  console.log('Base dir:', baseDir);
  
  const controller = new TaloxController(baseDir);
  console.log('Controller created');
  
  try {
    console.log('Launching...');
    await controller.launch('test1', 'sandbox', 'speed');
    console.log('Browser launched!');
    
    console.log('Navigating...');
    const state = await controller.navigate('https://example.com');
    console.log('Title:', state.title);
    
    await controller.stop();
    console.log('Done!');
  } catch (e) {
    console.error('Error:', e.message);
    try { await controller.stop(); } catch(e2) {}
  }
}

main();
