import * as path from 'path'
import * as vscode from 'vscode'
import { generateKeyBetween } from 'fractional-indexing'
import type { Feature } from '../../shared/types'
import { getTitleFromContent, generateFeatureFilename } from '../../shared/types'
import type { FrameworkAdapter, CreateFeatureData } from './FrameworkAdapter'
import type { FrameworkId } from '../../shared/frameworks/types'
import { parseSuperpowersFile, serializeSuperpowersFeature } from '../../shared/frameworks/superpowers'

const PLANS_DIR = 'docs/superpowers/plans'

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

export class SuperpowersAdapter implements FrameworkAdapter {
  readonly id: FrameworkId = 'superpowers'
  name = 'Superpowers'
  usesDoneSubfolder = false

  async detect(workspaceRoot: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(workspaceRoot, PLANS_DIR)))
      return true
    } catch {
      return false
    }
  }

  getWatchPatterns(_workspaceRoot: string): string[] {
    return [`${PLANS_DIR}/**/*.md`]
  }

  async getFiles(workspaceRoot: string): Promise<string[]> {
    return listMdFilesRecursive(path.join(workspaceRoot, PLANS_DIR))
  }

  parseFile(content: string, filePath: string): Feature | null {
    return parseSuperpowersFile(content, filePath)
  }

  serializeFeature(feature: Feature, originalContent: string): string {
    return serializeSuperpowersFeature(feature, originalContent)
  }

  async createFeature(data: CreateFeatureData, workspaceRoot: string): Promise<Feature> {
    const plansDir = path.join(workspaceRoot, PLANS_DIR)
    const title = getTitleFromContent(data.content)
    const base = generateFeatureFilename(title, 'date-name')

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
    let filePath = path.join(plansDir, `${filename}.md`)
    let counter = 1
    while (true) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
        filename = `${base}-${counter}`
        filePath = path.join(plansDir, `${filename}.md`)
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
      order: newOrder,
      content: data.content,
      filePath
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(plansDir))
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
