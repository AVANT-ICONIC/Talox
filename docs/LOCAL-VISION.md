# Local VLM Integration

Talox already exposes a `VisualReasoner` fallback interface. `createLocalVisionReasoner()` plugs local multimodal models into that existing path without adding a second vision architecture or requiring a cloud API.

The provider is available from `talox/local-vision` and has no additional runtime dependencies.

## Ollama

Ollama is the default provider:

```ts
import { TaloxController } from "talox";
import { createLocalVisionReasoner } from "talox/local-vision";

const talox = new TaloxController();

talox.useVision(
  createLocalVisionReasoner({
    model: "gemma4",
  }),
);
```

The default endpoint is:

```text
http://127.0.0.1:11434
```

Talox sends screenshots to Ollama's native `POST /api/chat` vision endpoint as base64 image data with `stream: false`.

Optional generation controls:

```ts
createLocalVisionReasoner({
  model: "gemma4",
  maxTokens: 300,
  keepAlive: "10m",
  timeoutMs: 60_000,
});
```

## OpenAI-compatible local servers

Local inference servers that expose an OpenAI-compatible multimodal chat API can use the second provider mode:

```ts
createLocalVisionReasoner({
  provider: "openai-compatible",
  model: "local-vision-model",
  baseUrl: "http://127.0.0.1:1234/v1",
  maxTokens: 300,
});
```

An API key is optional because many loopback inference servers do not require one:

```ts
createLocalVisionReasoner({
  provider: "openai-compatible",
  model: "local-vision-model",
  baseUrl: "http://localhost:8000/v1",
  apiKey: "local-key",
});
```

Compatibility depends on the local server and selected model actually supporting image input through chat completions.

## Screenshot privacy boundary

A feature called "local vision" should not silently upload screenshots somewhere else because a hostname was mistyped. Talox therefore rejects non-loopback endpoints by default.

Accepted without extra configuration:

- `localhost` and `*.localhost`
- IPv4 loopback addresses in `127.0.0.0/8`
- IPv6 loopback `::1`

A LAN or remote inference host requires explicit opt-in:

```ts
createLocalVisionReasoner({
  model: "vision-model",
  baseUrl: "http://192.168.1.25:11434",
  allowRemote: true,
});
```

`allowRemote: true` means screenshot bytes may be transferred to that host. Talox does not reinterpret a LAN endpoint as private merely because it happens to be nearby.

## Runtime behavior

The factory snapshots its configuration when the reasoner is created. Mutating the original config object later cannot swap the model, token limit, keep-alive value, or API credential used by an existing reasoner.

Requests use a bounded timeout. Non-2xx responses and malformed JSON are surfaced as errors to the existing `VisualReasoner` fallback boundary, where Talox already logs and isolates reasoner failures.

An empty or structurally incomplete successful response returns `null` rather than manufacturing an answer.

## Existing Talox flow

This provider does not change Talox's agent-first vision behavior:

1. Talox emits a `visualQuestion` to the hosting agent.
2. If the agent answers in time, that answer wins.
3. If it does not, the registered `VisualReasoner` is used as fallback.
4. A local reasoner can therefore provide private standalone fallback while preserving agent-native vision when available.

The same reasoner can also be consumed by existing Talox visual/captcha hooks that already use `VisualReasoner`.
