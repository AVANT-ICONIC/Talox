# Talox plugins

Talox plugins extend browser QA without patching Talox core. A plugin can contribute:

- **Rules**: synchronous structured-state checks that run automatically inside `RulesEngine.analyze()`.
- **Vision detectors**: asynchronous screenshot checks that run only when explicitly requested.

The registry is process-wide and dependency-free. Import it from the dedicated public entrypoint:

```ts
import {
  registerTaloxPlugin,
  runTaloxVisionDetectors,
} from "talox/plugins";
```

## Register a community rule

```ts
registerTaloxPlugin({
  name: "acme-a11y",
  version: "1.0.0",
  rules: [
    {
      id: "empty-button-label",
      analyze(state) {
        return state.interactiveElements
          .filter((element) => element.tagName === "button" && !element.text)
          .map((element) => ({
            id: element.id,
            type: "MISSING_ACCESSIBLE_LABEL",
            severity: "MAJOR",
            description: "Button has no accessible label.",
            evidence: { element },
          }));
      },
    },
  ],
});
```

Plugin findings are automatically namespaced before they enter Talox state:

```text
plugin:acme-a11y:empty-button-label:#submit
```

Talox also adds plugin provenance to `bug.metadata.taloxPlugin`.

### Rule contract

Rules should be fast, synchronous, and side-effect free. They receive the current `TaloxPageState` as read-only input and may return:

- an array of valid `TaloxBug` objects,
- an empty array,
- `null`, or
- `undefined`.

A rule exception, malformed return value, or malformed bug is isolated and logged. Other built-in and community rules continue to run.

## Register a vision detector

Vision detectors are intentionally opt-in. Talox does **not** run them every time state is collected because model-backed or image-heavy checks can be expensive.

```ts
registerTaloxPlugin({
  name: "acme-visual-qa",
  version: "1.0.0",
  visionDetectors: [
    {
      id: "obscured-primary-cta",
      async detect(screenshot, context) {
        // Run a local model, remote model, OpenCV pipeline, etc.
        return [
          {
            type: "OBSCURED_CTA",
            description: `Primary CTA appears obscured on ${context.url}`,
            confidence: 0.93,
            evidence: { region: "bottom-right" },
          },
        ];
      },
    },
  ],
});
```

Run registered detectors explicitly:

```ts
const results = await runTaloxVisionDetectors(pngBuffer, {
  url: "https://example.com/checkout",
  title: "Checkout",
});
```

Each detector gets its own screenshot buffer copy. Exceptions and malformed output are returned as an `error` on that detector's result instead of aborting the batch.

## Registry lifecycle

```ts
import {
  clearTaloxPlugins,
  listTaloxPlugins,
  unregisterTaloxPlugin,
} from "talox/plugins";

console.log(listTaloxPlugins());
unregisterTaloxPlugin("acme-a11y");
clearTaloxPlugins();
```

Registration order is preserved. Plugin names must be unique. Rule IDs are unique across registered rules, and vision detector IDs are unique across registered detectors. Registration is transactional: if validation fails, none of that plugin's hooks are installed.

Because the registry is **process-wide**, a plugin becomes visible to all `RulesEngine` instances in that Node.js process. Hosts that need tenant isolation should run separate processes or explicitly register/unregister plugins around isolated work.

## Plugin author checklist

Before publishing a community plugin:

- choose stable rule and detector IDs that will not collide with other installed plugins,
- keep structured rules synchronous and cheap enough to run on every QA pass,
- put network/model/image work in explicit vision detectors instead of rules,
- return complete `TaloxBug` objects with deterministic evidence,
- treat the supplied page state and screenshot as inputs rather than shared mutable state,
- version behavior changes so hosts can report exactly which plugin produced a finding.

## Why rules and vision detectors are separate

Structured rules are cheap and deterministic, so they belong in the standard QA pass. Vision detectors may involve large image transforms or model inference, so callers decide when their cost is justified. This keeps the normal Talox state loop compact while still giving community extensions a first-class visual-analysis seam.