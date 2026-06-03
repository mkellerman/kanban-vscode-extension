---
id: "consolidate-frontmatter-serialization-2026-06-02"
status: "done"
priority: "high"
assignee: null
epic: "Architecture remediation"
dueDate: null
created: "2026-06-02T18:00:00.000Z"
modified: "2026-06-03T05:13:12.990Z"
completedAt: null
labels: ["tech-debt", "refactor"]
order: "a0"
---
# Consolidate frontmatter parse/serialize into the shared module

Two independent reimplementations of the frontmatter parser and serializer exist and have already diverged. The real work is collapsing `FeatureHeaderProvider` onto `src/shared/featureFrontmatter.ts`. `KanbanPanel` already delegates to the shared module and needs only minor cleanup.

## Context

`src/shared/featureFrontmatter.ts` exports `parseFeatureFile(content, filePath)` and `serializeFeature(feature)`. These are the canonical implementations.

`KanbanPanel` (`_parseFeatureFile` / `_serializeFeature`) already delegates directly to those exports — both methods are one-line passthroughs (lines 526-532 of `KanbanPanel.ts`). There is no logic drift here, only dead indirection. These wrappers can be inlined at their call sites and removed (`_parseFeatureFile`: 4 call sites; `_serializeFeature`: 10 call sites).

`FeatureHeaderProvider` (`_parseDocument` / `_serializeDocument`) is a genuine full reimplementation. It duplicates the `getValue` / `getArrayValue` regex helpers, the field-by-field construction, and the entire serialization block. It has already diverged from the shared module in at least three ways (see Divergence details below). Every new field or bug fix must currently be made in two places or the on-disk format silently splits between modes (board panel vs. native editor mode).

## Divergence details

The following differences between `FeatureHeaderProvider._parseDocument` and the shared `parseFeatureFile` were confirmed by reading the source:

1. `id` **fallback on missing value** — shared module falls back to `path.basename(filePath, '.md')`; `_parseDocument` falls back to the string literal `'unknown'`. A file with no `id:` in its frontmatter will receive a different identity depending on which path parsed it. This is the most dangerous divergence: the board panel and the native editor header will disagree on the card's identity.

2. **No-frontmatter path** — when the document has no `---` block at all, `_parseDocument` delegates to `_getDefaultFrontmatter()` which also sets `id: 'unknown'`. The shared module returns `null` for a frontmatter-less file. `FeatureHeaderProvider` must handle this case explicitly after the switch; the shared module's null return is appropriate for its callers but cannot be used as-is here.

3. `modified` **stamping on serialize** — `_serializeDocument` always overwrites `modified` with `new Date().toISOString()` before writing (lines 313-316). `serializeFeature` serializes whatever `feature.modified` contains without modification. This is the intentional "stamp on save" behaviour the story's AC already calls out. It must be preserved.

4. **Return type mismatch** — `_parseDocument` returns `{ frontmatter: FeatureFrontmatter, content: string }`. The shared `parseFeatureFile` returns `Feature | null` (which includes `filePath` and the same `content` field). `FeatureHeaderProvider` works with `FeatureFrontmatter`, not `Feature`. A thin adapter is needed at the call sites inside `FeatureHeaderProvider`, or `parseFeatureFile` needs a call-site shim that supplies `filePath` from `this._currentDocument.uri.fsPath` (which is always available in context).

5. **Minor:** `_serializeDocument` **stale-argument references** — the serializer uses `frontmatter.labels` (line 329) and `frontmatter.order` (line 330) — the original argument — for those two fields, while using `updatedFrontmatter` (with the new `modified`) for all other fields. This is cosmetic since both reference the same values, but it is a copy-paste inconsistency that the shared module does not have.

## Acceptance criteria

- \[ \] `KanbanPanel._parseFeatureFile` and `_serializeFeature` are removed; their fourteen call sites in `KanbanPanel.ts` are updated to call `parseFeatureFile` / `serializeFeature` directly (already imported at line 8).
- \[ \] `FeatureHeaderProvider._parseDocument` is removed; its three call sites are replaced with direct calls to the shared `parseFeatureFile`, passing `this._currentDocument.uri.fsPath` as `filePath`. Results are adapted from `Feature | null` to `FeatureFrontmatter` at each call site.
- \[ \] A private helper `_extractFrontmatter(feature: Feature): FeatureFrontmatter` is added (or equivalent inline mapping) to convert the `Feature` object returned by `parseFeatureFile` to the `FeatureFrontmatter` type used internally by `FeatureHeaderProvider`; the adapter is used at the two call sites that need to surface `FeatureFrontmatter` (`_updateViewForCurrentEditor` and `startWithAI`); `_updateFrontmatter` only needs `feature.content` from the parse result.
- \[ \] `FeatureHeaderProvider._serializeDocument` is removed; its single call site in `_updateFrontmatter` is replaced with a call to the shared `serializeFeature`, with `modified` stamped on the `Feature` object before the call (preserving existing save-stamp behaviour without forking the serializer).
- \[ \] `FeatureHeaderProvider._getDefaultFrontmatter` is removed or replaced; the no-frontmatter case (`parseFeatureFile` returns `null`) is handled per call site: (a) `_updateViewForCurrentEditor` — call `_hideView()` and return; (b) `startWithAI` — abort and return without performing any AI operation; (c) `_updateFrontmatter` — default `content` to `''` (no body content) and proceed with the supplied `FeatureFrontmatter`.
- \[ \] The `id: 'unknown'` fallback is eliminated; after the change, a file with no `id:` field in frontmatter gets its id from the filename via the shared module's `path.basename` fallback, consistent with the board panel.
- \[ \] All existing unit and integration tests pass with no change to the on-disk file format.
- \[ \] No behavioural change is observable in the native editor header panel (field display, save stamping `modified`, AI prompt construction).

## Affected files

- `src/shared/featureFrontmatter.ts` — likely no changes needed; receives callers only
- `src/extension/KanbanPanel.ts` — remove `_parseFeatureFile` and `_serializeFeature`; inline their call sites
- `src/extension/FeatureHeaderProvider.ts` — remove `_parseDocument`, `_serializeDocument`, `_getDefaultFrontmatter`; add call-site adaptors

## Notes

Land this before the service-layer extraction so that refactor inherits one correct implementation rather than two.

The story title and original context section described "three copies" — code inspection shows the real count is two: the shared module and `FeatureHeaderProvider`. `KanbanPanel` already delegates and contributes no divergence risk.

The no-frontmatter branch in `FeatureHeaderProvider` currently silently creates a synthetic `FeatureFrontmatter` with `id: 'unknown'` and lets the header render. After this change, a `null` return from `parseFeatureFile` is handled per call site (see AC above); the previous synthetic-default behaviour is removed. All existing `.md` files in the features directory have a frontmatter block; the no-frontmatter path is dead code in practice and can be removed without concern.