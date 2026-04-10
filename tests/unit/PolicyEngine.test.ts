import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyEngine } from '../../src/core/PolicyEngine';
import type { ProfileClass } from '../../src/types/index';

vi.mock('fs-extra', () => ({
  readFile: vi.fn(),
}));
vi.mock('js-yaml', () => ({
  load: vi.fn(),
}));

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe('isAllowed (default allowlists)', () => {
    it('allows all URLs for qa profile (wildcard)', () => {
      expect(engine.isAllowed('qa', 'https://anything.example.com/page')).toBe(true);
    });

    it('allows all URLs for sandbox profile (wildcard)', () => {
      expect(engine.isAllowed('sandbox', 'https://any-site.org')).toBe(true);
    });

    it('allows ops profile for allowed domains', () => {
      expect(engine.isAllowed('ops', 'https://github.com/user/repo')).toBe(true);
      expect(engine.isAllowed('ops', 'https://google.com/search')).toBe(true);
      expect(engine.isAllowed('ops', 'about:blank')).toBe(true);
    });

    it('denies ops profile for non-allowed domains', () => {
      expect(engine.isAllowed('ops', 'https://random-site.com')).toBe(false);
    });
  });

  describe('isAllowed with YAML policy', () => {
    it('uses YAML policy when loaded', () => {
      engine.setPolicyForProfile('qa', {
        defaultEffect: 'deny',
        rules: [{ action: 'navigate', effect: 'allow', domains: ['trusted.com'] }],
      });

      expect(engine.isAllowed('qa', 'https://trusted.com/page')).toBe(true);
      // 'random.org' does not contain 'trusted.com' as substring
      expect(engine.isAllowed('qa', 'https://random.org/page')).toBe(false);
    });

    it('respects defaultEffect=deny when no rule matches', () => {
      engine.setPolicyForProfile('ops', {
        defaultEffect: 'deny',
        rules: [{ action: 'navigate', effect: 'allow', domains: ['allowed.com'] }],
      });

      expect(engine.isAllowed('ops', 'https://other.com')).toBe(false);
    });

    it('matches wildcard action in rules', () => {
      engine.setPolicyForProfile('sandbox', {
        defaultEffect: 'deny',
        rules: [{ action: '*', effect: 'allow', domains: ['example.com'] }],
      });

      expect(engine.isAllowed('sandbox', 'https://example.com/test')).toBe(true);
    });
  });

  describe('setPolicyForProfile', () => {
    it('throws on unknown profile class', () => {
      expect(() => engine.setPolicyForProfile('unknown' as ProfileClass, {
        defaultEffect: 'allow',
        rules: [],
      })).toThrow('Unknown profile class');
    });

    it('sets policy and marks YAML as loaded', () => {
      engine.setPolicyForProfile('qa', { defaultEffect: 'allow', rules: [] });
      expect(engine.hasYAMLPolicies()).toBe(true);
    });
  });

  describe('getPolicy', () => {
    it('returns null before any policy is set', () => {
      expect(engine.getPolicy('qa')).toBeNull();
    });

    it('returns the set policy', () => {
      const policy = { defaultEffect: 'deny', rules: [] };
      engine.setPolicyForProfile('qa', policy);
      expect(engine.getPolicy('qa')).toEqual(policy);
    });
  });

  describe('clearPolicies', () => {
    it('resets all policies and yamlLoaded flag', () => {
      engine.setPolicyForProfile('qa', { defaultEffect: 'allow', rules: [] });
      expect(engine.hasYAMLPolicies()).toBe(true);

      engine.clearPolicies();
      expect(engine.hasYAMLPolicies()).toBe(false);
      expect(engine.getPolicy('qa')).toBeNull();
    });
  });

  describe('isDestructiveAction', () => {
    it('detects destructive selectors', () => {
      expect(engine.isDestructiveAction('click', '#delete-btn')).toBe(true);
      expect(engine.isDestructiveAction('click', '.remove-item')).toBe(true);
      expect(engine.isDestructiveAction('click', '[data-action="destroy"]')).toBe(true);
    });

    it('does not flag non-destructive selectors', () => {
      expect(engine.isDestructiveAction('click', '#submit-btn')).toBe(false);
      expect(engine.isDestructiveAction('click', '.save-button')).toBe(false);
    });

    it('handles missing selector', () => {
      expect(engine.isDestructiveAction('click')).toBe(false);
      expect(engine.isDestructiveAction('click', undefined)).toBe(false);
    });

    it('does not check actionType itself', () => {
      // isDestructiveAction only checks targetSelector, not actionType
      expect(engine.isDestructiveAction('delete')).toBe(false);
      expect(engine.isDestructiveAction('destroy', undefined)).toBe(false);
    });
  });

  describe('canPerform', () => {
    it('blocks ops from destructive actions by default', () => {
      expect(engine.canPerform('ops', 'click', '#delete')).toBe(false);
    });

    it('allows qa and sandbox for destructive actions by default', () => {
      expect(engine.canPerform('qa', 'click', '#delete')).toBe(true);
      expect(engine.canPerform('sandbox', 'click', '#delete')).toBe(true);
    });

    it('allows non-destructive actions for all profiles by default', () => {
      expect(engine.canPerform('ops', 'click', '#save')).toBe(true);
      expect(engine.canPerform('qa', 'type', '#input')).toBe(true);
    });
  });

  describe('isActionAllowed', () => {
    it('allows all actions for ops when no YAML loaded and no destructive selector', () => {
      expect(engine.isActionAllowed('ops', 'click')).toBe(true);
      expect(engine.isActionAllowed('ops', 'delete')).toBe(true); // action type is not checked
    });

    it('allows all actions for qa and sandbox', () => {
      expect(engine.isActionAllowed('qa', 'click')).toBe(true);
      expect(engine.isActionAllowed('sandbox', 'delete')).toBe(true);
    });

    it('respects YAML policy when loaded', () => {
      engine.setPolicyForProfile('ops', {
        defaultEffect: 'deny',
        rules: [{ action: 'click', effect: 'allow' }],
      });
      expect(engine.isActionAllowed('ops', 'click')).toBe(true);
      expect(engine.isActionAllowed('ops', 'type')).toBe(false);
    });
  });

  describe('YAML conditions', () => {
    it('evaluates url contains condition', () => {
      engine.setPolicyForProfile('ops', {
        defaultEffect: 'deny',
        rules: [{
          action: 'navigate',
          effect: 'allow',
          domains: ['example.com'],
          conditions: [{ field: 'url', operator: 'contains', value: '/api' }],
        }],
      });

      expect(engine.isAllowed('ops', 'https://example.com/api/data')).toBe(true);
      expect(engine.isAllowed('ops', 'https://example.com/page')).toBe(false);
    });

    it('evaluates url matches (regex) condition', () => {
      engine.setPolicyForProfile('ops', {
        defaultEffect: 'deny',
        rules: [{
          action: 'navigate',
          effect: 'allow',
          domains: ['example.com'],
          conditions: [{ field: 'url', operator: 'matches', value: '^https://example\\.com/\\d+' }],
        }],
      });

      expect(engine.isAllowed('ops', 'https://example.com/123')).toBe(true);
      expect(engine.isAllowed('ops', 'https://example.com/abc')).toBe(false);
    });

    it('evaluates domain == condition', () => {
      engine.setPolicyForProfile('ops', {
        defaultEffect: 'deny',
        rules: [{
          action: 'navigate',
          effect: 'allow',
          conditions: [{ field: 'domain', operator: '==', value: 'github.com' }],
        }],
      });

      expect(engine.isAllowed('ops', 'https://github.com/repo')).toBe(true);
      expect(engine.isAllowed('ops', 'https://gitlab.com/repo')).toBe(false);
    });

    it('evaluates domain != condition', () => {
      engine.setPolicyForProfile('ops', {
        defaultEffect: 'allow',
        rules: [{
          action: 'navigate',
          effect: 'deny',
          conditions: [{ field: 'domain', operator: '!=', value: 'allowed.com' }],
        }],
      });

      expect(engine.isAllowed('ops', 'https://blocked.com')).toBe(false);
    });
  });

  describe('loadPolicyFromYAML', () => {
    it('throws on invalid policy format', async () => {
      const yaml = await import('js-yaml');
      const fs = await import('fs-extra');
      vi.mocked(fs.readFile).mockResolvedValue('yaml content');
      vi.mocked(yaml.load).mockReturnValue({});

      await expect(engine.loadPolicyFromYAML('/path/to/policy.yaml')).rejects.toThrow(
        'Invalid policy format: missing profiles'
      );
    });

    it('loads valid YAML policy', async () => {
      const yaml = await import('js-yaml');
      const fs = await import('fs-extra');
      vi.mocked(fs.readFile).mockResolvedValue('valid yaml');
      vi.mocked(yaml.load).mockReturnValue({
        version: '1.0',
        profiles: {
          qa: { defaultEffect: 'deny', rules: [{ action: '*', effect: 'allow' }] },
        },
      });

      await engine.loadPolicyFromYAML('/path/to/policy.yaml');
      expect(engine.hasYAMLPolicies()).toBe(true);
      const qaPolicy = engine.getPolicy('qa');
      expect(qaPolicy?.defaultEffect).toBe('deny');
    });

    it('propagates read errors', async () => {
      const fs = await import('fs-extra');
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      await expect(engine.loadPolicyFromYAML('/missing.yaml')).rejects.toThrow('ENOENT');
    });
  });
});
