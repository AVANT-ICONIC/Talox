import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateCapabilities } from '../../scripts/gen-capabilities.mjs';

const manifestPath = path.resolve(__dirname, '../../docs/capabilities.json');

describe('capabilities manifest', () => {
  it('matches fresh generation', async () => {
    const committed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const fresh = generateCapabilities();
    expect(committed).toEqual(fresh);
  }, 60000);

  it('contains cli commands', () => {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const cli = data.entries.filter(e => e.kind === 'cli');
    expect(cli.length).toBeGreaterThan(0);
    expect(data.counts.cli).toBe(cli.length);
  });

  it('contains mcp tools', () => {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const mcp = data.entries.filter(e => e.kind === 'mcp');
    expect(mcp.length).toBeGreaterThan(0);
    expect(data.counts.mcp).toBe(mcp.length);
  });

  it('contains public api exports', () => {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const apiExports = data.entries.filter(e => e.kind === 'api' && e.role === 'export');
    expect(apiExports.length).toBeGreaterThan(0);
    expect(data.counts.apiExports).toBe(apiExports.length);
  });

  it('has presets env schema', () => {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(data.counts.preset).toBeGreaterThan(0);
    expect(data.counts.env).toBeGreaterThan(0);
    expect(data.counts.schema).toBeGreaterThan(0);
  });
});
