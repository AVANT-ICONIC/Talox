import { describe, it, expect } from 'vitest';
import { BotDetector } from '../../../src/core/smart/BotDetector';

function makeState(overrides: Partial<any> = {}): any {
  return {
    url:   'https://example.com/dashboard',
    title: 'Dashboard',
    mode:  'smart',
    timestamp: new Date().toISOString(),
    console: { errors: [], logs: [] },
    network: { failedRequests: [] },
    nodes:   [],
    interactiveElements: [],
    bugs: [],
    ...overrides,
  };
}

describe('BotDetector', () => {
  const detector = new BotDetector();

  it('returns null for a clean page', () => {
    expect(detector.detect(makeState())).toBeNull();
  });

  it('detects CAPTCHA via page title "Just a moment"', () => {
    const state = makeState({ title: 'Just a moment...' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects CAPTCHA via page title "Security check"', () => {
    const state = makeState({ title: 'Security Check' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects CAPTCHA via URL containing /captcha', () => {
    const state = makeState({ url: 'https://example.com/captcha?challenge=abc' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects CAPTCHA via hcaptcha.com URL', () => {
    const state = makeState({ url: 'https://hcaptcha.com/verify' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects hard block via /blocked URL', () => {
    const state = makeState({ url: 'https://example.com/blocked' });
    expect(detector.detect(state)).toBe('bot_detection_hard');
  });

  it('detects hard block via /access-denied URL', () => {
    const state = makeState({ url: 'https://example.com/access-denied' });
    expect(detector.detect(state)).toBe('bot_detection_hard');
  });

  it('detects rate limit via HTTP 429 in failedRequests', () => {
    const state = makeState({
      network: {
        failedRequests: [{ url: 'https://api.example.com/data', status: 429 }],
      },
    });
    expect(detector.detect(state)).toBe('rate_limit');
  });

  it('does not treat HTTP 403 as rate_limit', () => {
    const state = makeState({
      network: {
        failedRequests: [{ url: 'https://api.example.com/data', status: 403 }],
      },
    });
    // 403 might be /access-denied path but URL here is clean, should be null
    expect(detector.detect(state)).toBeNull();
  });

  it('detects fingerprinting script via datadome in network URL', () => {
    const state = makeState({
      network: {
        failedRequests: [{ url: 'https://js.datadome.co/tags.js', status: 200 }],
      },
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects soft bot signal via Cloudflare node text', () => {
    const state = makeState({
      nodes: [{ id: 'ax-0', role: 'text', name: 'cf-browser-verification', description: '' }],
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('CAPTCHA has higher priority than hard block', () => {
    // URL triggers both captcha pattern and hard block — captcha wins (higher priority)
    const state = makeState({
      title: 'Just a moment',
      url: 'https://example.com/blocked',
    });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('hard block has higher priority than rate limit', () => {
    const state = makeState({
      url: 'https://example.com/blocked',
      network: {
        failedRequests: [{ url: '/api', status: 429 }],
      },
    });
    expect(detector.detect(state)).toBe('bot_detection_hard');
  });
});
