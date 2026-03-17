import { describe, it, expect } from 'vitest';
import { BugEngine } from '../../src/core/BugEngine';
import { TaloxBug } from '../../src/types';

describe('BugEngine', () => {
  it('should format a bug report', () => {
    const bug: TaloxBug = {
      id: '1',
      type: 'JS_ERROR',
      severity: 'CRITICAL',
      description: 'Test Error',
      evidence: {},
    };
    const engine = new BugEngine();
    const report = engine.formatReport(bug);
    expect(report).toContain('CRITICAL');
    expect(report).toContain('Test Error');
  });
});
