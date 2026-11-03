#!/usr/bin/env node
/** Offline executable recipes. Run from any directory; never selects installed Chrome. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { TaloxController, CrossOriginManager, getPracticalTools, PRESETS, setLogLevel } from '../../dist/index.js';
import { registerTaloxPlugin, unregisterTaloxPlugin, listTaloxPlugins } from '../../dist/plugins.js';
import { matchPlatformAdapters } from '../../dist/adapters.js';
import { createLocalVisionReasoner } from '../../dist/local-vision.js';
import { TaloxMcpSession } from '../../dist/core/mcp/TaloxMcpServer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(root, 'dist/cli/entry.js');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talox-guide-'));
const fixture = path.join(dir, 'fixture.html');
await fs.writeFile(fixture, `<!doctype html><html lang="en"><title>Talox lab</title>
<h1>Local browser lab</h1><label>Name <input id="name"></label>
<button id="save" onclick="document.querySelector('#result').textContent=document.querySelector('#name').value">Save</button>
<p id="result" role="status">Ready</p><table id="prices"><tr><th>Plan</th><th>Price</th></tr><tr><td>Lab</td><td>0</td></tr></table>
<iframe title="Local frame" srcdoc="<button id='inside'>Inside</button>"></iframe></html>`);
const url = pathToFileURL(fixture).href;
setLogLevel('silent');

function controller(id = 'lab') {
  const t = new TaloxController(dir, { settings: {
    ...PRESETS.ops, headed: false, safeMode: true, humanStealth: 0,
    fidgetEnabled: false, automaticThinkingEnabled: false, autoHeadedEscalation: false,
    adaptiveStealthEnabled: false, navigationWaitUntil: 'domcontentloaded',
  } });
  // v9.0.1: controller settings do not propagate to BrowserManager's separate config.
  // This exported-but-internal seam is required to guarantee bundled Chromium.
  t._session.browserManager.updateConfig({
    browser: { autoDetect: false, preferred: 'chromium', headless: true },
    settings: { adaptiveStealthEnabled: false, virtualDisplay: false },
  });
  return { t, id };
}
function healthy(state) { assert.equal(state.failed, undefined, JSON.stringify(state.failed)); return state; }
async function browser(fn, id = 'lab', observe) {
  const { t } = controller(id);
  try {
    await t.launch(id, 'qa', 'chromium', observe);
    healthy(await t.navigate(url));
    await fn(t);
  } finally { await t.stop(); }
}
function command(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, expected, result.stderr + result.stdout);
  return result.stdout;
}
const examples = {
  'cli-help': async () => { assert.match(command(['--help']), /talox observe/); },
  'cli-alias': async () => { assert.match(command(['-h']), /talox observe/); },
  'cli-init': async () => { command(['init', path.join(dir, 'scaffold')]); assert.ok((await fs.readdir(path.join(dir, 'scaffold'))).length); },
  'cli-options': async () => {
    for (const args of [['observe', '--help'], ['screenshot', '--help'], ['chat', '--help'], ['doctor', '--help'], ['daemon', '--help'], ['run', 'Read title', '--agents', '2', '--max-iterations', '1', '--help'], ['research', '--help'], ['skill', 'create', '--help'], ['mcp', '--help'], ['replay', '--help']]) command(args);
  },
  'read': () => browser(async t => {
    const state = healthy(await t.getState('full'));
    assert.equal(state.title, 'Talox lab'); assert.ok(state.nodes.length > 0);
    const agent = healthy(await t.getState('agent'));
    assert.ok(agent.interactiveElements.length > 0);
    const debug = healthy(await t.getState('debug')); assert.ok(debug.nodes.length > 0);
  }),
  'interact': () => browser(async t => {
    await t.waitForSelector('#save', 3000);
    const match = await t.findElement('Save', 'button'); assert.ok(match);
    healthy(await t.type('#name', 'Ada'));
    healthy(await t.click('#save'));
    assert.equal(await t.evaluate("document.querySelector('#result').textContent"), 'Ada');
  }),
  'form': () => browser(async t => {
    healthy(await t.type('#name', 'Test User'));
    healthy(await t.click('#save'));
    assert.equal(await t.evaluate("document.querySelector('#result').textContent"), 'Test User');
  }),
  'profile': async () => {
    await browser(async t => { await t.evaluate("localStorage.setItem('guide-profile', 'persisted')"); }, 'persistent');
    await browser(async t => { assert.equal(await t.evaluate("localStorage.getItem('guide-profile')"), 'persisted'); }, 'persistent');
  },
  'screenshot': () => browser(async t => {
    const raw = await t.screenshot({ path: path.join(dir, 'page.png') }); assert.ok(raw);
    const png = await t.annotatedScreenshot(); assert.equal(png.subarray(1, 4).toString(), 'PNG');
    await fs.writeFile(path.join(dir, 'annotated.png'), png);
  }),
  'pdf': () => browser(async t => {
    const pdf = await t.getPlaywrightPage().pdf({ path: path.join(dir, 'page.pdf'), format: 'A4', printBackground: true });
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  }),
  'scrape': () => browser(async t => {
    assert.deepEqual(await t.extractTable('#prices'), [{ col0: 'Plan', col1: 'Price' }, { col0: 'Lab', col1: '0' }]);
    const tools = getPracticalTools(t);
    const content = await tools.extractVisibleStructuredContent(); assert.equal(content.title, 'Talox lab');
    assert.ok(content.sections.length);
    const dest = await tools.exportMarkdownSnapshot(path.join(dir, 'snapshot.md'));
    assert.match(await fs.readFile(dest, 'utf8'), /Local browser lab/);
  }),
  'iframes': () => browser(async t => {
    const manager = new CrossOriginManager({ trustedDomains: ['https://frame.invalid'] });
    const trust = manager.assessTrust('https://frame.invalid/view', 'https://parent.invalid');
    assert.equal(trust.trusted, true);
    assert.equal(manager.assessTrust('https://other.invalid', 'https://parent.invalid').trusted, false);
    await t.getPlaywrightPage().frameLocator('iframe').locator('#inside').click();
    manager.dispose();
  }),
  'tabs': () => browser(async t => {
    const initial = t.getActivePageIndex();
    const result = await getPracticalTools(t).openBackgroundTab('about:blank'); healthy(result.state);
    assert.equal(t.getPageCount(), 2);
    // Despite the helper name, openPage activates the new tab in v9.0.1.
    t.switchPage(initial); assert.equal(healthy(await t.getState()).title, 'Talox lab');
    await t.closePage(1);
  }),
  'parallel': async () => {
    // Two independent browser runtimes, fixed tasks, no LLM service or agent delegation.
    const workers = [controller('worker-0').t, controller('worker-1').t];
    try {
      await Promise.all(workers.map((t, i) => t.launch(`worker-${i}`, 'qa', 'chromium')));
      const states = await Promise.all(workers.map(t => t.navigate(url)));
      states.forEach(state => assert.equal(healthy(state).title, 'Talox lab'));
    } finally { await Promise.all(workers.map(t => t.stop())); }
  },
  'replay': async () => {
    const reports = path.join(dir, 'reports');
    await browser(async t => { healthy(await t.click('#save')); }, 'recorded', { headed: false, overlay: false, record: true, output: 'both', outputDir: reports });
    const sessions = await fs.readdir(reports, { withFileTypes: true });
    const session = sessions.find(entry => entry.isDirectory()); assert.ok(session);
    const output = path.join(dir, 'replay.html');
    command(['replay', path.join(reports, session.name), '--output', output]);
    assert.match(await fs.readFile(output, 'utf8'), /<!doctype html>/i);
  },
  'vision': () => browser(async t => {
    // A local protocol fixture proves wiring; it does not claim real model inference.
    const server = http.createServer((req, res) => {
      assert.equal(req.url, '/api/chat');
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const data = JSON.parse(body); assert.ok(data.messages[0].images[0]);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message: { content: 'Local browser lab' } }));
      });
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const reasoner = createLocalVisionReasoner({ provider: 'ollama', model: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 3000, maxTokens: 64, keepAlive: 0, allowRemote: false });
      t.useVision(reasoner);
      assert.equal(await reasoner.analyze(await t.annotatedScreenshot(), 'Read the heading'), 'Local browser lab');
    } finally { await new Promise(resolve => server.close(resolve)); }
  }),
  'plugins': async () => {
    const info = registerTaloxPlugin({ name: 'guide-lab', version: '1.0.0', rules: [{ id: 'lab-rule', analyze: () => [] }] });
    assert.equal(info.name, 'guide-lab'); assert.ok(listTaloxPlugins().some(p => p.name === 'guide-lab'));
    assert.equal(unregisterTaloxPlugin('guide-lab'), true);
  },
  'adapters': async () => {
    // URL matching only; never contacts this host.
    const matches = matchPlatformAdapters('https://github.com/AVANT-ICONIC/Talox/issues', 'Issues');
    assert.ok(matches.some(match => match.adapterId === 'github'));
  },
  'mcp': async () => {
    const session = new TaloxMcpSession(() => controller('mcp-lab').t);
    let id = 0;
    async function request(method, params) {
      const response = await session.handle({ jsonrpc: '2.0', id: ++id, method, params });
      assert.equal(response.error, undefined, JSON.stringify(response)); return response.result;
    }
    async function tool(name, args) {
      const result = await request('tools/call', { name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result)); return result;
    }
    try {
      await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'guide', version: '1' } });
      assert.equal((await request('tools/list', {})).tools.length, 7);
      await tool('talox_launch', { profileId: 'mcp-lab', profileClass: 'qa', browser: 'chromium' });
      healthy(JSON.parse((await tool('talox_navigate', { url })).content[0].text));
      healthy(JSON.parse((await tool('talox_type', { selector: '#name', text: 'MCP' })).content[0].text));
      healthy(JSON.parse((await tool('talox_click', { selector: '#save' })).content[0].text));
      healthy(JSON.parse((await tool('talox_state', { variant: 'agent' })).content[0].text));
      assert.equal((await tool('talox_screenshot', { selector: '#save' })).content[0].mimeType, 'image/png');
      await tool('talox_stop', {});
    } finally { await session.close(); }
  },
  'mcp-stdio': async () => {
    const child = spawn(process.execPath, [cli, 'mcp'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const exit = once(child, 'exit');
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`);
    const [code] = await exit; assert.equal(code, 0, stderr);
    assert.equal(JSON.parse(stdout.trim()).result.tools.length, 7);
  },
};

const selected = process.argv[2];
if (selected && !Object.hasOwn(examples, selected)) throw new Error(`Unknown recipe: ${selected}`);
let failures = 0;
for (const [id, run] of Object.entries(examples)) {
  if (selected && selected !== id) continue;
  try { await run(); console.log(`${id}\texit=0`); }
  catch (error) { failures++; console.error(`${id}\texit=1\n`, error); }
}
console.log(`Artifacts: ${dir}`);
process.exitCode = failures ? 1 : 0;
