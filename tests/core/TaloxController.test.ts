import { describe, it, expect } from 'vitest';
import { TaloxController } from '../../src/core/TaloxController';
import path from 'path';

describe('TaloxController', () => {
  it('should navigate and return state', async () => {
    const controller = new TaloxController(path.join(__dirname, '../temp-profiles'));
    await controller.launch('test-agent', 'sandbox');
    const state = await controller.navigate('about:blank');
    expect(state.url).toBe('about:blank');
    await controller.stop();
  }, 30000);
});
