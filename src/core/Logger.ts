/**
 * Minimal level-gated logger for Talox core modules.
 *
 * Replaces raw `console.log` / `console.error` / `console.warn` calls so that
 * output can be silenced or filtered via `TALOX_LOG_LEVEL`.
 *
 * Levels: debug(0) < info(1) < warn(2) < error(3) < silent(4).
 * Default: info (1).
 *
 * @example
 * ```ts
 * import { createLogger } from "./Logger";
 * const log = createLogger("Smart");
 * log.info("Strategy adapted: captcha_pause");
 * log.debug("Only visible when TALOX_LOG_LEVEL=debug");
 * ```
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_MAP: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	silent: 4,
};

const SENSITIVE_QUERY_PARAM =
	/([?&](?:access[_-]?token|auth[_-]?token|api[_-]?key|api[_-]?token|token|secret|password|authorization)=)[^&#\s]*/gi;
const SENSITIVE_HEADER_VALUE =
	/(\b(?:authorization|proxy-authorization|x-api-key|api-key|x-api-token|api-token|x-auth-token|x-access-token|access-token|x-secret-key|x-goog-api-key)\b\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\s,;]+/gi;
const AUTH_SCHEME_VALUE = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_VALUE = /\beyJ[\w-]{10,}\.[\w-]{10,}(?:\.[\w-]{10,})?\b/g;
const URL_USER_INFO = /(https?:\/\/)[^/@\s]+@/gi;

/** Redact common credential shapes before they reach console output. */
export function redactLogString(value: string): string {
	return value
		.replace(URL_USER_INFO, "$1[REDACTED]@")
		.replace(SENSITIVE_QUERY_PARAM, "$1[REDACTED]")
		.replace(SENSITIVE_HEADER_VALUE, "$1[REDACTED]")
		.replace(AUTH_SCHEME_VALUE, "$1 [REDACTED]")
		.replace(JWT_VALUE, "[REDACTED_JWT]");
}

function redactLogArgs(args: unknown[]): unknown[] {
	return args.map((arg) => (typeof arg === "string" ? redactLogString(arg) : arg));
}

function resolveLevel(): number {
	const env = (globalThis as Record<string, unknown>).TALOX_LOG_LEVEL;
	if (typeof env === "string" && env in LEVEL_MAP) return LEVEL_MAP[env as LogLevel];
	return LEVEL_MAP.info;
}

let currentLevel = resolveLevel();

/** Change the active log level at runtime. */
export function setLogLevel(level: LogLevel): void {
	currentLevel = LEVEL_MAP[level];
}

/** Get the current numeric log level (useful for short-circuiting expensive formatting). */
export function getLogLevel(): number {
	return currentLevel;
}

export interface Logger {
	debug(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

/**
 * Create a scoped logger that prefixes messages with `[Talox ${prefix}]`.
 *
 * The returned object is a no-op for any level below the current threshold,
 * so calling code doesn't need its own verbosity guards.
 */
export function createLogger(prefix: string): Logger {
	const tag = `[Talox ${prefix}]`;
	return {
		debug(...args: unknown[]) {
			if (currentLevel <= LEVEL_MAP.debug) console.log(tag, ...redactLogArgs(args));
		},
		info(...args: unknown[]) {
			if (currentLevel <= LEVEL_MAP.info) console.log(tag, ...redactLogArgs(args));
		},
		warn(...args: unknown[]) {
			if (currentLevel <= LEVEL_MAP.warn) console.warn(tag, ...redactLogArgs(args));
		},
		error(...args: unknown[]) {
			if (currentLevel <= LEVEL_MAP.error) console.error(tag, ...redactLogArgs(args));
		},
	};
}

/** Default general-purpose logger. */
export const log = createLogger("");
