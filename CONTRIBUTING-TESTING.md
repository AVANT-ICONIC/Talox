# 🤖 Talox Agent-to-Agent Testing & Stress Run Guide

This guide is for any AI agent or developer who needs to verify the **Talox** system. It covers the logic behind the "Stress Test Waves" and how to perform them safely.

---

## 🚀 Quick Start: Running the Tests
Before running any test, ensure the project is built:
```bash
npm install && npm run build
```

Execute the standard stress test suites using `node` with the ESM loader:
```bash
# Wave 1: Core functionality (Search, Extraction, Policy, Visual Gate)
NODE_OPTIONS="--loader ts-node/esm --no-warnings" node examples/agent-stress-test.ts

# Wave 2: Advanced UI (Structural Bugs, Multi-Tab, Infinite Scroll)
NODE_OPTIONS="--loader ts-node/esm --no-warnings" node examples/agent-stress-test-wave2.ts

# Wave 3: Behavioral Nuance (Rapid Clicking, Form Filling, Foveated Perception)
NODE_OPTIONS="--loader ts-node/esm --no-warnings" node examples/agent-stress-test-wave3.ts
```

---

## 🛠️ Interaction Modes (MANDATORY LOGIC)
When testing, you **must** align your `TaloxController.setMode()` with the following logic:

| Mode | Purpose | Human Logic? | Perception |
| :--- | :--- | :--- | :--- |
| **`speed`** | Maximum throughput. | **NONE.** Direct Playwright calls. | Fast/Shallow |
| **`stealth`**| Anti-bot/Anti-captcha. | **MAX.** Fitts's Law, curves, jitter. | Balanced |
| **`debug`** | Developer diagnostic. | None. | **MAX.** Full AX-Tree/Network |
| **`balanced`**| General browsing. | Moderate human-like delays. | Full |

---

## 🛡️ Safety & Policies
Talox is governed by the `PolicyEngine`. Testing across different profiles will yield different results:
- **`qa` profile:** Allowed to visit anything (`*`).
- **`ops` profile:** Highly restricted (e.g., Google, GitHub, Localhost).
- **`sandbox` profile:** General purpose.
- **Destructive Actions:** Actions containing strings like "delete" or "remove" are blocked for `ops` profiles by default.

---

## 🔍 Perception & Verification
When verifying page state, prioritize these tools in order of cost:
1. **AX-Tree (Deterministic):** Use `state.nodes` for structural verification (Zero-cost).
2. **SSIM/OCR (VisionGate):** Use `controller.verifyVisual()` for layout/text matching (Zero-cost).
3. **Local VLM (Optional):** Only for complex reasoning (Future/Post-v0).

---

## ⚠️ Known Implementation Nuances (Agent Warnings)
1. **Navigation Context:** Rapid navigation or clicks that trigger page loads can destroy the Execution Context. Always wrap `collect()` or `click()` in try-catch blocks to handle `context destroyed` errors gracefully.
2. **Coordinate Scaling:** Bounding boxes from the AX-Tree might use viewport-relative pixels. When filtering nodes by region (Foveated Perception), ensure you account for device scale factor and offsets.
3. **Importing:** Since this is an ESM project, ensure all imports in your test scripts use `.js` extensions even when referencing `.ts` files, as per TypeScript requirements for `nodenext`.

---

## 📚 Further Reading
For deeper architectural details, see:
- `docs/TALOX-ARCHITECTURE.md`: System-wide component mapping.
- `docs/TALOX-SPEC.md`: Detailed functional requirements.
- `docs/plans/`: Historical context on implementation phases.

