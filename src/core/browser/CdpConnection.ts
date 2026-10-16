import WebSocket, { type RawData } from "ws";
import { BrowserEngineError } from "./types.js";

export interface CdpEvent {
	method: string;
	params: Record<string, unknown>;
	sessionId?: string;
}

interface PendingCommand {
	resolve: (value: Record<string, unknown>) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	cleanup: () => void;
}

/** A small CDP transport; it never interprets a missing response as success. */
export class CdpConnection {
	private nextId = 1;
	private readonly pending = new Map<number, PendingCommand>();
	private readonly listeners = new Set<(event: CdpEvent) => void>();
	private closed = false;

	private constructor(private readonly socket: WebSocket) {
		socket.on("message", (raw: RawData) => this.onMessage(raw));
		socket.on("close", () =>
			this.fail(new BrowserEngineError("engine-crashed", "Lightpanda CDP connection closed", { engine: "lightpanda" })),
		);
		socket.on("error", (cause: Error) =>
			this.fail(
				new BrowserEngineError("engine-crashed", "Lightpanda CDP connection failed", { engine: "lightpanda", cause }),
			),
		);
	}

	static connect(url: string, timeoutMs: number, signal?: AbortSignal): Promise<CdpConnection> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(
					new BrowserEngineError("operation-timeout", "Lightpanda connection cancelled", {
						engine: "lightpanda",
						dispatched: false,
					}),
				);
				return;
			}
			const socket = new WebSocket(url, { handshakeTimeout: timeoutMs, maxPayload: 16 * 1024 * 1024 });
			const cleanup = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				socket.off("error", error);
				socket.off("open", open);
			};
			const abort = () => {
				cleanup();
				socket.on("error", () => {});
				socket.terminate();
				reject(
					new BrowserEngineError("operation-timeout", "Lightpanda connection cancelled", {
						engine: "lightpanda",
						dispatched: false,
					}),
				);
			};
			const error = (cause: Error) => {
				cleanup();
				socket.on("error", () => {});
				socket.terminate();
				reject(
					new BrowserEngineError("startup-failed", "Lightpanda CDP endpoint is not ready", {
						engine: "lightpanda",
						dispatched: false,
						cause,
					}),
				);
			};
			const open = () => {
				cleanup();
				resolve(new CdpConnection(socket));
			};
			const timer = setTimeout(abort, timeoutMs);
			signal?.addEventListener("abort", abort, { once: true });
			socket.once("error", error);
			socket.once("open", open);
		});
	}

	send(
		method: string,
		params: Record<string, unknown> = {},
		options: { sessionId?: string; timeoutMs?: number; signal?: AbortSignal; dispatched?: boolean } = {},
	): Promise<Record<string, unknown>> {
		const dispatched = options.dispatched ?? true;
		if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(
				new BrowserEngineError("engine-crashed", `Lightpanda disconnected before ${method}`, {
					engine: "lightpanda",
					dispatched: false,
				}),
			);
		}
		if (options.signal?.aborted) {
			return Promise.reject(
				new BrowserEngineError("operation-timeout", `Lightpanda cancelled before ${method}`, {
					engine: "lightpanda",
					dispatched: false,
				}),
			);
		}
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const finish = (error: Error) => {
				const command = this.pending.get(id);
				if (!command) return;
				this.pending.delete(id);
				clearTimeout(command.timer);
				command.cleanup();
				reject(error);
			};
			const abort = () =>
				finish(
					new BrowserEngineError("operation-timeout", `Lightpanda cancelled ${method}`, {
						engine: "lightpanda",
						dispatched,
					}),
				);
			const timer = setTimeout(
				() =>
					finish(
						new BrowserEngineError("operation-timeout", `Lightpanda deadline exceeded for ${method}`, {
							engine: "lightpanda",
							dispatched,
						}),
					),
				options.timeoutMs ?? 15_000,
			);
			this.pending.set(id, {
				resolve,
				reject,
				timer,
				cleanup: () => options.signal?.removeEventListener("abort", abort),
			});
			options.signal?.addEventListener("abort", abort, { once: true });
			try {
				this.socket.send(
					JSON.stringify({ id, method, params, ...(options.sessionId ? { sessionId: options.sessionId } : {}) }),
					(error) => {
						if (error)
							finish(
								new BrowserEngineError("engine-crashed", `Lightpanda failed to send ${method}`, {
									engine: "lightpanda",
									dispatched,
									cause: error,
								}),
							);
					},
				);
			} catch (cause) {
				finish(
					new BrowserEngineError("engine-crashed", `Lightpanda failed to send ${method}`, {
						engine: "lightpanda",
						dispatched,
						cause,
					}),
				);
			}
		});
	}

	onEvent(listener: (event: CdpEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	close(): void {
		if (this.closed) return;
		this.fail(new BrowserEngineError("engine-crashed", "Lightpanda CDP connection stopped", { engine: "lightpanda" }));
		this.socket.terminate();
	}

	private onMessage(raw: RawData): void {
		let message: Record<string, unknown>;
		try {
			const decoded: unknown = JSON.parse(raw.toString());
			if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Invalid CDP message");
			message = decoded as Record<string, unknown>;
		} catch (cause) {
			this.fail(
				new BrowserEngineError("execution-failed", "Lightpanda returned invalid CDP data", {
					engine: "lightpanda",
					cause,
				}),
			);
			this.socket.terminate();
			return;
		}
		if (typeof message.id === "number") {
			const command = this.pending.get(message.id);
			if (!command) return;
			this.pending.delete(message.id);
			clearTimeout(command.timer);
			command.cleanup();
			if (message.error && typeof message.error === "object") {
				const error = message.error as Record<string, unknown>;
				const unsupported =
					error.code === -32601 ||
					/unknownmethod|not supported|not implemented|method.*not found/i.test(String(error.message));
				command.reject(
					new BrowserEngineError(
						unsupported ? "unsupported-command" : "execution-failed",
						`Lightpanda CDP error: ${String(error.message ?? "Unspecified protocol error")}`,
						{ engine: "lightpanda" },
					),
				);
			} else if (
				Object.hasOwn(message, "result") &&
				message.result !== null &&
				typeof message.result === "object" &&
				!Array.isArray(message.result)
			) {
				command.resolve(message.result as Record<string, unknown>);
			} else {
				command.reject(
					new BrowserEngineError("execution-failed", "Lightpanda CDP response has no valid result", {
						engine: "lightpanda",
					}),
				);
			}
		} else if (typeof message.method === "string") {
			if (
				message.params !== undefined &&
				(!message.params || typeof message.params !== "object" || Array.isArray(message.params))
			) {
				this.fail(
					new BrowserEngineError("execution-failed", "Lightpanda returned unreadable CDP event parameters", {
						engine: "lightpanda",
					}),
				);
				this.socket.terminate();
				return;
			}
			const event: CdpEvent = { method: message.method, params: (message.params ?? {}) as Record<string, unknown> };
			if (typeof message.sessionId === "string") event.sessionId = message.sessionId;
			for (const listener of this.listeners) listener(event);
		}
	}

	private fail(error: Error): void {
		this.closed = true;
		for (const command of this.pending.values()) {
			clearTimeout(command.timer);
			command.cleanup();
			command.reject(error);
		}
		this.pending.clear();
		this.listeners.clear();
	}
}
