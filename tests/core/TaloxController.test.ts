import { describe, it, expect } from 'vitest';
import { TaloxController } from '../../src/core/TaloxController';
import path from 'path';

function isMissingBrowserError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Browser launch failed');
}

describe('TaloxController', () => {
  it('should navigate and return state', async () => {
    const controller = new TaloxController(path.join(__dirname, '../temp-profiles'));
    try {
      await controller.launch('test-agent', 'sandbox');
    } catch (error) {
      if (isMissingBrowserError(error)) return;
      throw error;
    }
    const state = await controller.navigate('about:blank');
    expect(state.url).toBe('about:blank');
    await controller.stop();
  }, 30000);
});
