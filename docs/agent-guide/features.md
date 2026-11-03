# Features agents tend to miss

Use the [manifest](../capabilities.json) for exact signatures and source locations. This page is a discovery map, not a promise that every feature has been exercised offline. Tested recipes are enumerated in [VERIFIED.md](VERIFIED.md).

| Need you might overlook | Existing surface | Boundary / useful surprise |
|---|---|---|
| Spend fewer context tokens | `getState('agent')`, `getIntentState()`, `describePage()` | API defaults full; MCP defaults agent |
| Compare observations | `TALOX_STATE_CONTRACT_VERSION`, `diffPageState` | Structured changes, not screenshot-only guessing |
| Cheap observation before OCR/vision | `PerceptionStack`, `PERCEPTION_PRESETS` | Choose perception depth deliberately |
| See what was actually clicked | `annotatedScreenshot`, attention-frame helpers | Numbered labels are observations, not durable CSS selectors |
| Make fixture interaction deterministic | `setSafeMode(true)` | Bypasses human simulation; type still appends |
| Detect CAPTCHA/login/consent obstacles | `getChallengeState`, `resolveChallenge`, `ChallengeDetector` | `requiresHuman` is an explicit outcome, not success |
| Hand control to the user | `requestHumanTakeover`, takeover history/events | Headed workflow; configure timeout; unsuitable unattended |
| Reuse a real identity | `ProfileVault`, profile-specific fingerprints | Separate persistent ownership from settings presets |
| Keep page state over a browser restart | `captureSessionSnapshot`, `restoreSessionSnapshot`, headed-mode transition | Session snapshot contains more than just URL |
| Learn strategies for a hostname | `AdaptationEngine`, `DomainMemory`, `STRATEGIES` | Per-domain strategy history; not an authorization mechanism |
| Recover selectors and interactions | `InteractionReliability` and self-healing controller actions | Inspect failures after recovery instead of assuming success |
| Handle interstitial warmup | `SiteWarmupRegistry`, `BUILT_IN_WARMUPS` | Registry strategies are site-dependent and can become stale |
| Handle browser dialogs | `AutoDialogHandler`, `autoDialogHandling` setting | Know which dialogs may be auto-handled before a risky action |
| Record a forensic session | Launch observe options, `ObserveSession`, `SessionReporter` | Reports flush on stop; replay reads persisted reports |
| Capture network traffic | `HarRecorder`, controller `harRecording` config | Stop flushes; recording content can include sensitive data |
| Attach an inspect endpoint | `InspectServer`, controller `inspectServer` config | A live debugging surface, not an exported recording |
| Record video | `VideoRecorder`, controller `videoRecording`, launch `recordVideo` | Explicit recording paths; stop finalizes evidence |
| Carry origin-scoped headers | `OriginHeaders`, controller `originHeaders` | Scoped origin matching, not arbitrary cross-origin credential reuse |
| Reach external frames safely | `CrossOriginManager`, exact `trustedDomains` | Reachability and trust are separate; no wildcard trust |
| Export visible text to a file | `getPracticalTools(t).exportMarkdownSnapshot(dest)` | Normalized text, not a semantic HTML-to-Markdown renderer |
| Use a low-level page operation | `getPlaywrightPage()` | Same browser/profile, but direct operations bypass controller action evidence |
| Reuse common settings | `PRESETS.ops`, `.qa`, `.observe`, `.research`, `['login-heavy']` | Exactly five; preset names are not all profile classes |
| Run browser tasks concurrently | `AgentCoordinator`, deterministic shared-state merge | Multiple profiles, explicit result conflicts |
| Replan from all agents' observations | `PlanDelegateObserveLoop` | Wave history and typed stop reasons; model required by default |
| Stop a stuck autonomous loop | `AutonomousLoop` convergence/recovery | Bounded iteration budget matters even with self-learning |
| Load domain knowledge | `SkillLoader`, `SkillWriter`, `skill create` | Manifest/reference containment and registry reconciliation exist |
| Research strategies empirically | `AutoResearchLoop`, `ExperimentRunner`, `RegressionHarness`, `ResearchJournal`, `ResearchReporter` | Controlled experiments, promotion and rollback, not one blind rewrite |
| Transfer strategy hypotheses | `CrossDomainTransfer`, `StrategyComposer`, `HypothesisGenerator` | Source-backed research features, not general scraping commands |
| Evolve prompts / skill versions | `PromptEvolver`, `SkillVersioning`, `SkillEvaluator`, `AdaptiveExperimentPriority` | Evaluate before promotion |
| Measure human-simulation quality | `QualityTracker`, `scoreInteraction`, `computeQuality` | Explicit metrics rather than aesthetic claims |
| Expose model function schemas | `getTaloxTools`, `getToolNames` | Different from the seven MCP registrations |
| Keep browser access in one local process | `TaloxDaemon` / CLI `daemon` | IPC lifecycle; separate from MCP transport |
| Load community rules/detectors | `talox/plugins` registry | Versioned names, duplicate validation, isolated detector errors |
| Get platform-specific hints | `talox/adapters` registry and five built-ins | Pure matching/guidance, no browser actions |
| Use an on-device model server | `talox/local-vision` factory | Rejects remote endpoints by default; no cloud call needed |
| Connect your own vision or CAPTCHA solver | `VisualReasoner`, `useVision`, `useSolver`, solver registry | Model/solver behavior and task authorization remain separate |
| Control content/network defenses | `contentSafety`, `networkGuard`, `trustedDomains` settings | Read the actual defaults and schemas before changing scope |
| Use a Linux virtual display | BrowserManager `virtualDisplay` / Xvfb lifecycle | Linux only; manager config propagation caveat applies |
| Enforce navigation/action rules | `PolicyEngine`, YAML policies, amount context | `ops` is intentionally restrictive; inspect a refusal |

The exhaustive names, types, defaults, public members, environment reads and raw JSON state schema are in the generated inventory. No module name in this page implies a CLI command exists with that spelling.
