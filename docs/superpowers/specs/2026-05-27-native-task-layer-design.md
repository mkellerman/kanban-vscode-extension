# Native Task Layer Design

## Summary

Introduce a native task layer on top of the existing feature board without changing the existing feature markdown format.

The board remains feature-centered, but native tasks become first-class markdown records that can be grouped under a parent feature and linked through dependencies. This design is intentionally additive:

- existing feature files keep their current frontmatter unchanged
- files without a `kind` field continue to mean `feature`
- tasks live in a separate native task folder
- task IDs are derived from the parent feature ID plus a zero-padded sequence suffix
- dependencies may point to either a whole feature or an individual task

This supports the current framework split cleanly:

- `superpowers:plans` can expose `tasks`
- `bmad:epics` can expose `stories`
- `speckit:plans` can expose `tasks`

The native framework becomes the first framework to understand this new task layer.
The framework adapter layer also becomes responsible for the human-facing nouns used across the UI, so the site can say Feature/Task, Epic/Story, or Plan/Task depending on the active framework.

## Goals

- Keep existing native feature files stable and backward compatible.
- Add first-class native task records without altering feature markdown.
- Represent tasks on the same board, grouped under their parent feature.
- Allow dependencies to target either a feature or a task.
- Preserve manual status control for parent features.
- Keep task filenames sortable and predictable.
- Reuse the existing markdown/frontmatter model as much as possible.
- Let the active framework define the displayed nouns for parents and children.

## Non-Goals

- Do not migrate existing feature files to a new schema.
- Do not require a `kind` field for existing feature files.
- Do not roll up parent feature status from task completion.
- Do not add dependency-aware auto-scheduling.
- Do not introduce a separate task-only board.
- Do not change the non-native frameworks in this phase.

## Scope Boundary

This spec covers:

- native task file shape and storage
- native parsing and serialization rules
- board grouping behavior for parent features and tasks
- dependency ID resolution rules
- validation and error handling for missing or invalid links
- test coverage for parsing, grouping, and round-tripping

This spec does not cover:

- cross-framework task migration
- UI polish beyond the grouping and dependency indicators needed to make the model usable
- automatic parent status rollups
- recursive task nesting
- framework-specific file layout and filename generation rules

## Architecture

The current native framework treats every item as a feature file with YAML frontmatter.

This design splits the native layer into two record kinds:

- `feature` records, which preserve the existing feature markdown format
- `task` records, which are new markdown files under a native task directory

The shared board model should load both kinds into a common in-memory item graph:

- parent feature
- child tasks belonging to that feature
- dependency links between items

The board still renders columns by `status`, but it also needs parent/child grouping metadata so task cards can appear visually under their parent feature.
The side panel should use the active framework nouns, but keep a simple single-item inspector rather than a tabbed or split-state view.

### High-Level Flow

1. The native scanner loads feature files from the existing feature directories.
2. The native scanner loads task files from the new task directory.
3. The parser infers record kind from file location and frontmatter:
   - if `kind` is absent, treat the file as a `feature`
   - if a file is in the task directory, treat it as a `task`
4. The index resolves parent-child relationships from `parentId`.
5. The index resolves dependencies from `dependsOn`.
6. The board renders a parent feature card followed by any grouped task cards.

## Data Model

### Feature Records

Feature records remain unchanged.

Required existing fields remain the same:

- `id`
- `status`
- `priority`
- `assignee`
- `epic`
- `dueDate`
- `created`
- `modified`
- `completedAt`
- `labels`
- `order`

Feature files do not need a `kind` field. If the field is missing, the record is a feature.

### Task Records

Task records are new native markdown files stored under:

- `.devtool/features/tasks/`

Task IDs are derived from the parent feature ID and a zero-padded suffix:

- parent feature ID: `build-auth`
- task ID: `build-auth.000`
- task filename: `build-auth.000.md`

The sequence suffix must be zero-padded so lexical sorting matches numeric sorting.
The task `order` field should use the same zero-padded sequence so board sorting matches filename sorting.
This filename and order scheme is native-specific; other frameworks may supply different schema rules through their own generators.

Task frontmatter extends the existing native fields with:

- `parentId`: the parent feature ID
- `dependsOn`: an array of item IDs

The task record keeps the same general fields as features:

