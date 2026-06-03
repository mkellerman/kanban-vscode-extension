# Design: Optimize Webview Bundle Size

**Date:** 2026-06-03
**Feature:** optimize-webview-bundle-size
**Status:** approved

## Problem

The webview entry chunk (`dist/webview/index.js`) is 582 KB — nearly 2× the existing Vite warning limit of 300 KB. The dominant cause is Tiptap (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `tiptap-markdown`), which is bundled into the main chunk even though it is only needed when a user opens a card to edit it. This inflates initial parse time and will grow unbounded without an enforced budget.

## Goal

- Reduce the main entry chunk to ≤200 KB.
- Add CI enforcement so regressions are caught automatically.

## Approach: Lazy-load FeatureEditor + CI script

### 1. Lazy-load `FeatureEditor`

Convert the static import of `FeatureEditor` to a dynamic import so Vite emits it as a separate on-demand chunk:

```tsx
// Before
import FeatureEditor from './components/FeatureEditor'

// After
const FeatureEditor = React.lazy(() => import('./components/FeatureEditor'))
```

Wrap the usage site in `<Suspense fallback={null}>`. Vite automatically splits `FeatureEditor` and all its Tiptap dependencies into a separate chunk that loads only when a user first opens the editor. No changes to `FeatureEditor.tsx` itself.

The existing `manualChunks` entries (`react-vendor`, `icons`) in `vite.config.ts` are unchanged.

**Expected outcome:** main entry chunk drops from ~582 KB to ~150–180 KB.

### 2. Bundle budget CI script

New file `scripts/check-bundle-size.ts`:

```ts
import { statSync } from 'fs'
import { resolve } from 'path'

const ENTRY_CHUNK = resolve('dist/webview/index.js')
const BUDGET_KB = 200

const sizeKb = statSync(ENTRY_CHUNK).size / 1024
if (sizeKb > BUDGET_KB) {
  console.error(`Bundle budget exceeded: index.js is ${sizeKb.toFixed(1)} KB (budget: ${BUDGET_KB} KB)`)
  process.exit(1)
}
console.log(`Bundle size OK: index.js is ${sizeKb.toFixed(1)} KB (budget: ${BUDGET_KB} KB)`)
```

New `package.json` script:

```json
"check-bundle-size": "pnpm run build:webview && tsx scripts/check-bundle-size.ts"
```

New step in `.github/workflows/ci.yml` `build` job, after the existing `Build` step:

```yaml
- name: Check bundle size
  run: pnpm run check-bundle-size
```

The budget constant (200 KB) lives in the script itself — easy to locate and adjust intentionally.

## Files changed

| File | Change |
|---|---|
| `src/webview/App.tsx` | Convert `FeatureEditor` import to `React.lazy` + wrap usage in `<Suspense>` |
| `scripts/check-bundle-size.ts` | New — bundle budget enforcement script |
| `package.json` | Add `check-bundle-size` script |
| `.github/workflows/ci.yml` | Add `Check bundle size` step to `build` job |

## Acceptance criteria

- `dist/webview/index.js` is ≤200 KB after `pnpm run build:webview`.
- `FeatureEditor` opens and functions identically to before (no functional regression).
- `pnpm run check-bundle-size` exits 0 when under budget, exits 1 with a clear message when over.
- The `build` CI job fails if the budget is exceeded.
- No unit or integration test regressions.

## Out of scope

- CSS size reduction (47 KB Tailwind output is acceptable).
- Replacing Tiptap with a lighter editor.
- Optimizing the `react-vendor` or `icons` chunks (already well-split).
