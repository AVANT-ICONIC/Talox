import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../src/core/controller/EventBus';
import { AnnotationBuffer } from '../../../src/core/observe/AnnotationBuffer';
import { OverlayInjector } from '../../../src/core/observe/OverlayInjector';

describe('OverlayInjector', () => {
  it('routes session:end to the observe-session callback', async () => {
    const onSessionEndRequest = vi.fn(async () => {});
    const injector = new OverlayInjector(
      'session-1',
      new Date().toISOString(),
      new AnnotationBuffer(),
      new EventBus(),
      [],
      onSessionEndRequest,
    );

    (injector as any).handleBridgeEvent('session:end', {});
    await Promise.resolve();
    await Promise.resolve();

    expect(onSessionEndRequest).toHaveBeenCalledTimes(1);
  });

  it('inject is idempotent per page', async () => {
    const injector = new OverlayInjector(
      'session-1',
      new Date().toISOString(),
      new AnnotationBuffer(),
      new EventBus(),
      [],
    );

    const page = {
      exposeFunction: vi.fn(async () => {}),
      addInitScript: vi.fn(async () => {}),
      on: vi.fn(),
      evaluate: vi.fn(async () => {}),
    };

    vi.spyOn(injector as any, 'getBundle').mockResolvedValue('function bootstrapOverlay() {}');

    await injector.inject(page);
    await injector.inject(page);

    expect(page.exposeFunction).toHaveBeenCalledTimes(1);
    expect(page.addInitScript).toHaveBeenCalledTimes(1);
    expect(page.on).toHaveBeenCalledTimes(1);
  });
});
