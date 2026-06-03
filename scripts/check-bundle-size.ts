import { statSync } from 'fs'
import { resolve, basename } from 'path'
import { fileURLToPath } from 'url'

const ENTRY_CHUNK = resolve('dist/webview/index.js')
const BUDGET_KB = 200

export function checkBundleSize(
  entryChunkPath: string = ENTRY_CHUNK,
  budgetKb: number = BUDGET_KB
): void {
  const sizeKb = statSync(entryChunkPath).size / 1024
  const name = basename(entryChunkPath)
  if (sizeKb > budgetKb) {
    console.error(`Bundle budget exceeded: ${name} is ${sizeKb.toFixed(1)} KB (budget: ${budgetKb} KB)`)
    process.exit(1)
  }
  console.log(`Bundle size OK: ${name} is ${sizeKb.toFixed(1)} KB (budget: ${budgetKb} KB)`)
}

const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] === __filename) {
  checkBundleSize()
}
