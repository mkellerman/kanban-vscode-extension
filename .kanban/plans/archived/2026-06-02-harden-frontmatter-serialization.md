---
id: "2026-06-02-harden-frontmatter-serialization"
status: "done"
priority: "high"
assignee: null
epic: "Reliability"
dueDate: null
created: "2026-06-02T19:23:22.735Z"
modified: "2026-06-03T05:13:22.388Z"
completedAt: null
labels: ["bug", "parser", "data-integrity"]
order: "a0"
---
# Harden frontmatter serialization

## User story

As a user, I want labels and text fields with quotes, commas, and special characters to round-trip safely so metadata is never corrupted.

## Current state

The canonical implementation lives in `src/shared/featureFrontmatter.ts`. There is no YAML library in the project — `package.json` lists no `yaml`, `js-yaml`, or `gray-matter` dependency. Parsing and serialization are entirely hand-rolled.

### Serializer fragility (`serializeFeature`)

Scalar string fields are wrapped in double quotes with no escaping:

```
`id: "${feature.id}"`
`assignee: ${feature.assignee ? `"${feature.assignee}"` : 'null'}`
`epic: ${feature.epic ? `"${feature.epic}"` : 'null'}`
```

Labels are serialized as:

```
`labels: [${feature.labels.map(l => `"${l}"`).join(', ')}]`
```

A double-quote character inside any value breaks the line. A comma inside a label value breaks array parsing on the next read.

**Concrete failing inputs:**

FieldInput valueSerialized lineWhat breaks`assigneeO'Brienassignee: "O'Brien"`Parses fine (single quote) — safe`assigneeAlice "Al" Smithassignee: "Alice "Al" Smith"getValue` regex strips only leading/trailing quote; inner quotes are left in the returned string — silent data corruption on round-trip`epicPayments: Phase 1epic: "Payments: Phase 1"`Parses fine — colon inside a double-quoted value is safe for the current `getValue` regex`labels["bug, regression"]` (single label containing a comma)`labels: ["bug, regression"]getArrayValue` splits on `,` first, then strips quotes; the label is split into `["bug`, `regression"]` — two wrong tokens`labels['it\'s "quoted"']` (label with double quote)`labels: ["it's "quoted""]`Breaks `getArrayValue`'s bracket content capture; the closing `]` may not be found, returning `[]id` / `order`Any value with a `"`Same unescaped-quote patternSame silent corruption

### Parser fragility (`parseFeatureFile`)

`getValue` uses:

```
new RegExp(`^${key}:\\s*(.*)$`, 'm')
```

and then strips only the outermost quote pair:

```
value.trim().replace(/^["']|["']$/g, '')
```

This means a value like `"Alice "Al" Smith"` returns `Alice "Al" Smith"` (trailing stray quote included), not `Alice "Al" Smith`.

`getArrayValue` uses:

```
new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm')
```

The character class `[^\]]` stops at the first `]`. A label value that contains `]` (e.g. `fix [regression]`) causes the regex to capture a truncated array and drop the remaining labels silently.

Splitting is `match[1].split(',')`, so any comma inside a quoted label value splits that label into two incorrect tokens.

### Fields at risk

Every field that accepts free text is vulnerable: `id`, `assignee`, `epic`, `order` (low risk in practice but unguarded), and every element of `labels`. The `status`, `priority`, `dueDate`, `created`, `modified`, `completedAt` fields are controlled enum/ISO values and are safe in practice, but there is nothing in the serializer preventing a corrupted write if an out-of-range string were passed.

### YAML library availability

No YAML library is currently installed. Adding the `yaml` npm package (Eemeli Aro's `yaml`, \~40 kB minified) is the cleanest fix. Alternatively, all bugs can be fixed with correct escaping/unescaping inline without adding a dependency:

- Serialize: replace `"` with `\"` inside double-quoted scalar values; for labels, either use the same escaping or switch to YAML block-sequence syntax.
- Parse: replace the outer-quote-strip with a proper quoted-string parser that handles `\"` escape sequences.

## Scope

- Fix `serializeFeature`: escape `"` as `\"` inside all double-quoted scalar fields, and inside each label string.
- Fix `getArrayValue`: handle escaped quotes inside label tokens and handle `]` inside quoted label values.
- Fix `getValue`: unescape `\"` after stripping outer quotes.
- Preserve the on-disk format (inline flow array `labels: ["a", "b"]`) so existing files continue to parse.
- Add regression tests for the concrete failing inputs documented above (quotes, commas, brackets, unicode in `assignee`, `epic`, and `labels`).

This story does NOT replace the regex parser with a YAML library — that is the scope of `replace-regex-yaml-parser-2026-06-02`. See Notes.

## Acceptance criteria

- \[ \] `serializeFeature({ assignee: 'Alice "Al" Smith', ... })` produces `assignee: "Alice \"Al\" Smith"` and round-trips back to `Alice "Al" Smith` exactly.
- \[ \] A label value containing a comma (e.g. `"bug, regression"`) serializes as a single quoted element and round-trips as a single label, not two.
- \[ \] A label value containing `]` (e.g. `"fix [regression]"`) serializes and round-trips without truncation.
- \[ \] All existing frontmatter fixtures continue to parse successfully (no regression on "nice" values).
- \[ \] `serializeFeature` followed by `parseFeatureFile` is an identity transform for every field across all adversarial inputs listed in the Current state table.
- \[ \] New test cases in `tests/shared/featureFrontmatter.test.ts` cover: double-quote in `assignee`, double-quote in `epic`, comma-containing label, bracket-containing label, and a unicode label value (e.g. `"支払い"`).

## Affected files

- `src/shared/featureFrontmatter.ts` — fix `getValue`, `getArrayValue`, and `serializeFeature`
- `tests/shared/featureFrontmatter.test.ts` — add adversarial round-trip test cases

## Notes

### Relationship with `replace-regex-yaml-parser-2026-06-02`

These two stories target the same file and the same class of bug. They are intentionally separate:

- **This story** (`harden-frontmatter-serialization`) fixes the bugs in the existing regex implementation with minimal scope — no new dependencies, no structural change. It is safe to ship before `consolidate-frontmatter-serialization-2026-06-02` lands because it only touches `featureFrontmatter.ts`.

- `replace-regex-yaml-parser-2026-06-02` replaces the entire regex approach with a maintained YAML library. It is a superset of this story's changes. If `replace-regex-yaml-parser` ships first, this story becomes obsolete and should be closed as superseded.

**Recommended sequencing:** Ship `consolidate-frontmatter-serialization-2026-06-02` first (currently in-progress, eliminates the duplicated `FeatureHeaderProvider` implementation). Then choose: either harden the regex in-place with this story, or do the full library replacement. Do not do both — the escaping fix here would be immediately overwritten by the library replacement.

If the team commits to the YAML library path, close this story as "Won't Do — superseded by replace-regex-yaml-parser-2026-06-02" once `consolidate` lands.