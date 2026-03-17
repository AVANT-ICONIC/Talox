import * as fs from 'fs-extra';
import * as yaml from 'js-yaml';
import type { ProfileClass } from '../types/index.js';

export interface PolicyCondition {
    field: 'amount' | 'url' | 'domain' | 'action';
    operator: '<' | '>' | '<=' | '>=' | '==' | '!=' | 'contains' | 'matches';
    value: string | number;
}

export interface PolicyRule {
    action: string;
    effect: 'allow' | 'deny';
    conditions?: PolicyCondition[];
    domains?: string[];
}

export interface ProfilePolicy {
    defaultEffect: 'allow' | 'deny';
    rules: PolicyRule[];
}

export interface YAMLPolicy {
    version: string;
    description?: string;
    profiles: Record<ProfileClass, ProfilePolicy>;
}

export class PolicyEngine {
    private allowlists: Record<ProfileClass, string[]> = {
        'qa': ['*'],
        'ops': ['google.com', 'github.com', 'about:blank', 'localhost'],
        'sandbox': ['*']
    };

    private yamlPolicies: Record<ProfileClass, ProfilePolicy | null> = {
        'qa': null,
        'ops': null,
        'sandbox': null
    };

    private yamlLoaded = false;

    async loadPolicyFromYAML(filePath: string): Promise<void> {
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            const policy = yaml.load(fileContent) as YAMLPolicy;
            
            if (!policy || !policy.profiles) {
                throw new Error('Invalid policy format: missing profiles');
            }

            for (const [profileClass, profilePolicy] of Object.entries(policy.profiles)) {
                if (profileClass in this.yamlPolicies) {
                    this.yamlPolicies[profileClass as ProfileClass] = profilePolicy;
                }
            }

            this.yamlLoaded = true;
        } catch (error) {
            console.error(`Failed to load policy from ${filePath}:`, error);
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
            return this.evaluateYAMLPolicy(profileClass, url, 'navigate');
        }

        const list = this.allowlists[profileClass];
        if (!list) return false;
        if (list.includes('*')) return true;
        return list.some(domain => url.includes(domain));
    }

    private evaluateYAMLPolicy(profileClass: ProfileClass, url: string, action: string): boolean {
        const policy = this.yamlPolicies[profileClass];
        if (!policy) return false;

        const domain = this.extractDomain(url);
        const matchedRule = policy.rules.find(rule => {
            const actionMatch = rule.action === '*' || rule.action === action;
            const domainMatch = !rule.domains || rule.domains.length === 0 || 
                rule.domains.some(d => url.includes(d) || domain === d);
            return actionMatch && domainMatch;
        });

        if (matchedRule) {
            if (matchedRule.conditions) {
                const conditionsMet = matchedRule.conditions.every(condition => 
                    this.evaluateCondition(condition, url, action)
                );
                return matchedRule.effect === 'allow' ? conditionsMet : !conditionsMet;
            }
            return matchedRule.effect === 'allow';
        }

        return policy.defaultEffect === 'allow';
    }

    private evaluateCondition(condition: PolicyCondition, url: string, action: string): boolean {
        let fieldValue: string | number;

        switch (condition.field) {
            case 'url':
                fieldValue = url;
                break;
            case 'domain':
                fieldValue = this.extractDomain(url);
                break;
            case 'action':
                fieldValue = action;
                break;
            case 'amount':
                fieldValue = this.extractAmountFromContext();
                break;
            default:
                return false;
        }

        switch (condition.operator) {
            case '==':
                return fieldValue == condition.value;
            case '!=':
                return fieldValue != condition.value;
            case '<':
                return typeof fieldValue === 'number' && fieldValue < Number(condition.value);
            case '>':
                return typeof fieldValue === 'number' && fieldValue > Number(condition.value);
            case '<=':
                return typeof fieldValue === 'number' && fieldValue <= Number(condition.value);
            case '>=':
                return typeof fieldValue === 'number' && fieldValue >= Number(condition.value);
            case 'contains':
                return typeof fieldValue === 'string' && fieldValue.includes(String(condition.value));
            case 'matches':
                if (typeof fieldValue === 'string') {
                    try {
                        return new RegExp(String(condition.value)).test(fieldValue);
                    } catch {
                        return false;
                    }
                }
                return false;
            default:
                return false;
        }
    }

    private extractDomain(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return url;
        }
    }

    private extractAmountFromContext(): number {
        return 0;
    }

    setAmountContext(amount: number): void {
        (this as any)._currentAmount = amount;
    }

    isDestructiveAction(actionType: string, targetSelector?: string): boolean {
        if (targetSelector?.toLowerCase().includes('delete') || 
            targetSelector?.toLowerCase().includes('remove') ||
            targetSelector?.toLowerCase().includes('destroy')) {
            return true;
        }
        return false;
    }

    canPerform(profileClass: ProfileClass, actionType: string, targetSelector?: string): boolean {
        if (this.yamlLoaded && this.yamlPolicies[profileClass]) {
            return this.evaluateYAMLPolicy(profileClass, '', actionType);
        }

        if (profileClass === 'ops' && this.isDestructiveAction(actionType, targetSelector)) {
            return false;
        }
        return true;
    }

    isActionAllowed(profileClass: ProfileClass, action: string, context?: Record<string, any>): boolean {
        if (this.yamlLoaded && this.yamlPolicies[profileClass]) {
            if (context?.amount !== undefined) {
                (this as any)._currentAmount = context.amount;
            }
            return this.evaluateYAMLPolicy(profileClass, context?.url || '', action);
        }

        if (profileClass === 'ops' && this.isDestructiveAction(action)) {
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
