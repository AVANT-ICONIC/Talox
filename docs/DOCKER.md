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

## Security boundary

The container process runs as the non-root `talox` user and sets `TALOX_CHROMIUM_SANDBOX=true`. In that mode Talox requests Playwright's Chromium sandbox and omits the `--no-sandbox` / `--disable-setuid-sandbox` launch flags. Docker CI verifies that the bundled Chromium can start with sandboxing enabled before exercising Talox browser detection.

Outside the official image, Talox keeps Chromium sandboxing disabled by default for compatibility with existing local/container setups. Set `TALOX_CHROMIUM_SANDBOX=true` or `browser.chromiumSandbox: true` when the host supports Chromium user namespaces / sandboxing.

Do not bake API keys, cookies, profile directories, or `.env` files into images. The repository `.dockerignore` excludes the common local state and secret paths for this reason.
