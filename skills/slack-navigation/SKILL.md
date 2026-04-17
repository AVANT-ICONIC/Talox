---
name: slack-navigation
description: Strategies for navigating Slack's web interface
version: 1.0.0
domain: slack.com
allowedTools:
  - click
  - type
  - navigate
---

# Slack Navigation

## Known Patterns
- Workspace switcher is in the top-left dropdown
- Channel list is in the left sidebar with role='list'
- Message input is a contenteditable div, not a textarea

## Common Failures
- Slack uses virtual scrolling — elements off-screen don't exist in DOM
- Emoji picker opens in a portal outside the main DOM tree

## Recovery Strategies
- If channel list is empty, scroll the sidebar to trigger lazy loading
- Use text content matching for message search, not CSS selectors
