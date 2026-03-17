import { describe, it, expect } from 'vitest';
import { RulesEngine } from '../../src/core/RulesEngine';
import { TaloxPageState } from '../../src/types';

describe('RulesEngine', () => {
  it('should detect JS errors in state', () => {
    const state: TaloxPageState = {
      url: 'http://test.com',
      title: 'Test',
      timestamp: '',
      console: { errors: ['ReferenceError: x is not defined'] },
      network: { failedRequests: [] },
      interactiveElements: [],
      bugs: [],
    };
    const engine = new RulesEngine();
    const bugs = engine.analyze(state);
    expect(bugs.length).toBe(1);
    expect(bugs[0].type).toBe('JS_ERROR');
  });
});
