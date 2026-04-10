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

  // ─── Additional coverage for missing lines ────────────────────────────────

  it('detects CAPTCHA via title "Verify you are human"', () => {
    const state = makeState({ title: 'Verify you are human' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects CAPTCHA via title "Bot Check"', () => {
    const state = makeState({ title: 'Bot Check Page' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects CAPTCHA via title "Human Verification"', () => {
    const state = makeState({ title: 'Human Verification Required' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects CAPTCHA via URL /verify', () => {
    const state = makeState({ url: 'https://example.com/verify?token=abc' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects CAPTCHA via recaptcha.net URL', () => {
    const state = makeState({ url: 'https://recaptcha.net/recaptcha/api2/anchor' });
    expect(detector.detect(state)).toBe('captcha_detected');
  });

  it('detects CAPTCHA via node text containing captcha pattern', () => {
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

  it('detects hard block via /denied URL', () => {
    const state = makeState({ url: 'https://example.com/denied' });
    expect(detector.detect(state)).toBe('bot_detection_hard');
  });

  it('detects hard block via /sorry URL', () => {
    const state = makeState({ url: 'https://example.com/sorry' });
    expect(detector.detect(state)).toBe('bot_detection_hard');
  });

  it('detects hard block via /403 URL', () => {
    const state = makeState({ url: 'https://example.com/403' });
    expect(detector.detect(state)).toBe('bot_detection_hard');
  });

  it('detects fingerprinting script via fingerprintjs in network URL', () => {
    const state = makeState({
      network: {
        failedRequests: [{ url: 'https://cdn.example.com/fingerprintjs/v3.js', status: 200 }],
      },
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects fingerprinting script via creepjs in network URL', () => {
    const state = makeState({
      network: {
        failedRequests: [{ url: 'https://cdn.example.com/creepjs/main.js', status: 200 }],
      },
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects fingerprinting script via perimeterx in network URL', () => {
    const state = makeState({
      network: {
        failedRequests: [{ url: 'https://cdn.perimeterx.net/px.js', status: 200 }],
      },
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });

  it('detects fingerprinting via network exceptions', () => {
    const state = makeState({
      network: {
        failedRequests: [],
        exceptions: [{ url: 'https://cdn.imperva.com/f.js' }],
      },
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

  it('fingerprinting has higher priority than soft bot signals', () => {
    const state = makeState({
      network: {
        failedRequests: [{ url: 'https://js.datadome.co/tags.js', status: 200 }],
      },
      nodes: [{ id: 'ax-0', role: 'text', name: 'cf-browser-verification', description: '' }],
    });
    expect(detector.detect(state)).toBe('bot_detection_soft');
  });
});
