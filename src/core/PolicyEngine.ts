import * as fs from "fs-extra";
import * as yaml from "js-yaml";
import { isIP } from "node:net";
import type { ProfileClass } from "../types/index.js";
import { createLogger } from "./Logger.js";

export interface PolicyCondition {
	field: "amount" | "url" | "domain" | "action";
	operator: "<" | ">" | "<=" | ">=" | "==" | "!=" | "contains" | "matches";
	value: string | number;
}

export interface PolicyRule {
	action: string;
	effect: "allow" | "deny";
	conditions?: PolicyCondition[];
	domains?: string[];
}

export interface ProfilePolicy {
	defaultEffect: "allow" | "deny";
	rules: PolicyRule[];
}

export interface YAMLPolicy {
	version: string;
	description?: string;
	profiles: Record<ProfileClass, ProfilePolicy>;
}

/**
 * Enforces per-profile allow/deny policies for navigation URLs and browser
 * actions. Supports simple domain allowlists and fully-configurable YAML-based
 * rule sets with conditions (URL matching, domain filters, amount thresholds)
 * and destructive-action blocking.
 */
export class PolicyEngine {
	private readonly log = createLogger("Policy");
	private readonly allowlists: Record<ProfileClass, string[]> = {
		qa: ["*"],
		ops: ["google.com", "github.com", "about:blank", "localhost"],
		sandbox: ["*"],
	};

	private yamlPolicies: Record<ProfileClass, ProfilePolicy | null> = {
		qa: null,
		ops: null,
		sandbox: null,
	};

	private yamlLoaded = false;
	private _currentAmount: number | null = null;

	async loadPolicyFromYAML(filePath: string): Promise<void> {
		try {
			const fileContent = await fs.readFile(filePath, "utf-8");
			const policy = yaml.load(fileContent) as YAMLPolicy;

			if (!policy?.profiles) {
				throw new Error("Invalid policy format: missing profiles");
			}

			for (const [profileClass, profilePolicy] of Object.entries(policy.profiles)) {
				if (profileClass in this.yamlPolicies) {
					this.yamlPolicies[profileClass as ProfileClass] = profilePolicy;
				}
			}

			this.yamlLoaded = true;
		} catch (error) {
			this.log.error(`Failed to load policy from ${filePath}:`, error);
			throw error;
		}
	}

	setPolicyForProfile(profileClass: ProfileClass, policy: ProfilePolicy): void {
		if (!(profileClass in this.yamlPolicies)) {
			throw new Error(`Unknown profile class: ${profileClass}`);
		}
		this.yamlPolicies[profileClass] = policy;
		this.yamlLoaded = true;
	}

	isAllowed(profileClass: ProfileClass, url: string): boolean {
		if (this.yamlLoaded && this.yamlPolicies[profileClass]) {
			return this.evaluateYAMLPolicy(profileClass, url, "navigate");
		}

		const list = this.allowlists[profileClass];
		if (!list) return false;
		if (list.includes("*")) return true;
		return list.some((domain) => this.urlMatchesDomain(url, domain));
	}

	private evaluateYAMLPolicy(profileClass: ProfileClass, url: string, action: string): boolean {
		const policy = this.yamlPolicies[profileClass];
		if (!policy) return false;

		for (const rule of policy.rules) {
			const actionMatch = rule.action === "*" || rule.action === action;
			if (!actionMatch) continue;

			const domainMatch =
				!rule.domains || rule.domains.length === 0 || rule.domains.some((domain) => this.urlMatchesDomain(url, domain));
			if (!domainMatch) continue;

			const requiresAmount = rule.conditions?.some((condition) => condition.field === "amount") ?? false;
			if (requiresAmount && this._currentAmount === null) return false;

			const conditionsMet =
				!rule.conditions || rule.conditions.every((condition) => this.evaluateCondition(condition, url, action));
			if (!conditionsMet) continue;

			return rule.effect === "allow";
		}

		return policy.defaultEffect === "allow";
	}