- `id`
- `status`
- `priority`
- `assignee`
- `dueDate`
- `created`
- `modified`
- `completedAt`
- `labels`
- `order`

### Dependency IDs

`dependsOn` may reference either:

- a whole feature, identified by an ID with no task suffix
- a task, identified by an ID with a `.NNN` suffix

This keeps dependency resolution simple and explicit:

- `build-auth` means the whole feature
- `build-auth.000` means one task on that feature

## File Layout

The native file layout becomes:

- `.devtool/features/*.md` for feature cards
- `.devtool/features/done/*.md` for completed feature cards
- `.devtool/features/tasks/*.md` for task cards

Tasks are not stored inside feature files.
Tasks are not nested in the same directory tree as feature statuses.
Tasks remain a separate layer so feature files stay untouched.

## Board Behavior

The board remains centered on feature cards, but tasks are displayed as subordinate cards under their parent feature.

### Rendering Rules

- A parent feature appears as the primary card.
- Its tasks appear grouped directly beneath it.
- Task cards keep their own status, priority, labels, and dependencies.
- Task cards remain draggable across columns.
- The parent feature remains independently draggable and editable.

### Visual Grouping

The group boundary should be visible enough that users can see:

- which tasks belong to which feature
- which cards are children versus parents
- which dependencies are unresolved or blocked

This can be implemented as indentation, nested card styling, or a grouped stack under the parent card, as long as the parent remains the top-level anchor.

### Parent Status

Parent feature status remains manual.

Do not infer parent status from task state.
Do not auto-close a parent feature when all child tasks are done.
Do not reopen a parent if a task moves backward.

### Task Status

Tasks use the same status columns as features.

This keeps drag-and-drop behavior consistent across the board and avoids special-case column logic.
Within a parent group, tasks should sort by their task sequence/order rather than by feature order rules.

## Parsing and Serialization

### Feature Parsing

Feature parsing remains backward compatible:

- no `kind` field required
- existing frontmatter continues to parse the same way
- existing feature serialization should not be rewritten just to support tasks

### Task Parsing

Task parsing should:

- infer `parentId` from frontmatter
- infer the task ID from the filename when needed
- validate that the filename matches the task ID convention
- tolerate missing dependency targets at parse time, but surface them as unresolved during indexing

### Task Serialization

Task serialization should:

- preserve the existing feature file serializer for features
- serialize task files with the same general frontmatter style
- generate task filenames from the parent ID and the next available sequence number

Feature serialization must remain untouched for existing feature files.
Framework adapters only supply the nouns used in labels and prompts. They do not own the file-layout schema in this spec; file generation remains owned by the framework-specific generators.

## Validation and Error Handling

Validation should be strict for structural errors and tolerant for missing references.

### Structural Validation

Reject or surface an error for:

- task files without `parentId`
- task filenames that do not match the `<parentId>.<NNN>.md` pattern
- task IDs that do not match the filename stem
- self-dependencies
- malformed `dependsOn` arrays

### Reference Validation

Warn, but do not block, when:

- a `parentId` does not resolve to an existing feature
- a dependency target does not resolve to an existing feature or task

Missing references should remain visible in the board so users can fix them.

## Editing Flow

### Creating a Task

When the user creates a task from a parent feature:

1. derive the next available sequence number for that parent
2. create a new file under `.devtool/features/tasks/`
3. populate `id`, `parentId`, and the usual frontmatter defaults
4. open the task in the editor with the parent relationship already set

### Editing Dependencies

Dependencies should be editable as IDs in frontmatter.

The UI can later add a picker, but the underlying contract is plain IDs so it stays framework-neutral and diff-friendly.

## Testing Strategy

Add tests for:

- feature parsing without `kind`
- task parsing and serialization
- task filename generation from parent IDs
- grouping parent features with child tasks
- dependency resolution for feature targets and task targets
- unresolved parent or dependency warnings
- backward compatibility of existing feature files

The most important regression check is that a plain existing feature file still round-trips exactly as before.

## Open Questions Resolved

- `kind` is optional and defaults to `feature`.
- existing feature markdown is not altered to support tasks.
- tasks live in `.devtool/features/tasks/`.
- task IDs are derived from the parent ID plus a zero-padded suffix.
- dependencies may target either a whole feature or a task.
- parent feature status remains manual.
- framework adapters supply UI nouns only; file generation rules remain framework-specific.
