import type { Page, Route, Request, BrowserContext, Response } from 'playwright-core';

export interface NetworkRecording {
  id: string;
  url: string;
  method: string;
  status: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  timestamp: number;
}

export interface MockResponse {
  urlPattern: string | RegExp;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  delay?: number;
}

export interface NetworkMockerOptions {
  context: BrowserContext;
  page: Page;
}

export class NetworkMocker {
  private context: BrowserContext;
  private page: Page;
  private isRecording: boolean = false;
  private isReplaying: boolean = false;
  private recordings: NetworkRecording[] = [];
  private mocks: MockResponse[] = [];
  private recordingHandler: ((recording: NetworkRecording) => void) | null = null;
  private savedRoutes: Map<string, () => Promise<void>> = new Map();

  constructor(options: NetworkMockerOptions) {
    this.context = options.context;
    this.page = options.page;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private matchesPattern(url: string, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return url.includes(pattern);
    }
    return pattern.test(url);
  }

  async startRecording(onRecording?: (recording: NetworkRecording) => void): Promise<void> {
    if (this.isRecording) return;
    
    this.isRecording = true;
    this.recordings = [];
    this.recordingHandler = onRecording || null;

    await this.page.route('**/*', async (route: Route, request: Request) => {
      if (!this.isRecording) {
        await route.continue();
        return;
      }

      try {
        await route.continue();
        
        const response: Response | null = await request.response();
        let responseBody: string | undefined;
        let responseStatus = 0;
        let responseHeaders: Record<string, string> = {};
        
        if (response) {
          try {
            const buffer = await response.body();
            responseBody = buffer.toString('utf-8');
          } catch {
            // response body not available
          }
          responseStatus = response.status();
          responseHeaders = response.headers();
        }

        const postData = request.postDataBuffer();
        const requestBody = postData ? postData.toString('utf-8') : undefined;

        const recording: NetworkRecording = {
          id: this.generateId(),
          url: request.url(),
          method: request.method(),
          status: responseStatus,
          requestHeaders: request.headers(),
          responseHeaders,
          timestamp: Date.now(),
        };

        if (requestBody !== undefined) {
          (recording as Partial<NetworkRecording>).requestBody = requestBody;
        }
        if (responseBody !== undefined) {
          (recording as Partial<NetworkRecording>).responseBody = responseBody;
        }

        this.recordings.push(recording);
        
        if (this.recordingHandler) {
          this.recordingHandler(recording);
        }
      } catch {
        await route.continue();
      }
    });
  }

  async stopRecording(): Promise<NetworkRecording[]> {
    this.isRecording = false;
    this.recordingHandler = null;
    return [...this.recordings];
  }

  getRecordings(): NetworkRecording[] {
    return [...this.recordings];
  }

  async startReplaying(recordings?: NetworkRecording[]): Promise<void> {
    if (this.isReplaying) return;

    if (recordings) {
      this.recordings = recordings;
    }

    this.isReplaying = true;
    this.savedRoutes.clear();

    await this.page.route('**/*', async (route: Route, request: Request) => {
      if (!this.isReplaying) {
        await route.continue();
        return;
      }

      const matchingRecording = this.recordings.find(r => 
        r.url === request.url() && r.method === request.method()
      );

      if (matchingRecording) {
        const fulfillOptions: {
          status: number;
          headers: Record<string, string>;
          body?: string;
        } = {
          status: matchingRecording.status,
          headers: matchingRecording.responseHeaders,
        };

        if (matchingRecording.responseBody !== undefined) {
          fulfillOptions.body = matchingRecording.responseBody;
        }

        await route.fulfill(fulfillOptions);
      } else {
        await route.continue();
      }
    });
  }

  async stopReplaying(): Promise<void> {
    this.isReplaying = false;
    this.savedRoutes.clear();
    await this.page.unrouteAll({ behavior: 'ignoreErrors' });
  }

  async addMock(mock: MockResponse): Promise<void> {
    this.mocks.push(mock);

    await this.page.route(mock.urlPattern, async (route: Route, request: Request) => {
      if (!this.matchesPattern(request.url(), mock.urlPattern)) {
        await route.continue();
        return;
      }

      const delay = mock.delay || 0;
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const fulfillOptions: {
        status: number;
        headers: Record<string, string>;
        body?: string;
      } = {
        status: mock.status || 200,
        headers: mock.headers || { 'content-type': 'application/json' },
      };

      if (mock.body !== undefined) {
        fulfillOptions.body = mock.body;
      }

      await route.fulfill(fulfillOptions);
    });
  }

  async clearMocks(): Promise<void> {
    this.mocks = [];
    await this.page.unrouteAll({ behavior: 'ignoreErrors' });
  }

  getMocks(): MockResponse[] {
    return [...this.mocks];
  }

  async saveToFile(filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    const data = JSON.stringify(this.recordings, null, 2);
    await fs.writeFile(filePath, data, 'utf-8');
  }

  async loadFromFile(filePath: string): Promise<NetworkRecording[]> {
    const fs = await import('fs/promises');
    const data = await fs.readFile(filePath, 'utf-8');
    this.recordings = JSON.parse(data);
    return [...this.recordings];
  }

  get isRecordingActive(): boolean {
    return this.isRecording;
  }

  get isReplayingActive(): boolean {
    return this.isReplaying;
  }

  async destroy(): Promise<void> {
    await this.stopRecording();
    await this.stopReplaying();
    await this.clearMocks();
    this.recordings = [];
  }
}

export function createNetworkMocker(options: NetworkMockerOptions): NetworkMocker {
  return new NetworkMocker(options);
}
