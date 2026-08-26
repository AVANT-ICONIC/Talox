const REDACTED = "[REDACTED]";

const EXPLICIT_SENSITIVE_HEADERS = new Set([
	"authorization",
	"proxy-authorization",
	"cookie",
	"cookie2",
	"set-cookie",
	"set-cookie2",
	"www-authenticate",
	"proxy-authenticate",
	"x-api-key",
	"api-key",
	"x-api-token",
	"api-token",
	"x-auth-token",
	"x-access-token",
	"access-token",
	"x-secret-key",
	"x-goog-api-key",
	"client-secret",
	"x-client-secret",
]);

const SENSITIVE_HEADER_NAME =
	/^(?:x[-_])?(?:api[-_]?(?:key|token)|auth[-_]?token|access[-_]?token|secret[-_]?key|client[-_]?secret)$/i;
const SENSITIVE_FIELD_NAME =
	/^(?:access[-_]?token|auth[-_]?token|api[-_]?(?:key|token)|client[-_]?secret|secret|token|password|passwd|authorization|cookie|set[-_]?cookie)$/i;
const SENSITIVE_QUERY_NAME =
	/^(?:access[-_]?token|auth[-_]?token|api[-_]?(?:key|token)|client[-_]?secret|secret|token|password|passwd|authorization)$/i;
const LABELED_SECRET_VALUE =
	/(\b(?:access[_-]?token|auth[_-]?token|api[_-]?(?:key|token)|client[_-]?secret|secret|token|password|passwd|authorization)\b\s*[:=]\s*["']?)(?:bearer\s+|basic\s+)?[^\s,;&}"']+/gi;
const AUTH_SCHEME_VALUE = /\b(bearer|basic)\s+[^\s,;&}"']+/gi;
const JWT_VALUE = /\beyJ[\w-]{10,}\.[\w-]{10,}(?:\.[\w-]{10,})?\b/g;
const URL_USER_INFO = /(https?:\/\/)[^/@\s]+@/gi;

function isSensitiveHeaderName(name: string): boolean {
	const normalized = name.trim().toLowerCase();
	return EXPLICIT_SENSITIVE_HEADERS.has(normalized) || SENSITIVE_HEADER_NAME.test(normalized);
}

function sanitizeJsonValue(value: unknown): { value: unknown; changed: boolean } {
	if (Array.isArray(value)) {
		let changed = false;
		const sanitized = value.map((entry) => {
			const result = sanitizeJsonValue(entry);
			changed ||= result.changed;
			return result.value;
		});
		return { value: changed ? sanitized : value, changed };
	}

	if (value && typeof value === "object") {
		let changed = false;
		const sanitized: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (SENSITIVE_FIELD_NAME.test(key)) {
				sanitized[key] = REDACTED;
				changed = true;
				continue;
			}
			const result = sanitizeJsonValue(entry);
			sanitized[key] = result.value;
			changed ||= result.changed;
		}
		return { value: changed ? sanitized : value, changed };
	}

	if (typeof value === "string") {
		const sanitized = sanitizeCredentialTextFallback(value);
		return { value: sanitized, changed: sanitized !== value };
	}

	return { value, changed: false };
}

function sanitizeCredentialTextFallback(value: string): string {
	return value
		.replace(URL_USER_INFO, `$1${REDACTED}@`)
		.replace(LABELED_SECRET_VALUE, `$1${REDACTED}`)
		.replace(AUTH_SCHEME_VALUE, `$1 ${REDACTED}`)
		.replace(JWT_VALUE, REDACTED);
}

/**
 * Redact common credential shapes from persisted request/response bodies while
 * preserving non-sensitive payloads byte-for-byte whenever possible.
 */
export function sanitizeCredentialText(value: string): string {
	try {
		const parsed = JSON.parse(value) as unknown;
		const result = sanitizeJsonValue(parsed);
		if (result.changed) return JSON.stringify(result.value);
	} catch {
		// Non-JSON payloads are handled by the conservative text redactor below.
	}
	return sanitizeCredentialTextFallback(value);
}

/**
 * Remove credential-bearing headers entirely. For otherwise-benign headers,
 * redact credential-shaped values rather than persisting them verbatim.
 */
export function sanitizeRecordingHeaders(headers: Record<string, string>): Record<string, string> {
	const sanitized: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (isSensitiveHeaderName(name)) continue;
		const redactedValue = sanitizeCredentialText(String(value ?? ""));
		sanitized[name] = redactedValue;
	}
	return sanitized;
}

/**
 * Produce the explicit URL representation used by safe persisted recordings.
 * Sensitive query values and URL user-info are removed, while path, host,
 * query ordering, and non-sensitive query values remain stable for replay.
 */
export function sanitizeRecordingUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.username || parsed.password) {
			parsed.username = REDACTED;
			parsed.password = REDACTED;
		}
		for (const [name] of parsed.searchParams) {
			if (SENSITIVE_QUERY_NAME.test(name)) parsed.searchParams.set(name, REDACTED);
		}
		return sanitizeCredentialTextFallback(parsed.toString());
	} catch {
		return sanitizeCredentialTextFallback(url);
	}
}
