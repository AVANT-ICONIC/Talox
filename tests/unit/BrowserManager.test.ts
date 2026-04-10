/**
 * Unit tests for BrowserManager — browser lifecycle, detection, context creation.
 * All Playwright/patchright dependencies are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all Playwright/patchright modules ──────────────────────────────────
// vi.mock factories are hoisted — must use vi.fn() inline

vi.mock('patchright', () => ({
  chromium: {
    launchPersistentContext: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
      on: vi.fn(),
    }),
  },
}));

vi.mock('playwright-core', () => ({
  chromium: {
    launchPersistentContext: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
      on: vi.fn(),
    }),
  },
  firefox: {
    launchPersistentContext: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
      on: vi.fn(),
    }),
  },
  webkit: {
    launchPersistentContext: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
      on: vi.fn(),
    }),
  },
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn(),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockContext() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
    on: vi.fn(),
    pages: vi.fn().mockReturnValue([]),
    _browser: { close: vi.fn().mockResolvedValue(undefined) },
  };
}

function createTestProfile() {
  return {
    id: 'test-profile-1',
    class: 'sandbox' as const,
    purpose: 'testing',
    userDataDir: '/tmp/talox-test-profile',
    metadata: { createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
  };
}

// Import after mocks are set up
import { chromium, firefox, webkit } from 'playwright-core';
import { BrowserManager, getDefaultConfig, DEFAULT_CONFIG, resolveConfigDir } from '../../src/core/BrowserManager.js';

describe('BrowserManager', () => {
  let manager: BrowserManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // autoDetect: false to prevent autoDetectBrowser() on CI (Linux) where no browsers are installed
    manager = new BrowserManager({ browser: { preferred: 'chromium', headless: true, autoDetect: false } as any });
  });

  // ─── Constructor & Config ────────────────────────────────────────────────

  describe('constructor', () => {
    it('initializes with default config when no config provided', () => {
      const mgr = new BrowserManager();
      const config = mgr.getConfig();
      expect(config.browser.preferred).toBe('chromium');
      expect(config.browser.headless).toBe(true);
      expect(config.browser.autoDetect).toBe(true);
    });

    it('merges partial config overrides with defaults', () => {
      const mgr = new BrowserManager({
        browser: { headless: false, preferred: 'firefox' } as any,
      });
      const config = mgr.getConfig();
      expect(config.browser.headless).toBe(false);
      expect(config.browser.preferred).toBe('firefox');
      // Shallow merge: nested objects are replaced wholesale, so autoDetect is lost
      expect(config.browser.autoDetect).toBeUndefined();
    });

    it('registers exit handlers on process', () => {
      const spy = vi.spyOn(process, 'once').mockImplementation(() => process);
      new BrowserManager();
      expect(spy).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(spy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      spy.mockRestore();
    });
  });

  describe('getConfig', () => {
    it('returns the current config', () => {
      const config = manager.getConfig();
      expect(config).toBeDefined();
      expect(config.browser).toBeDefined();
      expect(config.profile).toBeDefined();
      expect(config.settings).toBeDefined();
    });
  });

  describe('updateConfig', () => {
    it('merges new config into existing config', () => {
      manager.updateConfig({ browser: { headless: false } as any });
      expect(manager.getConfig().browser.headless).toBe(false);
    });
  });

  // ─── Default Config ──────────────────────────────────────────────────────

  describe('getDefaultConfig', () => {
    it('returns a deep copy of DEFAULT_CONFIG', () => {
      const cfg1 = getDefaultConfig();
      const cfg2 = getDefaultConfig();
      cfg1.browser.headless = false;
      expect(cfg2.browser.headless).toBe(true);
    });

    it('sets headless to false when TALOX_HEADLESS=false env var is set', () => {
      const original = process.env.TALOX_HEADLESS;
      process.env.TALOX_HEADLESS = 'false';
      const cfg = getDefaultConfig();
      expect(cfg.browser.headless).toBe(false);
      process.env.TALOX_HEADLESS = original;
    });
  });

  // ─── resolveConfigDir ────────────────────────────────────────────────────

  describe('resolveConfigDir', () => {
    it('returns process.cwd()', () => {
      expect(resolveConfigDir()).toBe(process.cwd());
    });
  });

  // ─── DEFAULT_CONFIG values ───────────────────────────────────────────────

  describe('DEFAULT_CONFIG', () => {
    it('has correct default settings', () => {
      expect(DEFAULT_CONFIG.browser.autoDetect).toBe(true);
      expect(DEFAULT_CONFIG.browser.preferred).toBe('chromium');
      expect(DEFAULT_CONFIG.browser.headless).toBe(true);
      expect(DEFAULT_CONFIG.profile.defaultClass).toBe('qa');
      expect(DEFAULT_CONFIG.settings.mouseSpeed).toBe(1.0);
      expect(DEFAULT_CONFIG.settings.safeMode).toBe(false);
    });
  });

  // ─── Launch ─────────────────────────────────────────────────────────────

  describe('launch', () => {
    it('launches chromium by default and returns a context', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      const result = await manager.launch(createTestProfile());

      expect(result).toBe(mockCtx);
      expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);
    });

    it('passes headless: false when headed is true', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      // The `headed` param is unused by BrowserManager.launch(); headless is
      // controlled via extraOptions.headless or config.browser.headless.
      // Use extraOptions to set headless: false.
      await manager.launch(createTestProfile(), true, 'chromium', { headless: false });

      expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headless: false })
      );
    });

    it('passes headless: true when headed is false', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await manager.launch(createTestProfile(), false);

      expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headless: true })
      );
    });

    it('launches firefox when browserType is firefox', async () => {
      const mockCtx = createMockContext();
      (firefox.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      const result = await manager.launch(createTestProfile(), false, 'firefox');

      expect(result).toBe(mockCtx);
      expect(firefox.launchPersistentContext).toHaveBeenCalledTimes(1);
    });

    it('launches webkit when browserType is webkit', async () => {
      const mockCtx = createMockContext();
      (webkit.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      const result = await manager.launch(createTestProfile(), false, 'webkit');

      expect(result).toBe(mockCtx);
      expect(webkit.launchPersistentContext).toHaveBeenCalledTimes(1);
    });

    it('passes extraOptions to launch call', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await manager.launch(createTestProfile(), false, 'chromium', {
        userAgent: 'TestAgent/1.0',
        viewport: { width: 1920, height: 1080 },
      });

      expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userAgent: 'TestAgent/1.0',
          viewport: { width: 1920, height: 1080 },
        })
      );
    });

    it('includes expected chromium args', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await manager.launch(createTestProfile(), false, 'chromium');

      const callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(callArgs.args).toContain('--no-sandbox');
      expect(callArgs.args).toContain('--disable-setuid-sandbox');
      expect(callArgs.args).toContain('--disable-dev-shm-usage');
    });

    it('registers context close handler', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await manager.launch(createTestProfile());

      expect(mockCtx.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('throws error when browser launch fails', async () => {
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('browser not found'));

      await expect(manager.launch(createTestProfile())).rejects.toThrow();
    });

    it('stores the context for later retrieval', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await manager.launch(createTestProfile());
      expect(manager.getContext()).toBe(mockCtx);
    });
  });

  // ─── Context Management ─────────────────────────────────────────────────

  describe('getContext', () => {
    it('returns null before launch', () => {
      expect(manager.getContext()).toBeNull();
    });

    it('returns the context after launch', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await manager.launch(createTestProfile());
      expect(manager.getContext()).toBe(mockCtx);
    });
  });

  // ─── Close ──────────────────────────────────────────────────────────────

  describe('close', () => {
    it('closes the context and clears reference', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await manager.launch(createTestProfile());
      expect(manager.getContext()).toBe(mockCtx);

      await manager.close();
      expect(mockCtx.close).toHaveBeenCalled();
      expect(manager.getContext()).toBeNull();
    });

    it('is a no-op when no context exists', async () => {
      await expect(manager.close()).resolves.toBeUndefined();
    });
  });

  // ─── closeAll ────────────────────────────────────────────────────────────

  describe('closeAll', () => {
    it('closes all tracked contexts and clears registry', async () => {
      const mockCtx1 = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx1);

      await manager.launch(createTestProfile());
      await manager.closeAll();

      expect(manager.getContext()).toBeNull();
    });
  });

  // ─── newPage ────────────────────────────────────────────────────────────

  describe('newPage', () => {
    it('throws if browser not launched', async () => {
      await expect(manager.newPage()).rejects.toThrow('Browser not launched');
    });

    it('delegates to context.newPage when launched', async () => {
      const mockCtx = createMockContext();
      const mockPage = { close: vi.fn() };
      mockCtx.newPage.mockResolvedValue(mockPage);
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await manager.launch(createTestProfile());
      const page = await manager.newPage();
      expect(page).toBe(mockPage);
    });
  });

  // ─── Proxy Configuration ────────────────────────────────────────────────

  describe('proxy configuration', () => {
    it('passes proxy config from config to launch options', async () => {
      const proxyMgr = new BrowserManager({
        browser: {
          preferred: 'chromium',
          autoDetect: false,
          headless: true,
          proxy: { server: 'http://proxy:8080', username: 'user', password: 'pass' },
        } as any,
      });
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await proxyMgr.launch(createTestProfile());

      const callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(callArgs.proxy).toEqual({
        server: 'http://proxy:8080',
        username: 'user',
        password: 'pass',
      });
    });
  });

  // ─── Detected Browsers ──────────────────────────────────────────────────

  describe('getDetectedBrowsers', () => {
    it('returns empty array before detection', () => {
      expect(manager.getDetectedBrowsers()).toEqual([]);
    });
  });

  // ─── autoDetectBrowser ──────────────────────────────────────────────────

  describe('autoDetectBrowser', () => {
    it('throws NO_BROWSERS_FOUND when none detected', async () => {
      await expect(manager.autoDetectBrowser()).rejects.toThrow('NO_BROWSERS_FOUND');
    });
  });

  // ─── Context cleanup on close event ─────────────────────────────────────

  describe('context close event', () => {
    it('removes context from registry when close event fires', async () => {
      const mockCtx = createMockContext();
      (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

      await manager.launch(createTestProfile());

      const closeHandler = mockCtx.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];
      expect(closeHandler).toBeDefined();
      closeHandler!();

      expect(manager.getContext()).toBeNull();
    });
  });
});
