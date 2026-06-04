---
id: "add-superpowers-specplan-files-2026-06-03"
status: "backlog"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-06-04T06:15:35.531Z"
modified: "2026-06-04T06:15:35.531Z"
completedAt: null
labels: []
order: "a0"
worktree: null
---
# Add Superpowers spec plan files

Would like us to re-evaluate how we load files from the workspace.

wether it's .kanban/features/done, or docs/superpowers/, i would like a groomning script that will add the frontmatter to all the files.

i use a hook in another repo: "/Users/me/Documents/GitHub/roleplaygames-studio/.claude/hooks/validate_superpowers_frontmatter.py"

but i want us to be able to point to a folder, and it will analyse all the files and put proper frontmatter to them, so the board can show them properly.