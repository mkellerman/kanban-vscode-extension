---
id: "2026-06-03-lane-scrum-master-actions"
status: "review"
priority: "medium"
assignee: null
epic: "Workflow automation"
dueDate: null
created: "2026-06-03T00:00:00.000Z"
modified: "2026-06-03T18:12:00.744Z"
completedAt: null
labels: ["ux", "workflow", "automation"]
order: "a5"
worktree: "/Users/me/Documents/GitHub/kanban-vscode-extension/.claude/worktrees/story+2026-06-03-lane-scrum-master-actions"
---

# Add lane-level scrum master actions to the Kanban board

As a maintainer of the board, I want each lane's three-dots menu to launch a lane-specific agent or instruction set, so the board can stay organized, prioritized, and free of unresolved blockers without manual triage for every lane.

## Context

The board already has lane menus for column actions like collapse, add, move all cards, and archive. This story extends those menus with a lane-specific "scrum master" action that helps keep the board healthy.

The lane action should treat `.kanban/features/<id>.md` as the source of truth and use `blockedBy` to surface blockers that need a decision. It should not treat the superpowers plan/spec artifacts as the board record; those are supporting artifacts used to update the story files.

## Acceptance criteria

- [ ] Each default lane (`backlog`, `todo`, `in-progress`, `review`, `done`) has a "Scrum Master" item in its three-dots menu, hidden when `showBuildWithAI` is false.
- [ ] Clicking "Scrum Master" launches an agent terminal (same mechanism as per-card "Build with AI") with a lane-specific prompt.
- [ ] The prompt operates on the currently visible (filtered) stories — not all stories in the lane — using the IDs passed in the `laneAction` webview message.
- [ ] The `backlog` lane prompt surfaces vague acceptance criteria, missing `blockedBy` entries, duplicate stories, and stories not ready to plan.
- [ ] The `todo` lane prompt checks readiness: unresolved blockers, ambiguous scope, missing decisions.
- [ ] The `in-progress` lane prompt surfaces scope drift, stale `worktree` context, and newly introduced blockers.
- [ ] The `review` lane prompt surfaces missing evidence, unresolved comments, failing checks, and go/no-go decisions.
- [ ] The `done` lane prompt confirms `completedAt` is set, archive placement, and follow-up stories.
- [ ] The menu item is disabled (not hidden) when the lane has no visible stories.
- [ ] The existing column menu items (collapse, add, move all, archive all) are unchanged.
- [ ] A local workspace override at `.kanban/instructions/{columnId}-lane.md` takes precedence over the bundled prompt (same pattern as per-card prompts).
- [ ] `buildLanePrompt` supports `{{columnName}}`, `{{count}}`, and `{{featurePaths}}` template variables.
- [ ] Workspace trust check: shows warning and does not launch if the workspace is not trusted.

## Context & constraints

- Design spec: `docs/superpowers/specs/2026-06-03-lane-scrum-master-actions-design.md`
- Launch mechanism: agent terminal, no new UI panels (consistent with `startWithAI`)
- Scope: filtered/visible stories — webview sends `featureIds[]`; extension host resolves to `Feature[]`
- Template resolution: `.kanban/instructions/{columnId}-lane.md` → `prompts/{columnId}-lane.md` → generic fallback
- Gated by `showBuildWithAI` setting (respects `chat.disableAIFeatures`)
- Collapsed columns do not receive the `onLaneAction` prop
- `agent` read from `kanban-markdown.aiAgent` setting (same as `startWithAI`)
- `permissionMode` defaults to `'default'` — no UI picker in the menu

## Open questions

_(all resolved — see design spec)_
