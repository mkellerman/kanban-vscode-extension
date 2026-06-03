---
board: kanban
feature_dir: .kanban/features
done_dir: .kanban/features/done
spec_dir: docs/superpowers/specs
plan_dir: docs/superpowers/plans
status_flow:
  - backlog
  - todo
  - in-progress
  - review
  - done
worktree_policy: only-in-progress-creates-worktree
frontmatter_fields:
  - id
  - status
  - priority
  - assignee
  - epic
  - dueDate
  - created
  - modified
  - completedAt
  - labels
  - order
  - worktree
  - blockedBy
---

# Shared Kanban Instructions

## Board Model

- The feature file in `.kanban/features/<id>.md` is the source of truth for a story.
- Superpowers specs and plans live under `docs/superpowers/specs/` and `docs/superpowers/plans/` as supporting artifacts.
- Those artifacts are used to update the story file in `.kanban/features/`.
- Finished stories move into `.kanban/features/done/`.

## Lifecycle

- `backlog`: groom a raw idea into a testable feature file.
- `todo`: write the implementation plan and promote the feature to `in-progress`.
- `in-progress`: implement with TDD; this is the only stage that creates a worktree when one is missing.
- `review`: verify the work, self-review it, and request code review.
- `done`: seal the completed feature and move it into the done archive.

## Worktree Rules

- If feature frontmatter already contains `worktree`, reuse it.
- Only `superpowers-in-progress` creates a new worktree when `worktree` is missing.

## Frontmatter Rules

- Preserve unrelated frontmatter fields unless a skill explicitly says otherwise.
- Update `modified` whenever the story state changes.
- Add `completedAt` when the story is finalized.
- Keep the feature file and plan doc in sync when both exist.
- `blockedBy` is a list of feature filenames only, not paths. Use it to point at blocking stories the LLM should search for anywhere in the repo.

## Dependency Rule

- Record blockers in `blockedBy` as soon as they are known.
- Evaluate dependencies during `backlog` grooming and again before `todo`/`in-progress` work starts.
- A story should not move into `todo` or `in-progress` until blocking dependencies are resolved or explicitly accepted as non-blocking.

## File Location Rules

- Active stories live in `.kanban/features/`.
- Completed stories move to `.kanban/features/done/`.
- Plans live in `docs/superpowers/plans/`.
