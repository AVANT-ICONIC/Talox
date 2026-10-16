---
name: talox
description: Use Talox for browser automation, scraping, screenshots, form filling, persistent logins, structured state, replay, MCP, plugins and adapters. Load when browsing, scraping, screenshotting, filling forms or automating web UI.
---

# Talox Skill

Decision table:
- Browse / scrape → `TaloxController` + `navigate`
- Screenshot / PDF → `talox screenshot`
- Form fill → `getPracticalTools(talox).fillForm`
- Login → launch with profile id/class
- Structured state → `getPageState`
- Replay → `talox replay`
- MCP → `talox mcp`
- Multi-agent → `talox run --agents N`

Top calls:
1. `talox observe --profileId observe --profileClass ops --browser chromium`
2. `talox screenshot <url> --output out.png`
3. `talox init <dir>`
4. `talox run "<goal>" --agents 1`
5. `talox mcp`
6. `talox replay <session>`
7. API: `new TaloxController(cwd, settings)`
8. API: `await talox.launch(profileId, profileClass, browser)`
9. API: `await talox.navigate(url)`
10. API: `getPracticalTools(talox)`

See `docs/agent-guide/README.md` and `docs/capabilities.json` for full signatures and use-when.
