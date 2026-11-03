import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { InspectServer } from "../dist/core/inspect/InspectServer.js";
import { BrowserRouter } from "../dist/core/browser/BrowserRouter.js";
import { ChromiumEngine } from "../dist/core/browser/ChromiumEngine.js";
import { LightpandaEngine } from "../dist/core/browser/LightpandaEngine.js";
import { startFixtureServer } from "./benchmark-browser-engines.mjs";

// TALOX has no apex tools/open-the-page.mjs. ChromiumEngine uses BrowserManager's
// shared chromeLaunchArgs helper, so this capture carries both keychain flags.
const output = path.resolve(".apex/lightpanda-engine-dashboard.png");
const fixtures = await startFixtureServer();
const chromium = new ChromiumEngine({ profileRoot: ".apex/visual-profiles" });
const router = new BrowserRouter({ chromium, lightpanda: new LightpandaEngine() });
const inspector = new InspectServer({ port: 0, engineStatus: () => router.refreshResources(), setEngineMode: (mode) => router.setMode(mode) });
try {
  await router.execute({ url: `${fixtures.origin}/static`, operation: "extract", trustedContent: true });
  await router.execute({ url: `${fixtures.origin}/static`, operation: "query", selector: "a" });
  await inspector.attach({ url: () => `${fixtures.origin}/static`, context: () => ({ newCDPSession: async () => { throw new Error("Dashboard capture does not expose a target CDP session"); } }) });
  // The dashboard is owned but rendered; screenshots always use the Chromium adapter.
  const image = (await router.execute({ url: inspector.getDashboardAddress(), operation: "screenshot", timeoutMs: 15000 })).value;
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(image.data, "base64"));
  console.log(`screenshots: ${output}`);
} finally {
  await inspector.detach();
  await router.close();
  await fixtures.close();
}
