import { chromium as patchrightChromium } from 'patchright';
import { chromium, firefox, webkit, type BrowserContext } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { TaloxProfile, TaloxSettings } from '../types/index.js';
/** @deprecated Modes are deprecated. Use `headed` option instead. Kept for backwards compatibility. */
export type TaloxMode = 'smart' | 'debug' | 'speed' | 'observe' | 'browse' | 'adaptive';

export type BrowserType = 'chromium' | 'firefox' | 'webkit';

export interface DetectedBrowser {
  type: BrowserType;
  channel: string | undefined;
  executablePath: string | undefined;
  version: string | undefined;
}

interface BrowserExecutable {
  path: string;
  version: string | undefined;
}

export interface TaloxConfig {
  browser: {
    autoDetect: boolean;
    preferred: BrowserType;
    headless: boolean;
    proxy?: {
      server: string;
      username?: string;
      password?: string;
    };
  };
  profile: {
    vaultDir: string;
    defaultClass: 'qa' | 'ops' | 'sandbox';
  };
  settings: TaloxSettings;
}

export const DEFAULT_CONFIG: TaloxConfig = {
  browser: {
    autoDetect: true,
    preferred: 'chromium',
    headless: true,
  },
  profile: {
    vaultDir: '.talox-profiles',
    defaultClass: 'qa',
  },
  settings: {
    mouseSpeed: 1.0,
    typingDelayMin: 50,
    typingDelayMax: 150,
    stealthLevel: 'medium',
    perceptionDepth: 'full',
    fidgetEnabled: true,
    humanStealth: 0.5,
    typoProbability: 0.05,
    adaptiveStealthEnabled: true,
    adaptiveStealthSensitivity: 1.0,
    adaptiveStealthRadius: 50,
    precisionDecay: 0.1,
    automaticThinkingEnabled: true,
    idleTimeout: 3000,
    headed: false,
    autoHeadedEscalation: true,
    verbosity: 0,
    humanTakeoverEnabled: false,
    humanTakeoverTimeoutMs: 120000,
  },
};

export function getDefaultConfig(): TaloxConfig {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  // TALOX_HEADLESS=false is an emergency escape hatch to force headed mode
  // regardless of mode. Prefer using { headed: true } in launch() options instead.
  if (process.env.TALOX_HEADLESS === 'false') {
    cfg.browser.headless = false;
  }
  return cfg;
}

export function resolveConfigDir(): string {
  return process.cwd();
}

export class BrowserManager {
  private context: BrowserContext | null = null;
  private config: TaloxConfig;
  private detectedBrowsers: DetectedBrowser[] = [];

  private contexts: Set<BrowserContext> = new Set();

  constructor(config?: Partial<TaloxConfig>) {
    this.config = { ...getDefaultConfig(), ...config };

    // Auto-cleanup on process exit — use once() so multiple instances don't
    // stack unbounded listeners (avoids MaxListenersExceededWarning in tests).
    const exitHandler = () => this.closeAllSync();
    const sigintHandler = () => { this.closeAllSync(); process.exit(); };
    process.once('exit', exitHandler);
    process.once('SIGINT', sigintHandler);
  }

  private closeAllSync() {
    // Synchronous cleanup is limited, but we try our best
    for (const ctx of this.contexts) {
      try {
        // @ts-ignore - internal close
        ctx._browser?.close().catch(() => {});
      } catch {}
    }
  }

  async closeAll() {
    const promises = Array.from(this.contexts).map(ctx => ctx.close());
    await Promise.all(promises);
    this.contexts.clear();
    this.context = null;
  }

  async detectBrowsers(): Promise<DetectedBrowser[]> {
    const browsers: DetectedBrowser[] = [];
    const searchPaths = this.getSearchPaths();

    for (const [type, channel] of [
      ['chromium', 'chrome'],
      ['chromium', 'msedge'],
      ['chromium', undefined],
      ['firefox', 'firefox'],
      ['firefox', undefined],
      ['webkit', 'webkit'],
    ] as const) {
      try {
        const executable = await this.findBrowser(type, channel ?? undefined, searchPaths);
        if (executable) {
          const existing = browsers.find(b => b.type === type && (b.channel === channel || (!b.channel && !channel)));
          if (!existing) {
            browsers.push({
              type,
              channel: channel ?? undefined,
              executablePath: executable.path,
              version: executable.version,
            });
          }
        }
      } catch {
        // Continue searching
      }
    }

    this.detectedBrowsers = browsers;
    return browsers;
  }

  private getSearchPaths(): string[] {
    const paths: string[] = [];
    const platform = process.platform;

    if (platform === 'darwin') {
      paths.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Firefox.app/Contents/MacOS/firefox',
        '/Applications/Safari.app/Contents/MacOS/Safari',
        path.join(os.homedir(), 'Library/Application Support/Google/Chrome'),
        path.join(os.homedir(), 'Library/Application Support/Chromium'),
        path.join(os.homedir(), 'Library/Application Support/Microsoft Edge'),
        path.join(os.homedir(), 'Library/Application Support/Firefox'),
      );
    } else if (platform === 'win32') {
      const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
      paths.push(
        path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
        path.join(programFiles, 'Chromium/chrome.exe'),
        path.join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
        path.join(programFiles, 'Mozilla Firefox/firefox.exe'),
        path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
        path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
      );
    } else {
      paths.push(
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/firefox',
        '/usr/bin/safari',
        '/snap/bin/chromium',
        '/opt/google/chrome/chrome',
        path.join(os.homedir(), '.config/google-chrome'),
        path.join(os.homedir(), '.config/chromium'),
        path.join(os.homedir(), '.mozilla/firefox'),
      );
    }

