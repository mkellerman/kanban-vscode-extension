import * as path from 'path'
import * as vscode from 'vscode'
import { generateKeyBetween } from 'fractional-indexing'
import type { Feature } from '../../shared/types'
import { getTitleFromContent } from '../../shared/types'
import type { FrameworkAdapter, CreateFeatureData } from './FrameworkAdapter'
import type { FrameworkId } from '../../shared/frameworks/types'
import { parseSpeckitFile, serializeSpeckitFeature } from '../../shared/frameworks/speckit'

const SPECS_DIR = '.specify/specs'

function makeSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'spec'
  )
}

export class SpecKitAdapter implements FrameworkAdapter {
  readonly id: FrameworkId = 'spec-kit'
  name = 'SpecKit'
  usesDoneSubfolder = false

  async detect(workspaceRoot: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(workspaceRoot, SPECS_DIR)))
      return true
    } catch {
      return false
    }
  }

  getWatchPatterns(_workspaceRoot: string): string[] {
    return [`${SPECS_DIR}/*/spec.md`]
  }

  async getFiles(workspaceRoot: string): Promise<string[]> {
    const specsDir = path.join(workspaceRoot, SPECS_DIR)
    const files: string[] = []
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(specsDir))
      for (const [name, type] of entries) {
        if (type === vscode.FileType.Directory) {
          const specFile = path.join(specsDir, name, 'spec.md')
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(specFile))
            files.push(specFile)
          } catch {
            // no spec.md in this directory
          }
        }
      }
    } catch {
      // specsDir doesn't exist
    }
    return files
  }

  parseFile(content: string, filePath: string): Feature | null {
    if (path.basename(filePath) !== 'spec.md') return null
    return parseSpeckitFile(content, filePath)
  }

  serializeFeature(feature: Feature, originalContent: string): string {
    return serializeSpeckitFeature(feature, originalContent)
  }

  async createFeature(data: CreateFeatureData, workspaceRoot: string): Promise<Feature> {
    const specsDir = path.join(workspaceRoot, SPECS_DIR)
    const title = getTitleFromContent(data.content)
    const base = makeSlug(title)

    const allFilePaths = await this.getFiles(workspaceRoot)
    const existingInStatus: Feature[] = []
    for (const fp of allFilePaths) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fp))
        const feature = this.parseFile(new TextDecoder().decode(bytes), fp)
        if (feature && feature.status === data.status) {
          existingInStatus.push(feature)
        }
      } catch {
        // skip unreadable files
      }
    }
    existingInStatus.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const newOrder = generateKeyBetween(
      existingInStatus.length > 0 ? existingInStatus[existingInStatus.length - 1].order : null,
      null
    )

    let specSlug = base
    let specDir = path.join(specsDir, specSlug)
    let filePath = path.join(specDir, 'spec.md')
    let counter = 1
    while (true) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
        specSlug = `${base}-${counter}`
        specDir = path.join(specsDir, specSlug)
        filePath = path.join(specDir, 'spec.md')
        counter++
      } catch {
        break
      }
    }

    const now = new Date().toISOString()
    const feature: Feature = {
      id: specSlug,
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      epic: null,
      dueDate: data.dueDate,
      created: now,
      modified: now,
      completedAt: data.status === 'done' ? now : null,
      labels: data.labels,
      order: newOrder,
      content: data.content,
      filePath
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(specDir))
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(filePath),
      new TextEncoder().encode(this.serializeFeature(feature, ''))
    )

    return feature
  }

  async moveFile(currentPath: string, _feature: Feature, _workspaceRoot: string): Promise<string> {
    return currentPath
  }
}
