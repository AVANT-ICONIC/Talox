export type CredentialLeakSource = "header" | "body" | "url";

export interface CredentialLeakCheckInput {
	method: string;
	url: string;
	headers?: Record<string, string>;
	postData?: string | null;
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
	"x-auth-token",
	"x-access-token",
	"access-token",
	"x-secret-key",
	"x-goog-api-key",
]);

const SENSITIVE_HEADER_NAME = /^(?:x[-_])?(?:api[-_]?key|auth[-_]?token|access[-_]?token|secret[-_]?key)$/i;
const JWT_VALUE = /eyJ[\w-]{10,}\.[\w-]{10,}/i;
const LABELED_SECRET_VALUE = /(?:api[_-]?key|secret|token|password|bearer)\s*[:=]\s*['"]?[\w-]{8,}/i;
const AUTH_SCHEME_VALUE = /^\s*(?:bearer|basic)\s+\S{8,}/i;

function textContainsCredential(text: string): boolean {
	return JWT_VALUE.test(text) || LABELED_SECRET_VALUE.test(text);
}

function sensitiveHeaderName(name: string): boolean {
	const normalized = name.trim().toLowerCase();
	return EXPLICIT_SENSITIVE_HEADERS.has(normalized) || SENSITIVE_HEADER_NAME.test(normalized);
}

/**
 * Detect likely credential exfiltration without returning or logging secret values.
 *
 * Explicit authentication/token headers are treated as credentials whenever they
 * contain a non-empty value. Other header values are inspected only for strong
 * credential shapes so benign application headers are not blocked wholesale.
 */
export function detectCredentialLeak(input: CredentialLeakCheckInput): CredentialLeakDetection {
	for (const [name, rawValue] of Object.entries(input.headers ?? {})) {
		const value = String(rawValue ?? "");
		if (!value.trim()) continue;

		if (sensitiveHeaderName(name) || AUTH_SCHEME_VALUE.test(value) || textContainsCredential(`${name}: ${value}`)) {
			return {
				blocked: true,
				source: "header",
				headerName: name.toLowerCase(),
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