    const playwrightPath = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (fs.existsSync(playwrightPath)) {
      try {
        const dirs = fs.readdirSync(playwrightPath);
        for (const dir of dirs) {
          const browserDir = path.join(playwrightPath, dir);
          if (fs.statSync(browserDir).isDirectory()) {
            paths.push(browserDir);
          }
        }
      } catch {
        // Ignore cache errors
      }
    }

    return paths;
  }

  private async findBrowser(type: BrowserType, channel: string | undefined, searchPaths: string[]): Promise<BrowserExecutable | null> {
    try {
      const launcher = { chromium, firefox, webkit }[type];
      const options: any = { 
        channel,
        timeout: 5000,
      };
      
      if (channel) {
        try {
          const browser = await launcher.launch({ ...options, headless: true });
          await browser.close();
          return { path: channel, version: undefined };
        } catch {
          // Try without channel
        }
      }

      for (const searchPath of searchPaths) {
        if (fs.existsSync(searchPath)) {
          try {
            const testOptions = { ...options, executablePath: searchPath, headless: true };
            const browser = await launcher.launch(testOptions);
            await browser.close();
            return { path: searchPath, version: undefined };
          } catch {
            continue;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  async autoDetectBrowser(): Promise<BrowserType> {
    if (this.detectedBrowsers.length === 0) {
      await this.detectBrowsers();
    }

    if (this.detectedBrowsers.length === 0) {
      throw new Error('NO_BROWSERS_FOUND: No browsers detected. Please install Chrome, Firefox, Safari, or Edge. Run: npx playwright install');
    }

    const preferred = this.config.browser.preferred;
    const found = this.detectedBrowsers.find(b => b.type === preferred);
    if (found) return preferred;

    return this.detectedBrowsers[0]?.type ?? 'chromium';
  }

  getDetectedBrowsers(): DetectedBrowser[] {
    return this.detectedBrowsers;
  }

  getConfig(): TaloxConfig {
    return this.config;
  }

  updateConfig(config: Partial<TaloxConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async launch(profile: TaloxProfile, headed?: boolean, browserType?: BrowserType, extraOptions?: any): Promise<BrowserContext> {
    let actualBrowserType = browserType || this.config.browser.preferred;

    // Skip autoDetect on macOS - just use chrome channel directly
    if (process.platform !== 'darwin') {
      if (this.config.browser.autoDetect) {
        actualBrowserType = await this.autoDetectBrowser();
      }
    }

    // Use Patchright for stealth mode (adaptive behavior)
    const isAdaptive = true;
    
    let launcher: any;
    if (isAdaptive) {
      // Patchright: patched Playwright driver that fixes CDP Runtime.enable leak,
      // removes --enable-automation flag, and patches other detection vectors at
      // the driver level — no JS injection needed for these signals.
      // Only Chromium is supported by Patchright; other browser types fall back to standard.
      launcher = actualBrowserType === 'chromium'
        ? patchrightChromium
        : { firefox, webkit }[actualBrowserType] ?? chromium;
    } else {
      launcher = {
        'chromium': chromium,
        'firefox': firefox,
        'webkit': webkit
      }[actualBrowserType];
    }

    // Resolve effective headless value — extraOptions can override (e.g. observe mode forces false)
    const effectiveHeadless = extraOptions?.headless !== undefined
      ? extraOptions.headless
      : this.config.browser.headless;

    const launchOptions: any = {
      headless: effectiveHeadless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Use new headless mode on macOS to prevent ghost window flicker
        ...(effectiveHeadless && process.platform === 'darwin' ? ['--headless=new'] : []),
      ],
      ...extraOptions
    };

    // Proxy support
    if (this.config.browser.proxy) {
      launchOptions.proxy = this.config.browser.proxy;
    }

    // Use real Chrome channel for adaptive mode on macOS/desktop only
    if (isAdaptive && process.platform === 'darwin') {
      launchOptions.channel = 'chrome';
    }

    try {
      this.context = await launcher.launchPersistentContext(profile.userDataDir, launchOptions) as BrowserContext;
      this.contexts.add(this.context!);
      
      // Remove from registry when closed
      this.context!.on('close', () => {
        this.contexts.delete(this.context!);
        if (this.context === this.context) this.context = null;
      });
    } catch (error: any) {
      // Fallback: try without channel if it failed
      if (launchOptions.channel === 'chrome') {
        delete launchOptions.channel;
        try {
          this.context = await launcher.launchPersistentContext(profile.userDataDir, launchOptions) as BrowserContext;
          this.contexts.add(this.context!);
        } catch (fallbackError: any) {
          throw new Error(`Browser launch failed for ${actualBrowserType}. Please ensure Chrome is installed.`);
        }
      } else if (error.message?.includes('browser')) {
        throw new Error(`Browser launch failed for ${actualBrowserType}. Please ensure the browser is installed.`);
      } else {
        throw error;
      }
    }

    return this.context!;
  }


  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  async newPage(): Promise<any> {
    if (!this.context) throw new Error('Browser not launched');
    return this.context.newPage();
  }
}

export function createLiveBootManager(): BrowserManager {
  return new BrowserManager();
}

export function printBrowserInstallGuide(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           Browser Installation Required                           ║
╠══════════════════════════════════════════════════════════════════╣
║  No browsers detected. Install one of:                           ║
║                                                                  ║
║    Chrome (recommended):                                         ║
║    - macOS: https://google.com/chrome                           ║
║    - Linux: sudo apt install google-chrome-stable              ║
║    - Windows: https://google.com/chrome                        ║
║                                                                  ║
║    Or use Playwright to install:                                ║
║    npx playwright install chromium                              ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
  `);
}
