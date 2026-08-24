import type { Buffer } from "node:buffer";
import type { VisualReasoner } from "./VisualReasoner.js";

export type LocalVisionProvider = "ollama" | "openai-compatible";

interface LocalVisionBaseConfig {
	/** Model identifier exposed by the local inference server. */
	model: string;
	/** Request timeout in milliseconds. Defaults to 60 seconds for local inference. */
	timeoutMs?: number;
	/**
	 * Allow a non-loopback endpoint. Defaults to false so screenshots cannot
	 * accidentally leave the machine under a configuration described as local.
	 */
	allowRemote?: boolean;
}

export interface OllamaVisionConfig extends LocalVisionBaseConfig {
	provider?: "ollama";
	/** Ollama base URL. Defaults to http://127.0.0.1:11434. */
	baseUrl?: string;
	/** Maximum generated tokens, forwarded as Ollama `num_predict`. */
	maxTokens?: number;
	/** Ollama model keep-alive value such as `5m` or `0`. */
	keepAlive?: string | number;
}

export interface OpenAICompatibleLocalVisionConfig extends LocalVisionBaseConfig {
	provider: "openai-compatible";
	/** OpenAI-compatible API base URL, usually ending in `/v1`. */
	baseUrl: string;
	/** Optional local-server API key. */
	apiKey?: string;
	/** Maximum generated tokens. Defaults to 300. */
	maxTokens?: number;
}

export type LocalVisionConfig = OllamaVisionConfig | OpenAICompatibleLocalVisionConfig;

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 300;

function normalizeBaseUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError(`Invalid local vision base URL: ${value}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new TypeError("Local vision base URL must use http or https.");
	}
	url.pathname = url.pathname.replace(/\/+$/, "");
	url.search = "";
	url.hash = "";
	return url;
}

function isLoopbackHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
	const octets = host.split(".");
	return (
		octets.length === 4 &&
		octets[0] === "127" &&
		octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
	);
}

function assertLocalEndpoint(url: URL, allowRemote: boolean): void {
	if (!allowRemote && !isLoopbackHostname(url.hostname)) {
		throw new Error(
			`Refusing non-loopback local vision endpoint '${url.origin}'. Set allowRemote: true only when screenshot transfer to that host is intentional.`,
		);
	}
}

function validatePositiveInteger(value: number | undefined, label: string): void {
	if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
		throw new TypeError(`${label} must be a positive integer.`);
	}
}

function validateConfig(config: LocalVisionConfig): void {
	if (!config || typeof config !== "object") throw new TypeError("Local vision config is required.");
	if (typeof config.model !== "string" || config.model.trim().length === 0) {
		throw new TypeError("Local vision model must be a non-empty string.");
	}
	if (config.allowRemote !== undefined && typeof config.allowRemote !== "boolean") {
		throw new TypeError("allowRemote must be a boolean when provided.");
	}
	validatePositiveInteger(config.timeoutMs, "timeoutMs");
	validatePositiveInteger(config.maxTokens, "maxTokens");
	if (config.provider === "openai-compatible" && (!config.baseUrl || typeof config.baseUrl !== "string")) {
		throw new TypeError("OpenAI-compatible local vision requires baseUrl.");
	}
	if (config.provider !== "openai-compatible" && config.keepAlive !== undefined) {
		const validNumber = typeof config.keepAlive === "number" && Number.isFinite(config.keepAlive);
		const validString = typeof config.keepAlive === "string" && config.keepAlive.trim().length > 0;
		if (!validNumber && !validString) throw new TypeError("keepAlive must be a finite number or non-empty string.");
	}
}

function endpoint(baseUrl: URL, path: string): string {
	return `${baseUrl.toString().replace(/\/$/, "")}${path}`;
}

async function requestJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	} catch (error) {
		if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
			throw new Error(`Local vision request timed out after ${timeoutMs}ms.`);
		}
		throw error;
	}

	const body = await response.text();
	if (!response.ok) {
		throw new Error(`Local vision server returned HTTP ${response.status}: ${body.slice(0, 200)}`);
	}
	try {
		return body ? JSON.parse(body) : {};
	} catch {
		throw new Error(`Local vision server returned invalid JSON: ${body.slice(0, 200)}`);
	}
}

function createOllamaReasoner(config: OllamaVisionConfig): VisualReasoner {
	const baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_OLLAMA_URL);
	const allowRemote = config.allowRemote === true;
	assertLocalEndpoint(baseUrl, allowRemote);
	const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const model = config.model.trim();
	const maxTokens = config.maxTokens;
	const keepAlive = config.keepAlive;

	return {
		name: `Local VLM · Ollama (${model})`,
		async analyze(screenshot: Buffer, question: string): Promise<string | null> {
			const body: {
				model: string;
				messages: Array<{ role: "user"; content: string; images: string[] }>;
				stream: false;
				options?: { num_predict: number };
				keep_alive?: string | number;
			} = {
				model,
				messages: [
					{
						role: "user",
						content: question,
						images: [screenshot.toString("base64")],
					},
				],
				stream: false,
			};
			if (maxTokens !== undefined) body.options = { num_predict: maxTokens };
			if (keepAlive !== undefined) body.keep_alive = keepAlive;

			const data = (await requestJson(
				endpoint(baseUrl, "/api/chat"),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				},
				timeoutMs,
			)) as { message?: { content?: unknown } };
			const content = data.message?.content;
			return typeof content === "string" && content.trim() ? content.trim() : null;
		},
	};
}

function createOpenAICompatibleReasoner(config: OpenAICompatibleLocalVisionConfig): VisualReasoner {
	const baseUrl = normalizeBaseUrl(config.baseUrl);
	const allowRemote = config.allowRemote === true;
	assertLocalEndpoint(baseUrl, allowRemote);
	const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const model = config.model.trim();
	const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
	const apiKey = config.apiKey;

	return {
		name: `Local VLM · OpenAI-compatible (${model})`,
		async analyze(screenshot: Buffer, question: string): Promise<string | null> {
			const headers: Record<string, string> = { "Content-Type": "application/json" };
			if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
			const data = (await requestJson(
				endpoint(baseUrl, "/chat/completions"),
				{
					method: "POST",
					headers,
					body: JSON.stringify({
						model,
						max_tokens: maxTokens,
						messages: [
							{
								role: "user",
								content: [
									{ type: "text", text: question },
									{
										type: "image_url",
										image_url: { url: `data:image/png;base64,${screenshot.toString("base64")}` },
									},
								],
							},
						],
					}),
				},
				timeoutMs,
			)) as { choices?: Array<{ message?: { content?: unknown } }> };
			const content = data.choices?.[0]?.message?.content;
			return typeof content === "string" && content.trim() ? content.trim() : null;
		},
	};
}

/**
 * Create a VisualReasoner backed by a local vision-language model server.
 *
 * Ollama is the default provider. OpenAI-compatible mode covers local servers
 * such as LM Studio, llama.cpp, or vLLM when they expose multimodal chat.
 * Non-loopback endpoints are rejected unless `allowRemote` is explicitly true.
 */
export function createLocalVisionReasoner(config: LocalVisionConfig): VisualReasoner {
	validateConfig(config);
	return config.provider === "openai-compatible"
		? createOpenAICompatibleReasoner(config)
		: createOllamaReasoner(config);
}
