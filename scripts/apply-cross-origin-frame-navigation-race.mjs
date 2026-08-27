import fs from "node:fs";

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first === -1) throw new Error(`Missing anchor: ${label}`);
  if (source.indexOf(search, first + search.length) !== -1) throw new Error(`Duplicate anchor: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

const managerPath = "src/core/CrossOriginManager.ts";
let manager = fs.readFileSync(managerPath, "utf8");
manager = replaceOnce(
  manager,
  `\t\t\tif (this.page !== page || this.pageGeneration !== generation) {\n\t\t\t\tcdpSession.detach().catch(() => {}); // NOSONAR — best-effort stale cleanup\n\t\t\t\treturn;\n\t\t\t}\n\n\t\t\tconst frameId = this.resolveFrameId(frame);`,
  `\t\t\tif (\n\t\t\t\tthis.page !== page ||\n\t\t\t\tthis.pageGeneration !== generation ||\n\t\t\t\tframe.url() !== frameUrl ||\n\t\t\t\tparentFrame.url() !== parentUrl\n\t\t\t) {\n\t\t\t\tcdpSession.detach().catch(() => {}); // NOSONAR — best-effort stale cleanup\n\t\t\t\treturn;\n\t\t\t}\n\n\t\t\tconst frameId = this.resolveFrameId(frame);`,
  "same-page frame navigation stale guard",
);
fs.writeFileSync(managerPath, manager);

const testPath = "tests/unit/CrossOriginManagerRebindBootstrap.test.ts";
let test = fs.readFileSync(testPath, "utf8");
test = replaceOnce(
  test,
  `\tit("keeps only one live CDP session when bootstrap races a frameattached event", async () => {`,
  `\tit("does not let a late pre-navigation session overwrite the newer frame origin", async () => {\n\t\tconst parent = {\n\t\t\tname: vi.fn(() => "parent"),\n\t\t\turl: vi.fn(() => "https://parent.example/page"),\n\t\t\tparentFrame: vi.fn(() => null),\n\t\t};\n\t\tlet childUrl = "https://old.example/embed";\n\t\tconst child = {\n\t\t\tname: vi.fn(() => "navigating-child"),\n\t\t\turl: vi.fn(() => childUrl),\n\t\t\tparentFrame: vi.fn(() => parent),\n\t\t};\n\t\tconst sessions = [\n\t\t\t{ send: vi.fn(async () => ({})), detach: vi.fn(async () => undefined) },\n\t\t\t{ send: vi.fn(async () => ({})), detach: vi.fn(async () => undefined) },\n\t\t];\n\t\tconst resolvers: Array<(value: any) => void> = [];\n\t\tconst { page, newCDPSession } = createPage(\n\t\t\t[child],\n\t\t\t() => new Promise((resolve) => resolvers.push(resolve)),\n\t\t);\n\t\tconst manager = new CrossOriginManager();\n\n\t\tmanager.install(page as any);\n\t\tawait flushAsyncWork();\n\t\texpect(newCDPSession).toHaveBeenCalledTimes(1);\n\n\t\tchildUrl = "https://new.example/embed";\n\t\tconst navigation = page._emit("framenavigated", child);\n\t\tawait flushAsyncWork();\n\t\texpect(newCDPSession).toHaveBeenCalledTimes(2);\n\n\t\tresolvers[1]!(sessions[1]);\n\t\tawait navigation;\n\t\texpect(manager.getSession("navigating-child")?.origin).toBe("https://new.example");\n\n\t\tresolvers[0]!(sessions[0]);\n\t\tawait flushAsyncWork();\n\n\t\texpect(sessions[0].detach).toHaveBeenCalledOnce();\n\t\texpect(sessions[1].detach).not.toHaveBeenCalled();\n\t\texpect(manager.getSession("navigating-child")?.cdpSession).toBe(sessions[1]);\n\t\texpect(manager.getSession("navigating-child")?.origin).toBe("https://new.example");\n\t});\n\n\tit("keeps only one live CDP session when bootstrap races a frameattached event", async () => {`,
  "navigation race regression insertion",
);
fs.writeFileSync(testPath, test);
