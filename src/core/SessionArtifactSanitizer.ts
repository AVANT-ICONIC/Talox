import { sanitizeCredentialText, sanitizeRecordingUrl } from "./NetworkRecordingSanitizer.js";

const EMBEDDED_HTTP_URL = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING_URL_PUNCTUATION = /[),.;!?]+$/;

function sanitizeEmbeddedUrl(raw: string): string {
	const trailing = raw.match(TRAILING_URL_PUNCTUATION)?.[0] ?? "";
	const candidate = trailing ? raw.slice(0, -trailing.length) : raw;
	return `${sanitizeRecordingUrl(candidate)}${trailing}`;
}

function sanitizeUrls(value: unknown, key?: string): unknown {
	if (Array.isArray(value)) return value.map((entry) => sanitizeUrls(entry));

	if (value && typeof value === "object") {
		const sanitized: Record<string, unknown> = {};
		for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
			sanitized[entryKey] = sanitizeUrls(entryValue, entryKey);
		}
		return sanitized;
	}

	if (typeof value !== "string") return value;

	const normalizedKey = key?.toLowerCase() ?? "";
	if (normalizedKey.endsWith("url") || normalizedKey.endsWith("uri") || normalizedKey.endsWith("href")) {
		return sanitizeRecordingUrl(value);
	}

	return value.replace(EMBEDDED_HTTP_URL, sanitizeEmbeddedUrl);
}

/**
 * Return a detached, JSON-safe copy of an observe/debug artifact with common
 * credential-bearing fields, strings, and URLs redacted before persistence or
 * human-readable rendering. This is deliberately the single artifact boundary
 * used by SessionReporter rather than format-specific redaction logic.
 */
export function sanitizeSessionArtifact<T>(value: T): T {
	if (value === undefined || value === null) return value;

	const serialized = JSON.stringify(value);
	if (serialized === undefined) return value;

	const credentialSafe = JSON.parse(sanitizeCredentialText(serialized)) as unknown;
	return sanitizeUrls(credentialSafe) as T;
}
