# HARBOR-BOUNDARY.md — Talox Core vs Harbor

This document defines the boundary between **Talox Core** (this repository, public, AGPL-3.0-only) and **Harbor** (commercial control plane, separate product, not part of this repository).

---

## Talox Core (this repo — public)

Talox Core is the browser runtime layer. It handles everything needed to run a single stateful browser session for an AI agent.

**In scope for Talox Core:**

- Browser lifecycle management (launch, navigate, close)
- Persistent browser profiles and session continuity
- AX-Tree, DOM, console, and network state collection
- Structured `TaloxPageState` JSON contract
- Layout bug detection (Rules Engine)
- Visual regression and OCR (Vision Gate)
- Biomechanical Ghost Engine
- Self-healing selectors (SelfHealingSelector)
- Semantic page understanding (SemanticMapper)
- Session replay and path visualization (GhostVisualizer)
- Network record/replay/mock (NetworkMocker)
- AX-Tree structural diffing (AXTreeDiffer)
- YAML-based action policies (PolicyEngine)
- LLM function-calling schema (TaloxTools)
- Local/single-runtime operation

**Not in scope for Talox Core:**

- Multi-agent orchestration
- Approval workflows
- Budget and cost controls
- Team and organization governance
- Secrets management
- Managed cloud / hosted operations
- Enterprise audit logging
- Cross-agent session sharing at scale

---

## Harbor (commercial — separate product)

Harbor is the commercial control plane built on top of Talox Core. It is a separate product maintained by AVANT ICONIC and is not part of this repository.

**Harbor handles:**

- Multi-agent orchestration and task routing
- Human-in-the-loop approval workflows
- Budget controls and usage metering
- Team and organization governance
- Secrets and credential management
- Managed cloud deployment and hosted operations
- Enterprise audit trails and compliance tooling

---

## Why this boundary matters

Talox Core is intentionally scoped to the local browser runtime. This keeps it:

- **Auditable** — the public code does exactly what it says
- **Composable** — any agent framework can integrate Talox Core directly
- **Commercially safe** — Harbor's moat stays in Harbor

If you are building on Talox Core and need multi-agent orchestration, approvals, or managed hosting, contact [office@avant-iconic.com](mailto:office@avant-iconic.com) about Harbor.

---

## Commercial licensing

Talox Core is AGPL-3.0-only. If you need to embed Talox Core in a proprietary product without open-sourcing your modifications, a commercial license is available.

Contact: [office@avant-iconic.com](mailto:office@avant-iconic.com)
