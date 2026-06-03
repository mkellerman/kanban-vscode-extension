---
id: "replace-regex-yaml-parser-2026-06-02"
status: "done"
priority: "high"
assignee: null
epic: "Architecture remediation"
dueDate: null
created: "2026-06-02T18:00:00.000Z"
modified: "2026-06-03T05:35:50.228Z"
completedAt: "2026-06-03T05:35:50.228Z"
labels: ["robustness", "tech-debt"]
order: "Zz"
---
# Replace regex YAML parsing with a real parser

Frontmatter is currently parsed with line-regex helpers (`getValue` / `getArrayValue`) and serialized by hand-quoting strings with no escaping. This corrupts any card whose free-text fields contain double quotes, commas, or square brackets. Replacing the hand-rolled code with the `yaml` npm package eliminates the entire class of bug.

## Context

`src/shared/featureFrontmatter.ts` is the single canonical implementation of `parseFeatureFile` and `serializeFeature` (the consolidation card `consolidate-frontmatter-serialization-2026-06-02` is already done — there is no second copy to worry about).

### Why the current implementation is broken

`getValue` matches a single line with a regex and strips only the outermost quote pair. A value like `Alice "Al" Smith` serializes to `assignee: "Alice "Al" Smith"` and round-trips back as `Alice "Al" Smith"` — a trailing stray quote.

`getArrayValue` captures everything between `[` and the first `]`, then splits on `,`. A label containing a comma (`"bug, regression"`) splits into two wrong tokens. A label containing `]` (e.g. `"fix [regression]"`) causes early capture termination and silently drops trailing labels.

`serializeFeature` wraps every string value in double quotes with no internal escaping, so any `"` inside a value produces malformed YAML on the next write.

These files are hand-edited, committed, and written by the kanban-skill AI agent, so adversarial values are a matter of when, not if. The existing round-trip tests use only "nice" values and give no coverage of these cases.

### Relationship with `harden-frontmatter-serialization`

`harden-frontmatter-serialization.md.md` is an explicit alternative: fix the escaping in the existing regex code without adding a dependency. The two stories target the same file and the same bugs. **Do not do both.** If this story (`replace-regex-yaml-parser`) ships, close `harden-frontmatter-serialization` as "Won't Do — superseded."

### Chosen approach: `yaml` npm package

Eemeli Aro's `yaml` package (npm: `yaml`) is the recommended library. It is actively maintained, has no transitive dependencies, and is approximately 40 kB minified. Because the extension bundle is built with `esbuild --bundle`, the library is inlined into `dist/extension.js` at build time — no runtime installation required. The webview bundle (Vite) does not import `featureFrontmatter.ts`, so the webview bundle size is unaffected.

`js-yaml` is an acceptable alternative if the team prefers it; `gray-matter` is not recommended because it adds markdown-processing overhead beyond what is needed.

## Acceptance criteria

- \[ \] `yaml` (or `js-yaml`) is added as a production dependency in `package.json` and installed via pnpm.
- \[ \] `parseFeatureFile` uses the chosen library to parse the frontmatter block into a plain object; the `getValue` and `getArrayValue` regex helpers are deleted.
- \[ \] `serializeFeature` uses the library's `stringify` (or equivalent) to produce the frontmatter block; the hand-quoting template-literal code is deleted.
- \[ \] The on-disk format for normal (non-adversarial) values is preserved: scalar strings are double-quoted inline, `null` fields serialize as bare `null`, labels serialize as an inline flow array (`labels: ["a", "b"]`). Existing files written by prior versions parse without error.
- \[ \] A value containing a double quote in `assignee`, `epic`, or a label survives `serializeFeature` → write → `parseFeatureFile` unchanged.
- \[ \] A label containing a comma survives the round trip as a single label, not two.
- \[ \] A label containing `]` survives the round trip without truncation.
- \[ \] All existing unit tests in `tests/shared/featureFrontmatter.test.ts` pass without modification to test expectations (the observable contract does not change).
- \[ \] New round-trip tests are added to `tests/shared/featureFrontmatter.test.ts` covering: double-quote in `assignee`, double-quote in `epic`, comma-containing label, bracket-containing label, colon-containing `epic`, and a unicode label value (e.g. `"支払い"`).
- \[ \] All existing integration tests in `tests/integration/suite/extension.test.ts` pass.
- \[ \] The `pnpm build:extension` command produces a valid `dist/extension.js` with the new library bundled.

