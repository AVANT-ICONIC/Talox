export type CredentialLeakSource = "header" | "body" | "url";

export interface CredentialLeakCheckInput {
	method: string;
	url: string;
	headers?: Record<string, string>;
	postData?: string | null;
	/** Exact header name/value pairs explicitly configured by Talox for this destination. */
	trustedHeaders?: Record<string, string>;
}

export interface CredentialLeakDetection {
	blocked: boolean;
	source?: CredentialLeakSource;
	headerName?: string;
}

const BODY_CAPABLE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const EXPLICIT_SENSITIVE_HEADERS = new Set([
	"authorization",
	"proxy-authorization",
	"x-api-key",
	"api-key",
	"x-api-token",
	"api-token",
	"x-auth-token",
	"x-access-token",
	"access-token",
	"x-secret-key",
	"x-goog-api-key",
]);

const SENSITIVE_HEADER_NAME = /^(?:x[-_])?(?:api[-_]?(?:key|token)|auth[-_]?token|access[-_]?token|secret[-_]?key)$/i;
const JWT_VALUE = /eyJ[\w-]{10,}\.[\w-]{10,}/i;
const LABELED_SECRET_VALUE = /["']?(?:api[_-]?key|api[_-]?token|secret|token|password|authorization)["']?\s*[:=]\s*["']?(?:bearer\s+|basic\s+)?[\w.+/=-]{8,}/i;
const AUTH_SCHEME_VALUE = /^\s*(?:bearer|basic)\s+\S{8,}/i;

function textContainsCredential(text: string): boolean {
	return JWT_VALUE.test(text) || LABELED_SECRET_VALUE.test(text);
}

function sensitiveHeaderName(name: string): boolean {
	const normalized = name.trim().toLowerCase();
	return EXPLICIT_SENSITIVE_HEADERS.has(normalized) || SENSITIVE_HEADER_NAME.test(normalized);
}

function normalizeHeaders(headers?: Record<string, string>): Map<string, string> {
	const normalized = new Map<string, string>();
	for (const [name, value] of Object.entries(headers ?? {})) {
		normalized.set(name.trim().toLowerCase(), String(value));
	}
	return normalized;
}

/**
 * Detect likely credential exfiltration without returning or logging secret values.
 *
 * Explicit authentication/token headers are treated as credentials whenever they
 * contain a non-empty value, unless that exact header name/value pair was explicitly
 * configured by Talox for the current destination. Other header values are inspected
 * only for strong credential shapes so benign application headers are not blocked wholesale.
 */
export function detectCredentialLeak(input: CredentialLeakCheckInput): CredentialLeakDetection {
	const trustedHeaders = normalizeHeaders(input.trustedHeaders);

	for (const [name, rawValue] of Object.entries(input.headers ?? {})) {
		const value = String(rawValue ?? "");
		if (!value.trim()) continue;

		const normalizedName = name.trim().toLowerCase();
		if (trustedHeaders.get(normalizedName) === value) continue;

		if (sensitiveHeaderName(name) || AUTH_SCHEME_VALUE.test(value) || textContainsCredential(`${name}: ${value}`)) {
			return {
				blocked: true,
				source: "header",
				headerName: normalizedName,
			};
		}
	}

	if (textContainsCredential(input.url)) {
		return { blocked: true, source: "url" };
	}

	if (BODY_CAPABLE_METHODS.has(input.method.toUpperCase()) && textContainsCredential(input.postData ?? "")) {
		return { blocked: true, source: "body" };
	}

	return { blocked: false };
}
