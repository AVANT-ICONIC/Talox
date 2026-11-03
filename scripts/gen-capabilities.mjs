#!/usr/bin/env node
/** Source-only, deterministic capability inventory. Never imports executable Talox code. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relative = p => path.relative(root, p).split(path.sep).join('/');
const walk = (n, fn) => { fn(n); ts.forEachChild(n, c => walk(c, fn)); };
const strip = n => {
  while (n && (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n))) n = n.expression;
  return n;
};
// Evaluate only syntax literals, never source code. Expressions remain visible as source.
function literal(node) {
  const n = strip(node);
  if (!n) return null;
  if (ts.isStringLiteralLike(n)) return n.text;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (n.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(n)) return n.elements.map(literal);
  if (ts.isObjectLiteralExpression(n)) return Object.fromEntries(n.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText().replace(/^['"]|['"]$/g, ''), literal(p.initializer)]));
  return { expression: n.getText() };
}

export function generateCapabilities() {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter(f => f.fileName.startsWith(path.join(root, 'src') + path.sep)).sort((a,b) => a.fileName.localeCompare(b.fileName, 'en'));
  const source = n => `${relative(n.getSourceFile().fileName)}:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const stableType = value => value.split(root + path.sep).join('');
  const typeText = t => stableType(checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation));
  const errors = [];
  const unresolved = value => {
    if (!value || typeof value !== 'object') return false;
    return Object.hasOwn(value, 'expression') || Object.values(value).some(unresolved);
  };
  for (const f of files) walk(f, n => {
    if (ts.isThrowStatement(n)) errors.push({ source: source(n), expression: n.expression.getText() });
    if (ts.isCallExpression(n) && n.expression.getText() === 'toolError') errors.push({ source: source(n), expression: n.getText() });
  });
  const localErrors = n => errors.filter(e => e.source.startsWith(relative(n.getSourceFile().fileName) + ':') && Number(e.source.split(':').at(-1)) >= n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1 && Number(e.source.split(':').at(-1)) <= n.getSourceFile().getLineAndCharacterOfPosition(n.end).line + 1);
  const entries = [];
  const add = (kind, id, n, extra = {}) => {
    const entry = { id, kind, signature: n.getText(), arguments: [], returns: null, errors: localErrors(n), source: source(n), useWhen: '', derived: true, ...extra };
    if (unresolved({ arguments: entry.arguments, overloads: entry.overloads, overrides: entry.overrides, settings: entry.settings })) { entry.derived = false; entry.notDerived = [...(entry.notDerived ?? []), 'Some values are unevaluated source expressions.']; }
    entries.push(entry); return entry;
  };
  const doc = symbol => ts.displayPartsToString(symbol?.getDocumentationComment(checker) ?? []).split('\n').find(s => s.trim()) ?? '';
  function argument(p) {
    return { name: p.name.getText(), type: typeText(checker.getTypeAtLocation(p)), required: !p.questionToken && !p.initializer && !p.dotDotDotToken, default: p.initializer ? literal(p.initializer) : null, ...(p.initializer ? { defaultSource: p.initializer.getText() } : {}) };
  }
  function properties(type, depth = 0) {
    if (depth > 1 || !(type.flags & ts.TypeFlags.Object) || type.getCallSignatures().length || checker.isArrayType(type) || type.symbol?.declarations?.some(ts.isClassDeclaration)) return [];
    return checker.getPropertiesOfType(type).filter(symbol => symbol.declarations?.some(d => d.getSourceFile().fileName.startsWith(path.join(root, 'src') + path.sep))).map(symbol => {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      if (!declaration) return { name: symbol.name, derived: false };
      const t = checker.getTypeOfSymbolAtLocation(symbol, declaration);
      return { name: symbol.name, type: typeText(t), required: !(symbol.flags & ts.SymbolFlags.Optional), default: declaration.initializer ? literal(declaration.initializer) : null, source: source(declaration), description: doc(symbol), properties: properties(t, depth + 1) };
    });
  }
  function callable(n) {
    const sig = checker.getSignatureFromDeclaration(n);
    return { signature: sig ? stableType(checker.signatureToString(sig, n, ts.TypeFormatFlags.NoTruncation)) : n.getText(), arguments: (n.parameters ?? []).map(p => ({ ...argument(p), properties: properties(checker.getTypeAtLocation(p)) })), returns: sig ? typeText(checker.getReturnTypeOfSignature(sig)) : null };
  }
  // Compiler-resolved exports include wildcard re-exports and type-only names.
  for (const entrypoint of ['index', 'plugins', 'adapters', 'local-vision']) {
    const f = program.getSourceFile(path.join(root, `src/${entrypoint}.ts`));
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(f)).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const n = symbol.valueDeclaration ?? symbol.declarations?.[0];
      if (!n) throw new Error(`Export has no declaration: ${entrypoint}:${exported.name}`);
      const type = checker.getTypeOfSymbolAtLocation(symbol, n);
      const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
      const e = add('api', `${entrypoint}:${exported.name}`, n, { entrypoint: entrypoint === 'index' ? 'talox' : `talox/${entrypoint}`, exportName: exported.name, role: 'export', signature: n.getText().split('{')[0].trim(), type: typeText(checker.getDeclaredTypeOfSymbol(symbol)), useWhen: doc(symbol) || `Use the exported ${exported.name} contract.`, overloads: signatures.map(s => ({ signature: stableType(checker.signatureToString(s, n, ts.TypeFormatFlags.NoTruncation)), arguments: s.parameters.map(p => { const d = p.valueDeclaration ?? p.declarations[0]; return ts.isParameter(d) ? argument(d) : { name: p.name, type: typeText(checker.getTypeOfSymbolAtLocation(p,d)), required: !(p.flags & ts.SymbolFlags.Optional), default: null }; }), returns: typeText(checker.getReturnTypeOfSignature(s)) })) });
      if (signatures.length) { Object.assign(e, e.overloads[0]); e.arguments = e.arguments.map((a, i) => ({ ...a, properties: properties(checker.getTypeOfSymbolAtLocation(signatures[0].parameters[i], n)) })); }
      else e.returns = ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) ? n.getText() : typeText(type);
      e.properties = ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) ? properties(checker.getDeclaredTypeOfSymbol(symbol)) : [];
      // Public class members make controller and extension calls discoverable.
      if (ts.isClassDeclaration(n)) for (const m of n.members) {
        if (m.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword) || m.name && ts.isPrivateIdentifier(m.name)) continue;
        if (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
          const name = m.name?.getText() ?? 'constructor';
          add('api', `${entrypoint}:${exported.name}.${name}@${source(m).split(':').at(-1)}`, m, { role: 'member', parent: e.id, ...callable(m), useWhen: doc(checker.getSymbolAtLocation(m.name ?? n.name)) || `Call ${exported.name}.${name}.` });
        }
      }
    }
  }
  // Also inventory practical functions that are reached through the public factory.
  const practical = program.getSourceFile(path.join(root, 'src/tools/practical-tools.ts'));
  for (const n of practical.statements.filter(ts.isFunctionDeclaration)) add('api', `practical:${n.name.text}`, n, { role: 'practical', ...callable(n), useWhen: `Use practical tool ${n.name.text}.` });

  const mcp = program.getSourceFile(path.join(root, 'src/core/mcp/TaloxMcpServer.ts'));
  walk(mcp, n => {
    if (!ts.isVariableDeclaration(n) || n.name.getText() !== 'TALOX_MCP_TOOLS') return;
    for (const item of strip(n.initializer).elements) {
      const data = literal(item);
      const handler = mcp.statements.filter(ts.isClassDeclaration).flatMap(c => c.members).find(m => m.name?.getText() === data.name.replace('talox_', ''));
      const defaults = {};
      if (handler) walk(handler, c => {
        if (ts.isVariableDeclaration(c) && c.initializer && ts.isBinaryExpression(c.initializer) && c.initializer.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) defaults[c.name.getText()] = literal(c.initializer.right);
      });
      add('mcp', data.name, item, { signature: `${data.name}(arguments)`, description: data.description, inputSchema: data.inputSchema, arguments: Object.entries(data.inputSchema.properties).map(([name, schema]) => ({ name, ...schema, required: (data.inputSchema.required ?? []).includes(name), default: defaults[name] ?? null })), returns: { type: 'ToolCallResult', shape: mcp.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === 'ToolCallResult').getText(), handler: handler?.getText() ?? null }, errors: handler ? localErrors(handler) : [], useWhen: data.description });
    }
  });
  // CLI discovery follows actual dispatcher case labels and dedicated shouldUse predicates.
  const cliFiles = files.filter(f => relative(f.fileName).startsWith('src/cli/'));
  const commandNodes = new Map();
  for (const f of cliFiles) walk(f, n => {
    if (ts.isSwitchStatement(n) && n.expression.getText() === 'command') for (const c of n.caseBlock.clauses) if (ts.isCaseClause(c) && ts.isStringLiteral(c.expression)) c.expression.text && commandNodes.set(c.expression.text, c);
    if (ts.isFunctionDeclaration(n) && n.name?.text.startsWith('shouldUse')) walk(n, c => {
      if (ts.isBinaryExpression(c) && c.left.getText() === 'argv[0]' && ts.isStringLiteral(c.right) && !commandNodes.has(c.right.text)) commandNodes.set(c.right.text, n);
    });
  });
  // A subcommand is an equality-tested literal inside a dispatched command.
  for (const [name,n] of [...commandNodes]) walk(n, c => {
    if (ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && c.left.getText() === 'subcommand' && ts.isStringLiteral(c.right)) commandNodes.set(`${name} ${c.right.text}`, c);
  });
  for (const [name,n] of [...commandNodes].sort(([a],[b]) => a.localeCompare(b,'en'))) {
    if (!name || !name.trim()) continue;
    const words = name.split(' ').filter(Boolean);
    const stem = words.map(w => w[0].toUpperCase()+w.slice(1)).join('');
    const parsers = cliFiles.flatMap(f => f.statements.filter(ts.isFunctionDeclaration)).filter(f => new RegExp(`^parse${stem}(Options|Args)$`).test(f.name?.text ?? '') || name === 'run' && f.name?.text === 'parseMultiAgentRunOptions');
    const args = [];
    for (const parser of parsers) {
      const defaults = {};
      walk(parser, c => { if (ts.isVariableDeclaration(c) && ['opts','options'].includes(c.name.getText()) && c.initializer) Object.assign(defaults,literal(c.initializer)); });
      const flags = new Map();
      walk(parser, c => {
        if (ts.isCaseClause(c) && ts.isStringLiteral(c.expression) && c.expression.text.startsWith('-')) {
          const clauses = c.parent.clauses; let j = clauses.indexOf(c); let body = c;
          while (!body.statements.length && j+1 < clauses.length) body = clauses[++j];
          const assignments = [];
          walk(body, a => { if (ts.isBinaryExpression(a) && a.operatorToken.kind === ts.SyntaxKind.EqualsToken && /^(opts|options)\./.test(a.left.getText())) assignments.push(a); });
          const field = assignments[0]?.left.getText().split('.')[1];
          flags.set(c.expression.text, { name: c.expression.text, type: field ? typeText(checker.getTypeAtLocation(assignments[0].left)) : 'boolean', required: false, default: field ? defaults[field] ?? null : false, field: field ?? null, parser: source(parser) });
        }
        // if-based parsers, including daemon and replay.
        if (ts.isBinaryExpression(c) && c.left.getText() === 'arg' && ts.isStringLiteral(c.right) && c.right.text.startsWith('-') && !flags.has(c.right.text)) {
          let block = c; while (block.parent && !ts.isIfStatement(block)) block = block.parent;
          let assignment;
          if (ts.isIfStatement(block)) walk(block.thenStatement, a => { if (!assignment && ts.isBinaryExpression(a) && a.operatorToken.kind === ts.SyntaxKind.EqualsToken && /^(opts|options)\./.test(a.left.getText())) assignment = a; });
          const field = assignment?.left.getText().split('.')[1];
          flags.set(c.right.text, { name: c.right.text, type: field ? typeText(checker.getTypeAtLocation(assignment.left)) : 'boolean', required: false, default: field ? defaults[field] ?? null : false, field: field ?? null, parser: source(parser) });
        }
      });
      args.push(...flags.values());
    }
    // Keep source usage and execution code for positional/conditional requirements.
    const runners = cliFiles.flatMap(f => f.statements.filter(ts.isFunctionDeclaration)).filter(f => f.name?.text === `run${stem}` || f.name?.text === `run${stem}Command` || name === 'run' && f.name?.text === 'runMultiAgentRun');
    for (const runner of [...parsers, ...runners]) walk(runner, c => {
      if (ts.isCallExpression(c) && /^(args|argv)\.includes$/.test(c.expression.getText()) && c.arguments[0] && ts.isStringLiteral(c.arguments[0]) && c.arguments[0].text.startsWith('-') && !args.some(a => a.name === c.arguments[0].text)) args.push({name:c.arguments[0].text,type:'boolean',required:false,default:false,parser:source(runner)});
    });
    // Preserve non-switch spellings such as --agents=N.
    for (const f of cliFiles) walk(f, c => {
      if (name === 'run' && ts.isCallExpression(c) && c.expression.getText() === 'arg.startsWith' && ts.isStringLiteral(c.arguments[0]) && c.arguments[0].text.startsWith('--')) {
        const spelling = c.arguments[0].text;
        if (!args.some(a => a.name === spelling)) args.push({ name: spelling, type: 'number', required: false, default: null, parser: source(c) });
      }
    });
    const requirements = [];
    for (const runner of runners) walk(runner, c => {
      if (ts.isIfStatement(c) && /!opts\.[a-zA-Z]/.test(c.expression.getText()) && /process\.exit\(1\)/.test(c.thenStatement.getText())) {
        requirements.push({ condition: c.expression.getText(), source: source(c) });
        const match = /^!opts\.(\w+)$/.exec(c.expression.getText());
        if (match) for (const a of args) if (a.field === match[1]) a.required = true;
      }
    });
    const positionals = [];
    for (const parser of parsers) walk(parser, c => {
      if (ts.isBinaryExpression(c) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken].includes(c.operatorToken.kind) && /^(opts|options)\./.test(c.left.getText()) && /(?:^arg$|^positional\.|\barg\b)/.test(c.right.getText())) {
        const field = c.left.getText().split('.')[1];
        if (!positionals.some(p => p.name === field)) positionals.push({ name: field, type: typeText(checker.getTypeAtLocation(c.left)), required: requirements.some(r => r.condition === `!opts.${field}`), default: null, positional: true, source: source(c) });
      }
      if (ts.isVariableDeclaration(c) && c.name.getText() === 'explicitDir') positionals.push({ name: c.name.getText(), type: typeText(checker.getTypeAtLocation(c)), required: false, default: null, positional: true, source: source(c), expression: c.initializer.getText() });
    });
    args.push(...positionals);
    const usageLines = cliFiles.flatMap(f => f.text.split('\n').map((line,i) => ({text:line.trim(),source:`${relative(f.fileName)}:${i+1}`}))).filter(l => l.text.startsWith(`talox ${name}`));
    add('cli', `cli:${name}`, n, { signature: usageLines.map(l=>l.text).join(' | ') || `talox ${name}`, arguments: args, requirements, returns: 'Promise<void>; console output and process exit status', useWhen: usageLines[0]?.text ?? `Run talox ${name}.`, derived: false, notDerived: ['Positional arguments and conditional requiredness require reading parserSource / executionSource; flags default to optional, not a claim that goals or credentials are optional.'], parserSource: parsers.map(p=>({source:source(p),text:p.getText()})), executionSource: runners.map(p=>({source:source(p),text:p.getText()})), errors: runners.flatMap(localErrors), usage: usageLines });
  }
  const normalization = cliFiles.filter(f=>relative(f.fileName).endsWith('normalize-argv.ts')).map(f=>({source:`${relative(f.fileName)}:1`,text:f.text}));
  let defaultSettings = {};
  const settingsFile = program.getSourceFile(path.join(root, 'src/types/settings.ts'));
  walk(settingsFile, n => { if (ts.isVariableDeclaration(n) && n.name.getText() === 'DEFAULT_SETTINGS') defaultSettings = literal(n.initializer); });
  const presetFile = program.getSourceFile(path.join(root,'src/presets.ts'));
  walk(presetFile,n=>{
    if (!ts.isVariableDeclaration(n) || n.name.getText() !== 'PRESETS') return;
    for (const p of n.initializer.properties) add('preset', `preset:${p.name.getText().replaceAll('"','')}`,p,{signature:`PRESETS[${JSON.stringify(p.name.getText().replaceAll('"',''))}]`, returns:'TaloxSettings', overrides:literal(p.initializer.arguments[0]), settings: { ...defaultSettings, ...literal(p.initializer.arguments[0]) }, base:'DEFAULT_SETTINGS', useWhen:`Apply ${p.name.getText()} settings.`, arguments:[]});
  });
  const envs = new Map();
  for (const f of files) walk(f,n=>{
    if (!(ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) || n.expression.getText() !== 'process.env') return;
    if (ts.isDeleteExpression(n.parent) || ts.isBinaryExpression(n.parent) && n.parent.left === n && n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return;
    const name = ts.isPropertyAccessExpression(n) ? n.name.text : ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : '<dynamic>';
    if (!envs.has(name)) envs.set(name,[]);
    envs.get(name).push({source:source(n), context:n.parent.getText()});
  });
  for (const [name,reads] of [...envs].sort(([a],[b])=>a.localeCompare(b,'en'))) {
    entries.push({id:`env:${name}`,kind:'env',signature:`process.env[${JSON.stringify(name)}]`,arguments:[{name,type:'string | undefined',required:false,default:null}],returns:'string | undefined',errors:[],source:reads[0].source,useWhen:`Configure ${name}; see read contexts for precedence and fallbacks.`,derived:false,notDerived:['No single global default: conditional behavior and fallback expressions are recorded per read.'],reads});
  }
  // Record whole-environment reads as well (e.g. inherited subprocess environment).
  for (const f of files) walk(f,n=>{
    if (!ts.isPropertyAccessExpression(n) || n.getText() !== 'process.env') return;
    if ((ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) && n.parent.expression === n) return;
    entries.push({id:`env:*@${source(n)}`,kind:'env',signature:n.parent.getText(),arguments:[],returns:'NodeJS.ProcessEnv',errors:[],source:source(n),useWhen:'Inherit the process environment.',derived:true});
  });
  for (const name of fs.readdirSync(path.join(root,'src/schema')).sort()) {
    if (!name.endsWith('.json')) continue;
    const schema = JSON.parse(fs.readFileSync(path.join(root,'src/schema',name),'utf8'));
    entries.push({id:`schema:${schema.title ?? name}`,kind:'schema',signature:schema.$id ?? name,arguments:Object.entries(schema.properties ?? {}).map(([name,p])=>({name,...p,type:p.type ?? p.$ref ?? null,required:(schema.required ?? []).includes(name),default:p.default ?? null})),returns:schema,errors:[],source:`src/schema/${name}:1`,useWhen:schema.description ?? `Validate ${name}.`,derived:true});
  }
  entries.sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const counts = Object.fromEntries(['cli','mcp','api','preset','env','schema'].map(k=>[k,entries.filter(e=>e.kind===k).length]));
  counts.apiExports = entries.filter(e=>e.kind==='api' && e.role==='export').length;
  counts.envVariables = envs.size;
  return {formatVersion:2,packageVersion:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version, provenance:'Source AST + TypeScript checker; defaults expressed as source are not evaluated. null means no statically established default, not a runtime null. Errors are direct throw sites, not an exhaustive transitive exception contract. useWhen falls back to a source symbol label when no JSDoc exists.',counts,normalization,entries,notDerivable:entries.filter(e=>!e.derived).map(e=>({id:e.id,reasons:e.notDerived})),errors};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = JSON.stringify(generateCapabilities(), null, 2) + '\n';
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex < 0 ? path.join(root,'docs/capabilities.json') : process.argv[outputIndex+1];
  fs.writeFileSync(output,json);
  console.log(`Capabilities written: ${output}`);
}
