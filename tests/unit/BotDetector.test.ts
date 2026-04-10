import { describe, it, expect } from 'vitest';
import { BotDetector } from '../../src/core/smart/BotDetector';

function makeState(overrides: Partial<any> = {}): any {
  return {
    url: 'https://example.com/dashboard',
    title: 'Dashboard',
    timestamp: new Date().toISOString(),
    console: { errors: [], logs: [] },
    network: { failedRequests: [] },
    nodes: [],
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

  it('detects CAPTCHA via title "Just a moment"', () => {
    expect(detector.detect(makeState({ title: 'Just a moment...' }))).toBe('captcha_detected');
  });

  it('detects CAPTCHA via title "Verify you are human"', () => {
    expect(detector.detect(makeState({ title: 'Verify you are human' }))).toBe('captcha_detected');
  });

  it('detects CAPTCHA via title "Security Check"', () => {
    expect(detector.detect(makeState({ title: 'Security Check' }))).toBe('captcha_detected');
  });

  it('detects CAPTCHA via title "Bot Check"', () => {
    expect(detector.detect(makeState({ title: 'Bot Check Page' }))).toBe('captcha_detected');
  });

  it('detects CAPTCHA via title "Human Verification"', () => {
    expect(detector.detect(makeState({ title: 'Human Verification Required' }))).toBe('captcha_detected');
  });

  it('detects CAPTCHA via URL /captcha', () => {
    expect(detector.detect(makeState({ url: 'https://example.com/captcha' }))).toBe('captcha_detected');
  });

  it('detects CAPTCHA via URL /verify', () => {
    expect(detector.detect(makeState({ url: 'https://example.com/verify?token=abc' }))).toBe('captcha_detected');
  });

  it('detects CAPTCHA via hcaptcha.com URL', () => {
    expect(detector.detect(makeState({ url: 'https://hcaptcha.com/verify' }))).toBe('captcha_detected');
  });

  it('detects CAPTCHA via recaptcha.net URL', () => {
    expect(detector.detect(makeState({ url: 'https://recaptcha.net/recaptcha/api2/anchor' }))).toBe('captcha_detected');
  });

  it('detects CAPTCHA via node text with captcha pattern', () => {
    const state = makeState({
      nodes: [{ id: 'n1', role: 'text', name: 'Please verify you are human to continue', description: '' }],
    });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects CAPTCHA via console log text', () => {
    const state = makeState({
      console: { errors: [], logs: ['Security check required before proceeding'] },
    });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects hard block via /blocked URL', () => {
    expect(detector.detect(makeState({ url: 'https://example.com/blocked' }))).toBe('bot_detection_hard');
  });

  it('detects hard block via /denied URL', () => {
    expect(detector.detect(makeState({ url: 'https://example.com/denied' }))).toBe('bot_detection_hard');
  });

  it('detects hard block via /sorry URL', () => {
    expect(detector.detect(makeState({ url: 'https://example.com/sorry' }))).toBe('bot_detection_hard');
  });

  it('detects hard block via /access-denied URL', () => {
    expect(detector.detect(makeState({ url: 'https://example.com/access-denied' }))).toBe('bot_detection_hard');
  });

  it('detects hard block via /403 URL', () => {
    expect(detector.detect(makeState({ url: 'https://example.com/403' }))).toBe('bot_detection_hard');
  });

  it('detects rate limit via HTTP 429', () => {
    const state = makeState({
      network: { failedRequests: [{ url: 'https://api.example.com/data', status: 429 }] },
    });
    expect(detector.detect(state)).toBe('rate_limit');
  });

  it('does not treat HTTP 403 as rate_limit', () => {
    const state = makeState({
      network: { failedRequests: [{ url: 'https://api.example.com/data', status: 403 }] },
    });
    expect(detector.detect(state)).toBeNull();
  });

  it('detects fingerprinting via datadome in network URL', () => {
    const state = makeState({
      network: { failedRequests: [{ url: 'https://js.datadome.co/tags.js', status: 200 }] },
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects fingerprinting via fingerprintjs in network URL', () => {
    const state = makeState({
      network: { failedRequests: [{ url: 'https://cdn.example.com/fingerprintjs/v3.js', status: 200 }] },
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects fingerprinting via creepjs in network URL', () => {
    const state = makeState({
      network: { failedRequests: [{ url: 'https://cdn.example.com/creepjs/main.js', status: 200 }] },
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects fingerprinting via imperva in network exceptions', () => {
    const state = makeState({
      network: { failedRequests: [], exceptions: [{ url: 'https://cdn.imperva.com/f.js' }] },
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects soft bot signal via cf-browser-verification node text', () => {
    const state = makeState({
      nodes: [{ id: 'ax-0', role: 'text', name: 'cf-browser-verification', description: '' }],
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects soft bot signal via challenge-platform node text', () => {
    const state = makeState({
      nodes: [{ id: 'ax-0', role: 'text', name: 'challenge-platform', description: '' }],
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects soft bot signal via cf_chl_opt node text', () => {
    const state = makeState({
      nodes: [{ id: 'ax-0', role: 'text', name: 'cf_chl_opt value', description: '' }],
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('CAPTCHA has higher priority than hard block', () => {
    const state = makeState({ title: 'Just a moment', url: 'https://example.com/blocked' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('hard block has higher priority than rate limit', () => {
    const state = makeState({
      url: 'https://example.com/blocked',
      network: { failedRequests: [{ url: '/api', status: 429 }] },
    });
    expect(detector.detect(state)).toBe('bot_detection_hard');
  });

  it('rate limit has higher priority than fingerprinting', () => {
    const state = makeState({
      network: {
        failedRequests: [
          { url: '/api', status: 429 },
          { url: 'https://js.datadome.co/tags.js', status: 200 },
        ],
      },
    });
    expect(detector.detect(state)).toBe('rate_limit');
  });
});