	private evaluateCondition(condition: PolicyCondition, url: string, action: string): boolean {
		let fieldValue: string | number;

		switch (condition.field) {
			case "url":
				fieldValue = url;
				break;
			case "domain":
				fieldValue = this.extractDomain(url);
				break;
			case "action":
				fieldValue = action;
				break;
			case "amount": {
				const amount = this.extractAmountFromContext();
				if (amount === null) return false;
				fieldValue = amount;
				break;
			}
			default:
				return false;
		}

		switch (condition.operator) {
			case "==":
				return fieldValue === condition.value;
			case "!=":
				return fieldValue !== condition.value;
			case "<":
				return typeof fieldValue === "number" && fieldValue < Number(condition.value);
			case ">":
				return typeof fieldValue === "number" && fieldValue > Number(condition.value);
			case "<=":
				return typeof fieldValue === "number" && fieldValue <= Number(condition.value);
			case ">=":
				return typeof fieldValue === "number" && fieldValue >= Number(condition.value);
			case "contains":
				return typeof fieldValue === "string" && fieldValue.includes(String(condition.value));
			case "matches":
				if (typeof fieldValue === "string") {
					try {
						return new RegExp(String(condition.value)).test(fieldValue);
					} catch {
						return false;
					}
				}
			default:
				return false;
		}
	}

	private urlMatchesDomain(url: string, domainPattern: string): boolean {
		const pattern = domainPattern.trim().toLowerCase();
		if (!pattern) return false;
		if (pattern === "*") return true;
		if (pattern === "about:blank") return url === "about:blank";

		let requestHost: string;
		try {
			requestHost = new URL(url).hostname.toLowerCase();
		} catch {
			return false;
		}

		let allowedHost: string;
		try {
			const normalizedPattern = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
			const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(normalizedPattern)
				? normalizedPattern
				: `http://${normalizedPattern}`;
			allowedHost = new URL(candidate).hostname.toLowerCase();
		} catch {
			return false;
		}

		if (!allowedHost) return false;
		if (requestHost === allowedHost) return true;
		if (isIP(allowedHost)) return false;
		return requestHost.endsWith(`.${allowedHost}`);
	}

	private extractDomain(url: string): string {
		try {
			const urlObj = new URL(url);
			return urlObj.hostname;
		} catch {
			return url;
		}
	}

	private extractAmountFromContext(): number | null {
		return this._currentAmount;
	}

	setAmountContext(amount: number): void {
		this._currentAmount = amount;
	}

	isDestructiveAction(_actionType: string, targetSelector?: string): boolean {
		if (
			targetSelector?.toLowerCase().includes("delete") ||
			targetSelector?.toLowerCase().includes("remove") ||
			targetSelector?.toLowerCase().includes("destroy")
		) {
			return true;
		}
		return false;
	}

	canPerform(profileClass: ProfileClass, actionType: string, targetSelector?: string): boolean {
		if (this.yamlLoaded && this.yamlPolicies[profileClass]) {
			return this.evaluateYAMLPolicy(profileClass, "", actionType);
		}

		if (profileClass === "ops" && this.isDestructiveAction(actionType, targetSelector)) {
			return false;
		}
		return true;
	}

	isActionAllowed(profileClass: ProfileClass, action: string, context?: Record<string, any>): boolean {
		if (this.yamlLoaded && this.yamlPolicies[profileClass]) {
			const hasScopedAmount = context?.amount !== undefined;
			const previousAmount = this._currentAmount;
			if (hasScopedAmount) this._currentAmount = context.amount;
			try {
				return this.evaluateYAMLPolicy(profileClass, context?.url || "", action);
			} finally {
				if (hasScopedAmount) this._currentAmount = previousAmount;
			}
		}

		if (profileClass === "ops" && this.isDestructiveAction(action)) {
			return false;
		}
		return true;
	}

	getPolicy(profileClass: ProfileClass): ProfilePolicy | null {
		return this.yamlPolicies[profileClass];
	}

	hasYAMLPolicies(): boolean {
		return this.yamlLoaded;
	}

	clearPolicies(): void {
		for (const key of Object.keys(this.yamlPolicies) as ProfileClass[]) {
			this.yamlPolicies[key] = null;
		}
		this.yamlLoaded = false;
	}
}
