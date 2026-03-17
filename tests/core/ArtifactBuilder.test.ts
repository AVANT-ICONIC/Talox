import { describe, it, expect } from 'vitest';
import { ArtifactBuilder } from '../../src/core/ArtifactBuilder';

describe('ArtifactBuilder', () => {
  it('should build a basic trace artifact', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('navigate', { url: 'https://google.com' });
    const trace = builder.getTrace();
    expect(trace.actions.length).toBe(1);
    expect(trace.actions[0].type).toBe('navigate');
  });
});
