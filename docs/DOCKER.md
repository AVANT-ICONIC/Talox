# Running Talox in Docker

Talox ships a container definition pinned to the same Playwright version used by the project. The image includes the Playwright browser/runtime system dependencies, installs Talox production dependencies, and runs as an unprivileged `talox` user.

## Build

```bash
docker build -t talox:local .
```

## Run

The container entrypoint is the Talox CLI, so normal CLI arguments can be passed directly:

```bash
docker run --rm --init --ipc=host talox:local --help
```

For agent runs, pass provider credentials through the environment rather than baking them into the image:

```bash
docker run --rm --init --ipc=host \
  -e OPENAI_API_KEY \
  -v talox-profiles:/workspace/.talox-profiles \
  -v talox-state:/home/talox/.talox \
  talox:local run "Inspect the target page"
```

Mount a host working directory when Talox should read or write project artifacts:

```bash
docker run --rm --init --ipc=host \
  -e OPENAI_API_KEY \
  -v "$PWD:/workspace" \
  -v talox-state:/home/talox/.talox \
  talox:local run "Inspect the app in this workspace"
```

`--ipc=host` is recommended for Chromium workloads because constrained shared memory can make Chromium unstable. `--init` prevents zombie child processes when browsers exit.

## Persistent state

The image exposes two persistence locations:

- `/workspace/.talox-profiles` for browser profiles created relative to the working directory.
- `/home/talox/.talox` for Talox user-level state and skills.

Use named volumes or bind mounts if sessions must survive container replacement.

## Browser detection

The image intentionally relies on Playwright's bundled Chromium rather than installing a second system Chrome. Talox's browser auto-detection probes the Playwright-managed browser first, so the image remains usable even when `/usr/bin/google-chrome` is absent.

The Docker CI workflow verifies this by starting the built image and calling `BrowserManager.detectBrowsers()` as the unprivileged runtime user.

## Chromium sandbox mode

Talox keeps Chromium sandboxing disabled by default for compatibility with Docker and Linux hosts that do not permit unprivileged user namespaces. The runtime exposes an explicit `browser.chromiumSandbox` setting and the equivalent `TALOX_CHROMIUM_SANDBOX=true` environment override.

For crawling or other untrusted-web workloads, enable the Chromium sandbox together with Playwright's seccomp profile. The profile is the Docker default seccomp policy extended with the user-namespace syscalls Chromium needs. Keep the profile version aligned with the locked `playwright-core` version:

```bash
PLAYWRIGHT_VERSION=$(node -p 'require("./package-lock.json").packages["node_modules/playwright-core"].version')
curl -fsSL \
  "https://raw.githubusercontent.com/microsoft/playwright/v${PLAYWRIGHT_VERSION}/utils/docker/seccomp_profile.json" \
  -o playwright-seccomp.json

docker run --rm --init --ipc=host \
  --security-opt seccomp="$PWD/playwright-seccomp.json" \
  -e TALOX_CHROMIUM_SANDBOX=true \
  -e OPENAI_API_KEY \
  -v talox-profiles:/workspace/.talox-profiles \
  -v talox-state:/home/talox/.talox \
  talox:local run "Inspect the target page"
```

When sandbox mode is enabled, Talox requests Playwright's Chromium sandbox and omits its compatibility `--no-sandbox` and `--disable-setuid-sandbox` flags. Docker CI downloads the seccomp profile from the exact locked Playwright tag and proves that the bundled Chromium starts sandboxed as the non-root `talox` user.

Do not enable sandbox mode without configuring the host/container runtime to support it. Talox intentionally fails the browser launch instead of silently falling back to an unsandboxed browser.

## Security boundary

Running the process as the non-root `talox` user reduces the impact of a compromised browser process. For untrusted targets, use the sandboxed invocation above so Chromium's own process sandbox remains active in addition to Docker's isolation.

Do not bake API keys, cookies, profile directories, or `.env` files into images. The repository `.dockerignore` excludes the common local state and secret paths for this reason.
