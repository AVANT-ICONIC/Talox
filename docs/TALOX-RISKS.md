# TALOX-RISKS.md - Risk Constraints & Policies

## 1. Security & Isolation
- **Profile Leakage:** Each profile (`ops`, `qa`, `sandbox`) uses a strictly isolated `user-data-dir`. Never allow cross-profile session leakage.
- **Sensitive Data:** Avoid logging clear-text passwords or cookies. Only log essential debugging data.
- **Remote Access:** The controller API must be local-only by default or authenticated.

## 2. Policy Enforcement
- **Destructive Actions:** Use the PolicyEngine to block destructive actions in `ops` profiles unless explicitly authorized.
- **Domain Allowlists:** Profiles should optionally restrict navigation to specific domains.

## 3. Automation Reliability
- **False Positives:** The Rules Engine may flag false positives (e.g., intentional overlapping elements). Vision Gate and human-in-the-loop are used to mitigate this.
- **Selector Drift:** Self-healing selectors may target wrong elements over time. Validate healed selectors periodically.

## 4. Resource Constraints
- **Performance:** Multiple Chromium instances are CPU/RAM intensive. Memory-efficient context management is a priority.
- **Network Bandwidth:** Large screenshots and traces should be minimized to reduce agent processing overhead.

## 5. Interaction Fidelity
- **Not a guarantee:** Adaptive mode significantly reduces interaction-related flakiness but cannot guarantee perfect reliability across all real-world UIs.
- **Behavioral Uniqueness:** Highly unique behavioral DNA patterns may still produce intermittent timing issues on some interfaces.
- **Adaptive Decay:** Precision decay over long sessions may cause intermittent interaction failures.

## 6. Network Mocking Risks
- **Stale Data:** Replayed responses may become outdated; implement TTL for cached responses.
- **Security Bypass:** Mocking can bypass authentication; never use in production security tests.

## 7. GhostVisualizer Risks
- **Performance Overhead:** Adds significant CPU/memory cost; disable in production runs.
- **Sensitive Data Exposure:** Visualizer output may capture passwords or PII in screenshots.

## 8. Policy-as-Code Risks
- **YAML Parsing:** Malformed YAML could cause runtime failures; validate before loading.
- **Privilege Escalation:** Ensure policy files are from trusted sources only.

## 9. Multi-Page Session Risks
- **State Consistency:** Switching pages may leave stale state; always verify context after switch.
- **Resource Exhaustion:** Multiple open pages increase memory usage significantly.
