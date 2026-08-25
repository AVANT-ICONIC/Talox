import type { BrowserContext, Page, Request, Response, Route } from "playwright-core";

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

type RouteHandler = (route: Route, request: Request) => Promise<void>;

interface MockRouteRegistration {
	mock: MockResponse;
	handler: RouteHandler;
}

/**
 * Records and replays network traffic for testing and replay scenarios.
 * Captures full request/response pairs (headers, bodies), replays saved
 * recordings by intercepting and fulfilling matching requests, and supports
 * adding individual mock responses with configurable URL patterns and delays.
 */
export class NetworkMocker {
	private readonly context: BrowserContext;
	private readonly page: Page;
	private isRecording: boolean = false;
	private isReplaying: boolean = false;
	private recordings: NetworkRecording[] = [];
	private recordingHandler: ((recording: NetworkRecording) => void) | null = null;
	private recordingRouteHandler: RouteHandler | null = null;
	private replayRouteHandler: RouteHandler | null = null;
	private mockRoutes: MockRouteRegistration[] = [];

	constructor(options: NetworkMockerOptions) {
		this.context = options.context;
		this.page = options.page;
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
	}

	private matchesPattern(url: string, pattern: string | RegExp): boolean {
		if (typeof pattern === "string") {
			return url.includes(pattern);
		}
		return pattern.test(url);
	}

	async startRecording(onRecording?: (recording: NetworkRecording) => void): Promise<void> {
		if (this.isRecording) return;
		if (this.recordingRouteHandler) await this.removeRecordingRoute();

		this.recordings = [];
		this.recordingHandler = onRecording || null;

		const handler: RouteHandler = async (route: Route, request: Request) => {
			if (!this.isRecording) {
				await route.continue();
				return;
			}

			await route.continue();

			try {
				const response: Response | null = await request.response();
				let responseBody: string | undefined;
				let responseStatus = 0;
				let responseHeaders: Record<string, string> = {};

				if (response) {
					try {
						const buffer = await response.body();
						responseBody = buffer.toString("utf-8");
					} catch {
						// response body not available
					}
					responseStatus = response.status();
					responseHeaders = response.headers();
				}

				const postData = request.postDataBuffer();
				const requestBody = postData ? postData.toString("utf-8") : undefined;

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
				// Recording is best-effort after the request has already continued.
			}
		};

		try {
			await this.page.route("**/*", handler);
			this.recordingRouteHandler = handler;
			this.isRecording = true;
		} catch (error) {
			this.recordingHandler = null;
			throw error;
		}
	}

	async stopRecording(): Promise<NetworkRecording[]> {
		this.isRecording = false;
		this.recordingHandler = null;
		await this.removeRecordingRoute();
		return [...this.recordings];
	}

	private async removeRecordingRoute(): Promise<void> {
		const handler = this.recordingRouteHandler;
		if (!handler) return;
		await this.page.unroute("**/*", handler);
		if (this.recordingRouteHandler === handler) this.recordingRouteHandler = null;
	}

	getRecordings(): NetworkRecording[] {
		return [...this.recordings];
	}

	async startReplaying(recordings?: NetworkRecording[]): Promise<void> {
		if (this.isReplaying) return;
		if (this.replayRouteHandler) await this.removeReplayRoute();

		if (recordings) {
			this.recordings = recordings;
		}

		const handler: RouteHandler = async (route: Route, request: Request) => {
			if (!this.isReplaying) {
				await route.continue();
				return;
			}

			const matchingRecording = this.recordings.find((r) => r.url === request.url() && r.method === request.method());

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
		};

		await this.page.route("**/*", handler);
		this.replayRouteHandler = handler;
		this.isReplaying = true;
	}

	async stopReplaying(): Promise<void> {
		this.isReplaying = false;
		await this.removeReplayRoute();
	}

	private async removeReplayRoute(): Promise<void> {
		const handler = this.replayRouteHandler;
		if (!handler) return;
		await this.page.unroute("**/*", handler);
		if (this.replayRouteHandler === handler) this.replayRouteHandler = null;
	}

	async addMock(mock: MockResponse): Promise<void> {
		const handler: RouteHandler = async (route: Route, request: Request) => {
			if (!this.matchesPattern(request.url(), mock.urlPattern)) {
				await route.continue();
				return;
			}

			const delay = mock.delay || 0;
			if (delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, delay));
			}

			const fulfillOptions: {
				status: number;
				headers: Record<string, string>;
				body?: string;
			} = {
				status: mock.status || 200,
				headers: mock.headers || { "content-type": "application/json" },
			};

			if (mock.body !== undefined) {
				fulfillOptions.body = mock.body;
			}

			await route.fulfill(fulfillOptions);
		};

		await this.page.route(mock.urlPattern, handler);
		this.mockRoutes.push({ mock, handler });
	}

	async clearMocks(): Promise<void> {
		const registrations = [...this.mockRoutes];
		if (registrations.length === 0) return;

		const results = await Promise.allSettled(
			registrations.map(({ mock, handler }) => this.page.unroute(mock.urlPattern, handler)),
		);
		const removedHandlers = new Set<RouteHandler>();
		let firstFailure: unknown;

		for (const [index, result] of results.entries()) {
			const registration = registrations[index];
			if (!registration) continue;
			if (result.status === "fulfilled") {
				removedHandlers.add(registration.handler);
			} else if (firstFailure === undefined) {
				firstFailure = result.reason;
			}
		}

		this.mockRoutes = this.mockRoutes.filter(({ handler }) => !removedHandlers.has(handler));
		if (firstFailure !== undefined) throw firstFailure;
	}

	getMocks(): MockResponse[] {
		return this.mockRoutes.map(({ mock }) => mock);
	}

	async saveToFile(filePath: string): Promise<void> {
		const fs = await import("node:fs/promises");
		const data = JSON.stringify(this.recordings, null, 2);
		await fs.writeFile(filePath, data, "utf-8");
	}

	async loadFromFile(filePath: string): Promise<NetworkRecording[]> {
		const fs = await import("node:fs/promises");
		const data = await fs.readFile(filePath, "utf-8");
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
		const failures: unknown[] = [];
		for (const cleanup of [
			() => this.stopRecording(),
			() => this.stopReplaying(),
			() => this.clearMocks(),
		]) {
			try {
				await cleanup();
			} catch (error) {
				failures.push(error);
			}
		}
		this.recordings = [];
		if (failures.length > 0) throw failures[0];
	}
}

export function createNetworkMocker(options: NetworkMockerOptions): NetworkMocker {
	return new NetworkMocker(options);
}
