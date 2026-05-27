# MCP Story Server Design

## Summary

Build a framework-neutral MCP server inside the VS Code extension so agent clients can discover, inspect, update, and break down stories without knowing which spec-driven framework produced them.

The server must reuse the same framework adapter layer that powers the Kanban board. It must not introduce a second storage model. The MCP layer is orchestration only:

- discover stories through active adapters
- resolve story identity through namespaced framework IDs
- read and write through the adapter that owns the story
- validate request and response payloads before returning anything

This design is aligned with the current multi-framework plan. The server is not native-only; it must work across the current framework set and any future adapter added to the registry.

## Goals

- Let MCP clients list stories from the current workspace.
- Let MCP clients open one story in detail.
- Let MCP clients update story fields safely.
- Let MCP clients break a story into manageable tasks.
- Make the server framework-neutral by routing through adapters.
- Reuse existing framework detection, parsing, and serialization logic.
- Return only validated JSON on success.

## Non-Goals

- Do not invent a new persistence layer.
- Do not duplicate framework parsing logic inside the MCP layer.
- Do not expose generic file-system tooling.
- Do not make the MCP server responsible for UI concerns.
- Do not change the Kanban board data model just for MCP.

## Scope Boundary

This spec covers:

- the MCP server contract
- the shared response envelope
- the request schemas
- framework-aware story identity
- extension-hosted integration

This spec does not cover:

- the full implementation of every framework adapter
- the general Kanban board refactor already planned elsewhere
- any external client configuration beyond the server contract

## Architecture

The VS Code extension hosts the MCP server.

The MCP server depends on the existing framework layer:

- `src/shared/frameworks/types.ts` for framework IDs and namespaced feature IDs
- the framework registry / adapter discovery layer
- the per-framework parse and serialize functions

The extension remains the source of truth for:

- locating story files
- detecting active frameworks
- reading and writing framework-specific content
- preserving framework-specific metadata during saves

The MCP server remains the source of truth for:

- request validation
- response shaping
- task breakdown generation
- story selection and update orchestration

### High-Level Flow

1. Client calls one of the MCP tools.
2. Server validates the request schema.
3. Server resolves the active adapters from the extension framework registry.
4. Server reads or writes through the owning adapter.
5. Server validates the response payload.
6. Server returns validated JSON only.

## Story Identity

Stories must be addressed with framework-aware identity.

Use a namespaced ID shape:

- `frameworkId:localId`

Examples:

- `native:2026-05-27-01`
- `superpowers:2026-05-27-plan-name`
- `spec-kit:feature-slug`
- `bmad:story-slug`

This avoids collisions when multiple frameworks are active in the same workspace.

If a tool receives only a file path, the server resolves the owning adapter first and then derives the namespaced ID internally.

## Tools

### `get_story`

Purpose:

- list stories for human selection
- load one story into context

Input:

- no params: return the default `todo` selection queue
- `--all`: return all stories
- optional filters: `--status`, `--label`, `--assignee`
- optional `--id`: return one story in detail mode

Behavior:

- no params means selection mode, not detail mode
- `--id` and `--all` are mutually exclusive
- `--status`, `--label`, and `--assignee` filter the selected story set
- default ordering should favor actionable work first
- if no `todo` stories exist, return the next eligible queue and say so in metadata

Output:

- selection mode returns `stories[]`
- detail mode returns `story`
- metadata includes `mode`
- selection mode includes a `selectionInstruction` telling the LLM to present a numbered menu

### `update_story`

Purpose:

- change story fields without rewriting unrelated content

Input:

- `--id` required
- optional patch fields: `--status`, `--title`, `--description`, `--priority`, `--labels`, `--assignee`, `--dueDate`

Behavior:

- only update fields explicitly provided
- reject unknown fields
- resolve the owning adapter from the story ID
- preserve framework-specific content when writing
- return the updated story in detail mode

### `breakdown_story`

Purpose:

- turn a story into a validated task breakdown

Input:

- `--id` or `--path`
- one is required
- both together are not allowed

Behavior:

- resolve the story source via namespaced ID or file path
- generate task breakdown JSON
- validate the JSON before returning it
- return the breakdown envelope with `tasks[]`

## Response Envelope

All successful tool responses must use the same metadata envelope.

Recommended shape:

```json
{
  "metadata": {
    "mcpVersion": "1.0.0",
    "schemaVersion": "1.0.0",
    "createdAt": "2026-05-27T18:20:00.000Z",
    "executionTimeMs": 842,
    "agentUsed": "claude-4.1",
    "sourceCount": 1,
    "sources": [
      {
        "path": ".devtool/features/2026-05-27-01-shared-types-and-framework-registry.md"
      }
    ],
    "validated": true,
    "validation": {
      "schema": "pass",
      "dependencyCheck": "pass"
    },
    "mode": "selection",
    "selectionInstruction": "Present the returned stories as a numbered menu and ask the user which one to open."
  },
  "stories": []
}
```

Required metadata fields:

- `mcpVersion`
- `schemaVersion`
- `createdAt`
- `executionTimeMs`
- `agentUsed`
- `sourceCount`
- `sources`
- `validated`
- `validation`
- `mode`

Optional metadata fields:

- `selectionInstruction`
- `validation.message`

### Response Payload Variants

`get_story` selection mode:

- `stories[]`

`get_story` detail mode:

- `story`

`update_story`:

- `story`

`breakdown_story`:

- `tasks[]`

## Validation Rules

Validation must happen before any successful JSON response is returned.

Request validation:

- parse the request
- reject unknown fields
- enforce mutually exclusive flags
- enforce required identifiers
- validate status and label values against the canonical vocabulary

Response validation:

- validate the envelope against the response schema
- validate the payload shape for the selected mode
- validate task IDs are sequential
- validate dependency targets exist
- validate dependencies only point backward
- reject duplicate dependencies
- reject self-dependencies
- reject cycles

If validation fails, the server should return an MCP error instead of emitting invalid JSON.

## Error Handling

The server should not try to force invalid output into the response schema.

Use MCP errors for:

- malformed input
- unknown story ID
- missing source file
- adapter detection failure
- adapter parse failure
- adapter write failure
- schema validation failure
- dependency validation failure

Error messages should be short and actionable.

The server should include enough context for the caller to recover, but should not dump raw file contents into errors.

## Integration With the Extension

The extension hosts the MCP server so it can reuse:

- framework detection
- file discovery
- parse and serialize functions
- current feature ID conventions

The MCP server should not reimplement the registry. It should call the same adapter registry used by the board and any other extension surfaces.

That keeps one source of truth for:

- which frameworks are active
- how a story maps to a file
- how a file is written back safely

## Testing

### Contract Tests

- request schema validation for each tool
- response schema validation for each output mode
- mutually exclusive flag handling
- required field enforcement

### Adapter Routing Tests

- merged story listing across multiple active frameworks
- namespaced ID resolution to the correct adapter
- update routing to the story owner
- file-path resolution to the correct adapter

### Breakdown Tests

- task IDs are sequential
- dependencies only point backward
- invalid dependency graphs are rejected
- output matches the breakdown schema before return

### Integration Tests

- host the server inside the extension
- call `get_story` with no params and verify the default `todo` selection list
- call `get_story --all` and verify the merged list
- call `update_story` and verify the owning file changes only in the expected adapter
- call `breakdown_story` and verify validated JSON output

## Decisions Locked In

- The MCP server is hosted by the VS Code extension.
- The server is framework-neutral and adapter-backed.
- Stories use namespaced IDs.
- Successful responses are validated before return.
- The server returns JSON only on success.
- Invalid cases are surfaced as MCP errors, not malformed JSON.

