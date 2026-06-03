You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and confirm:
- `completedAt` is set in the frontmatter
- The story file is in `.kanban/features/done/` (or confirm it was archived)
- Any follow-up stories or retrospective notes have been captured
- No loose ends remain in `blockedBy` that dependent stories are waiting on

If present, reference `.kanban/instructions.md` for board conventions.