## Definition of done

- \[ \] All acceptance criteria above are checked off.
- \[ \] `harden-frontmatter-serialization` is closed as "Won't Do — superseded by this story" with a note linking this card.
- \[ \] `pnpm test` passes (unit + integration).
- \[ \] `pnpm build:extension` produces no errors or warnings related to the new dependency.
- \[ \] The PR description notes the on-disk format is backward-compatible and links to at least one adversarial round-trip test as evidence.

## Story point estimate

**5 points**

Rationale: The logic change is confined to one small file (`featureFrontmatter.ts`, 61 lines). The mechanical work is straightforward — swap two functions — but validating backward compatibility of the serialized format and writing the adversarial test suite adds non-trivial verification effort. No architectural decisions remain open. No UI work. Fits comfortably in one sprint.

## Dependencies

DependencyDirectionStatusNotes`consolidate-frontmatter-serialization-2026-06-02`blocks this**Done**There is now exactly one implementation to change.`extract-feature-repository-service-2026-06-02`blocked by thisBacklogThe service-layer extraction should wrap one correct implementation; land this first.`harden-frontmatter-serialization`mutual alternativeOpen/TodoDo not do both. Close as Won't Do once this card is accepted.`yaml` npm packageexternalNot installedMust be added via `pnpm add yaml` before implementation begins.

## Affected files

- `src/shared/featureFrontmatter.ts` — primary change: replace regex helpers and hand-serialization with library calls
- `tests/shared/featureFrontmatter.test.ts` — add adversarial round-trip test cases
- `tests/integration/suite/extension.test.ts` — verify no regression (likely no changes needed)
- `package.json` — add `yaml` (or `js-yaml`) to `dependencies`

## Implementation notes

### Library selection

`yaml` (Eemeli Aro) is preferred:

```
pnpm add yaml
```

It exposes `parse(str): unknown` and `stringify(value, options): string`. The options needed to preserve the desired on-disk format are:

```ts
import { parse, stringify } from 'yaml'

// Parse:
const parsed = parse(frontmatterBlock) as Record<string, unknown>

// Serialize (preserve flow style for the labels array and inline scalars):
const yamlStr = stringify(frontmatterObj, {
  defaultStringType: 'QUOTE_DOUBLE',
  defaultKeyType: 'PLAIN',
  flowLevel: 1,   // keeps labels: ["a", "b"] inline rather than block-sequence
  lineWidth: 0,   // do not wrap long lines
})
```

Verify the output format matches the existing `makeFrontmatter()` fixture in the test file before removing the old implementation.

### Null field handling

The library will likely serialize `null` JS values as bare `null` YAML scalars, which matches the current format. Verify this for `assignee`, `epic`, `dueDate`, and `completedAt` before deleting the hand-quoting code.

### Labels field type

When parsing, ensure `labels` is always coerced to `string[]`. If the YAML block has `labels: []` the library will return an empty JS array, which is correct. If it has a bare `labels:` with no value, guard with `Array.isArray(parsed.labels) ? parsed.labels : []`.

### Backward compatibility

All existing `.md` files in `.devtool/features/` were written by the current serializer and use the format: double-quoted scalars, inline flow arrays. Both `yaml` and `js-yaml` parse standard YAML 1.2 flow sequences correctly, so existing files will round-trip without any migration script.

### Format preservation test

Before deleting the old serializer, add a snapshot test (or inline string assertion) that confirms `serializeFeature(makeFeature())` produces output byte-for-byte identical to `makeFrontmatter()` in the existing test fixture. This guards against subtle whitespace or quoting differences introduced by the library.