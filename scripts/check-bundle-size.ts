import { statSync, readdirSync } from 'fs'
import { resolve, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DIST_DIR = resolve(__dirname, '../dist/webview')
const BUDGET_KB = 200

// Vendor/shared chunks with accepted large sizes — excluded from per-chunk budget enforcement
const VENDOR_CHUNK = /^(react-vendor|icons|EpicInput)-/

export function checkBundleSize(
  entryChunkPath: string,
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

export function checkAllChunks(distDir: string = DIST_DIR, budgetKb: number = BUDGET_KB): void {
  const chunks = readdirSync(distDir)
    .filter(f => f.endsWith('.js') && !VENDOR_CHUNK.test(f))
  let failed = false
  for (const chunk of chunks) {
    const sizeKb = statSync(resolve(distDir, chunk)).size / 1024
    if (sizeKb > budgetKb) {
      console.error(`Bundle budget exceeded: ${chunk} is ${sizeKb.toFixed(1)} KB (budget: ${budgetKb} KB)`)
      failed = true
    } else {
      console.log(`Bundle size OK: ${chunk} is ${sizeKb.toFixed(1)} KB (budget: ${budgetKb} KB)`)
    }
  }
  if (failed) process.exit(1)
}

if (process.argv[1] === __filename) {
  checkAllChunks()
}
