import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCapabilities } from '../../scripts/gen-capabilities.mjs';
import { TALOX_MCP_TOOLS } from '../../src/core/mcp/TaloxMcpServer.js';

const root = path.resolve(__dirname, '../..');
const committed = JSON.parse(fs.readFileSync(path.join(root, 'docs/capabilities.json'), 'utf8'));
const ids = new Set(committed.entries.map((entry: { id: string }) => entry.id));
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const visit = (node: ts.Node, fn: (node: ts.Node) => void) => {
  fn(node);
  ts.forEachChild(node, child => visit(child, fn));
};
let program: ts.Program;
beforeAll(() => {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  program = ts.createProgram(parsed.fileNames, parsed.options);
  program.getTypeChecker();
}, 60_000);

describe('source-derived capabilities contract', () => {
  it('matches fresh generation byte for byte', () => {
    expect(read('docs/capabilities.json')).toBe(`${JSON.stringify(generateCapabilities(), null, 2)}\n`);
  }, 60_000);

  it('independently covers every CLI dispatch route, subcommand, and parser flag', () => {
    const cliFiles = program.getSourceFiles().filter(file => file.fileName.startsWith(path.join(root, 'src/cli/')));
    const expected = new Set<string>();
    for (const file of cliFiles) visit(file, node => {
      if (ts.isSwitchStatement(node) && node.expression.getText() === 'command') {
        for (const clause of node.caseBlock.clauses) if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) {
          const command = clause.expression.text;
          expected.add(`cli:${command}`);
          for (const match of clause.getText().matchAll(/subcommand\s*===\s*"([^"]+)"/g)) expected.add(`cli:${command} ${match[1]}`);
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name?.text.startsWith('shouldUse')) {
        for (const match of node.getText().matchAll(/argv\[0\]\s*(?:===|!==)\s*"([^"]+)"/g)) expected.add(`cli:${match[1]}`);
      }
      if (ts.isFunctionDeclaration(node) && /^parse.*(Options|Args)$/.test(node.name?.text ?? '')) {
        const inventory = committed.entries.filter((entry: { kind: string; parserSource?: { source: string }[] }) =>
          entry.kind === 'cli' && entry.parserSource?.some(parser => parser.source === `${path.relative(root, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`));
        if (node.name?.text === 'parseArgs') return; // Generic argv split, not a command option parser.
        expect(inventory.length, node.name?.text).toBeGreaterThan(0);
        for (const match of node.getText().matchAll(/(?:case\s+|(?:arg\s*===\s*|args\.includes\())"(-[a-zA-Z][\w-]*)"/g)) {
          expect(inventory.some((entry: { arguments: { name: string }[] }) => entry.arguments.some(arg => arg.name === match[1])), `${node.name?.text}: ${match[1]}`).toBe(true);
        }
      }
    });
    expect([...ids].filter(id => (id as string).startsWith('cli:')).sort()).toEqual([...expected].sort());
    expect(committed.normalization[0].text).toBe(read('src/cli/normalize-argv.ts'));
  });

  it('covers exact MCP registrations, input schemas, defaults and return contracts', () => {
    const entries = committed.entries.filter((entry: { kind: string }) => entry.kind === 'mcp');
    expect(entries.map((entry: { id: string }) => entry.id).sort()).toEqual(TALOX_MCP_TOOLS.map(tool => tool.name).sort());
    for (const tool of TALOX_MCP_TOOLS) {
      const entry = entries.find((entry: { id: string }) => entry.id === tool.name);
      expect(entry.inputSchema).toEqual(tool.inputSchema);
      expect(entry.returns.shape).toContain('content: ToolContent[]');
      expect(entry.returns.handler).toBeTruthy();
    }
    expect(entries.find((entry: { id: string }) => entry.id === 'talox_state').arguments[0].default).toBe('agent');
  });

  it('independently resolves all exports of all four package entrypoints, including wildcard/type exports', () => {
    const checker = program.getTypeChecker();
    const expected = [];
    for (const entrypoint of ['index', 'plugins', 'adapters', 'local-vision']) {
      const file = program.getSourceFile(path.join(root, `src/${entrypoint}.ts`))!;
      for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(file)!)) expected.push(`${entrypoint}:${symbol.name}`);
    }
    expect(committed.entries.filter((entry: { role: string }) => entry.role === 'export').map((entry: { id: string }) => entry.id).sort()).toEqual(expected.sort());
  });

  it('has unique, source-located entries and explicitly lists every unresolved entry', () => {
    expect(ids.size).toBe(committed.entries.length);
    expect(JSON.stringify(committed)).not.toContain(root);
    expect(JSON.stringify(committed)).not.toMatch(/__@\w+@\d+/);
    for (const entry of committed.entries) {
      expect(entry.source).toMatch(/^src\/.+:\d+$/);
      expect(entry).toHaveProperty('signature');
      expect(entry).toHaveProperty('arguments');
      expect(entry).toHaveProperty('returns');
      expect(entry).toHaveProperty('errors');
      expect(entry.useWhen).toBeTruthy();
      for (const arg of entry.arguments) {
        expect(arg).toHaveProperty('type');
        expect(arg).toHaveProperty('default');
        expect(typeof arg.required).toBe('boolean');
      }
    }
    expect(committed.notDerivable.map((entry: { id: string }) => entry.id)).toEqual(committed.entries.filter((entry: { derived: boolean }) => !entry.derived).map((entry: { id: string }) => entry.id));
    console.info('Not derivable (review reasons in manifest):', committed.notDerivable.map((entry: { id: string }) => entry.id).join(', '));
  });
});
