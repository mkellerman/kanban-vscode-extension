---
id: "optimize-webview-bundle-size"
status: "done"
priority: "medium"
assignee: null
epic: "Performance"
dueDate: null
created: "2026-06-02T19:23:22.735Z"
modified: "2026-06-03T15:59:22.000Z"
completedAt: "2026-06-03T15:59:22.000Z"
labels: ["performance", "bundle-size", "build"]
order: "a1"
---
# Optimize webview bundle size

## User story
As a maintainer, I want the webview bundle to stay within a target budget so load performance and release quality remain predictable.

## Scope
- Profile bundle composition and identify largest contributors.
- Introduce code splitting or lazy loading for heavy or infrequently used UI paths.
- Add a documented bundle budget and CI warning/enforcement strategy.

## Acceptance criteria
- Main webview entry chunk is reduced below the agreed threshold.
- No functional regressions in editor or board flows.
- Build output and docs reflect the budget and enforcement approach.