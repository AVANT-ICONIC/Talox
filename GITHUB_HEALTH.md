# GitHub Repo Health — Improvement Plan

> Current: B overall. Target: A overall.

## Immediate (today — 15 min)

|#|Action|Impact|Effort|
|---|---|---|---|
|1|Verify license detected by GitHub — Settings → General → License|F→A|1 click|
|2|Add README table of contents (TOC)|C→B|5 min|
|3|Add `version` badge to show latest release dynamically|cosmetic|2 min|
|4|Fix `CODE_OF_CONDUCT.md` — verify it's in `.github/`|cosmetic|1 min|

## Short-term (this week — 30 min)

|#|Action|Impact|Effort|
|---|---|---|---|
|5|Set up issue templates with labels (bug, feature, question)|C→B|10 min|
|6|Add `stale` bot config — auto-close issues after 90 days|C→A|5 min|
|7|Create `good-first-issue` label + label 3 starter tasks|D→C|10 min|
|8|Add CODEOWNERS file|D→C|2 min|

## Process change (next release — v7.7.0+)

|#|Action|Impact|Effort|
|---|---|---|---|
|9|Use feature branches + PRs for v7.7.0+ instead of direct-to-main|D→C|behavioral|
|10|Self-review PRs with checklist before merge|F→C|behavioral|
|11|Squash-merge PRs (cleaner history, better merge stats)|F→B|setting|

## Community (ongoing)

|#|Action|Impact|Effort|
|---|---|---|---|
|12|Respond to issues within 48h (set up notification)|C→B|behavioral|
|13|Promote project on relevant channels (HN, Reddit, Discord)|D→B|ongoing|
|14|Invite contributors — label `good-first-issue` visibly|D→C|ongoing|

## What won't change (solo project realities)

- **Bus factor 1** — normal for solo dev. Documented in AGENTS.md.
- **Contributor count 1** — will improve with promotion.
- **PR review depth** — requires second reviewer. Not feasible solo.
- **Issue response time** — will improve with templates + automation.

## Target grades after fixes

|Category|Current|Target|
|---|---|---|
|Activity & Vitality|A|A|
|Community & Signals|B|A (license + TOC + readme signals)|
|Issue Health|C|B (templates + stale bot)|
|PR Health|D|C (feature branches + squash merge)|
|Contributors|C|C (good-first-issue, promotion)|
|**Overall**|**B**|**A**|
