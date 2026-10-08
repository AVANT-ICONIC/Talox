import { createReadStream } from "node:fs";
import { chmod, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LIGHTPANDA_VERSION = "1.0.0";
export const LIGHTPANDA_COMMIT = "588f6223b9cae8a2406aeef035ed9363a3e404fd";
const releaseBase = `https://github.com/lightpanda-io/browser/releases/download/${LIGHTPANDA_VERSION}/`;

export const LIGHTPANDA_ARTIFACTS = Object.freeze({
  "darwin-arm64": Object.freeze({
    name: "lightpanda-aarch64-macos", assetId: 605336160, bytes: 90354360,
    sha256: "955440053a84754dd64c62f970449a56a2b350cdf43ea5f2e809a73047b8173d",
  }),
  "darwin-x64": Object.freeze({
    name: "lightpanda-x86_64-macos", assetId: 605331526, bytes: 94122817,
    sha256: "e510299683b37a203912eac0ee00732224b2ef9b07fe58e69c467f5255be45e2",
  }),
  "linux-arm64": Object.freeze({
    name: "lightpanda-aarch64-linux", assetId: 605340458, bytes: 192757248,
    sha256: "69791924bcee43b13b224af4c845622c5fe66fdbc1b8143bfaa39ca8f85244f5",
  }),
  "linux-x64": Object.freeze({
    name: "lightpanda-x86_64-linux", assetId: 605343099, bytes: 188268424,
    sha256: "aa5a4b8ed53d1e38b3c73f5b2647d0a84a82e6744557f45f9a9c85858aa031c3",
  }),
});

export function selectArtifact(platform = process.platform, arch = process.arch) {
  const artifact = LIGHTPANDA_ARTIFACTS[`${platform}-${arch}`];
  if (!artifact) throw new Error(`Lightpanda ${LIGHTPANDA_VERSION} has no pinned binary for ${platform}/${arch}; use supported macOS or glibc Linux arm64/x64.`);
  return { ...artifact, url: releaseBase + artifact.name };
}

export async function verifyBinary(binaryPath, expected) {
  const metadata = await stat(binaryPath);
  if (!metadata.isFile()) throw new Error(`Lightpanda binary is not a regular file: ${binaryPath}`);
  if (metadata.size !== expected.bytes) throw new Error(`Lightpanda binary size mismatch: expected ${expected.bytes}, received ${metadata.size}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(binaryPath)) hash.update(chunk);
  const digest = hash.digest("hex");
  if (digest !== expected.sha256) throw new Error(`Lightpanda SHA256 mismatch: expected ${expected.sha256}, received ${digest}`);
  return digest;
}

export async function installLightpanda({
  cacheDir = path.resolve(".apex/cache/lightpanda"),
  platform = process.platform,
  arch = process.arch,
  fetchImpl = fetch,
} = {}) {
  const artifact = selectArtifact(platform, arch);
  const directory = path.resolve(cacheDir, LIGHTPANDA_VERSION);
  const binaryPath = path.join(directory, "lightpanda");
  let exists = true;
  try { await stat(binaryPath); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    exists = false;
  }
  if (exists) {
    await verifyBinary(binaryPath, artifact);
    await chmod(binaryPath, 0o700);
    return { binaryPath, version: LIGHTPANDA_VERSION, sha256: artifact.sha256, reused: true };
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const partialPath = path.join(directory, `download-${randomUUID()}.partial`);
  let handle;
  try {
    const response = await fetchImpl(artifact.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Lightpanda download failed: HTTP ${response.status} from ${artifact.url}`);
    if (!response.body) throw new Error("Lightpanda download failed: unread response body");
    handle = await open(partialPath, "wx", 0o600);
    let received = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > artifact.bytes) throw new Error(`Lightpanda download exceeded pinned size ${artifact.bytes}`);
      let offset = 0;
      while (offset < chunk.length) {
        const result = await handle.write(chunk, offset, chunk.length - offset);
        if (result.bytesWritten === 0) throw new Error("Lightpanda download could not be written");
        offset += result.bytesWritten;
      }
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await verifyBinary(partialPath, artifact);
    await chmod(partialPath, 0o700);
    await rename(partialPath, binaryPath);
    return { binaryPath, version: LIGHTPANDA_VERSION, sha256: artifact.sha256, reused: false };
  } finally {
    if (handle) await handle.close();
    await rm(partialPath, { force: true });
  }
}

function parseArgs(args) {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === "--cache-dir" && args[1]) return { cacheDir: args[1] };
  throw new Error("Usage: node scripts/install-lightpanda.mjs [--cache-dir <directory>]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await installLightpanda(parseArgs(process.argv.slice(2)));
    console.log(`Lightpanda ${result.version} verified: ${result.binaryPath}\nSHA256 ${result.sha256}\nSet TALOX_LIGHTPANDA_PATH to this path when running outside this checkout.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
