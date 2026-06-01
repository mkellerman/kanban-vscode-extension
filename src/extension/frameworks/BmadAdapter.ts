import * as path from 'path'
import * as vscode from 'vscode'
import { generateKeyBetween } from 'fractional-indexing'
import type { Feature } from '../../shared/types'
import { getTitleFromContent } from '../../shared/types'
import type { FrameworkAdapter, CreateFeatureData } from './FrameworkAdapter'
import type { FrameworkId } from '../../shared/frameworks/types'
import { parseBmadFile, serializeBmadFeature } from '../../shared/frameworks/bmad'

const BMAD_DIRS = ['docs/stories', '_bmad-output/planning-artifacts'] as const

async function listMdFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = []
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir))
    for (const [name, type] of entries) {
      if (type === vscode.FileType.File && name.endsWith('.md')) {
        files.push(path.join(dir, name))
      } else if (type === vscode.FileType.Directory) {
        files.push(...await listMdFilesRecursive(path.join(dir, name)))
      }
    }
  } catch {
    // dir may not exist
  }
  return files
}

function makeSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'story'
  )
}

export class BmadAdapter implements FrameworkAdapter {
  readonly id: FrameworkId = 'bmad'
  name = 'BMAD'
  usesDoneSubfolder = false

  async detect(workspaceRoot: string): Promise<boolean> {
    for (const dir of BMAD_DIRS) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(path.join(workspaceRoot, dir)))
        return true
      } catch {
        // try next
      }
    }
    return false
  }

  getWatchPatterns(_workspaceRoot: string): string[] {
    return BMAD_DIRS.map(dir => `${dir}/**/*.md`)
  }

  async getFiles(workspaceRoot: string): Promise<string[]> {
    const allFiles: string[] = []
    for (const dir of BMAD_DIRS) {
      allFiles.push(...await listMdFilesRecursive(path.join(workspaceRoot, dir)))
    }
    return allFiles
  }

  parseFile(content: string, filePath: string): Feature | null {
    return parseBmadFile(content, filePath)
  }

  serializeFeature(feature: Feature, originalContent: string): string {
    return serializeBmadFeature(feature, originalContent)
  }

  async createFeature(data: CreateFeatureData, workspaceRoot: string): Promise<Feature> {
    // Write to the first directory that already exists, defaulting to docs/stories
    let targetDir = path.join(workspaceRoot, BMAD_DIRS[0])
    for (const dir of BMAD_DIRS) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(path.join(workspaceRoot, dir)))
        targetDir = path.join(workspaceRoot, dir)
        break
      } catch {
        // try next
      }
    }

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

    let filename = base
    let filePath = path.join(targetDir, `${filename}.md`)
    let counter = 1
    while (true) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
        filename = `${base}-${counter}`
        filePath = path.join(targetDir, `${filename}.md`)
        counter++
      } catch {
        break
      }
    }

    const now = new Date().toISOString()
    const feature: Feature = {
      id: filename,
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      epic: data.epic,
      dueDate: data.dueDate,
      created: now,
      modified: now,
      completedAt: data.status === 'done' ? now : null,
      labels: data.labels,
      dependsOn: [],
      order: newOrder,
      content: data.content,
      filePath
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir))
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
