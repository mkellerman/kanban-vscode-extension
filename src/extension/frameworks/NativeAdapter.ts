import * as path from 'path'
import * as vscode from 'vscode'
import { generateKeyBetween } from 'fractional-indexing'
import type { Feature, FilenamePattern } from '../../shared/types'
import { getTitleFromContent, generateFeatureFilename } from '../../shared/types'
import type { FrameworkAdapter, CreateFeatureData } from './FrameworkAdapter'
import type { FrameworkId } from '../../shared/frameworks/types'
import { parseNativeFile, serializeNativeFeature } from '../../shared/frameworks/native'
import { getFeatureFilePath, moveFeatureFile, fileExists } from '../featureFileUtils'

function getFeaturesDir(workspaceRoot: string): string {
  const config = vscode.workspace.getConfiguration('kanban-extension')
  const featuresDirectory = config.get<string>('featuresDirectory') || '.devtool/features'
  return path.join(workspaceRoot, featuresDirectory)
}

function normalizeEpic(value: string | null | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

export class NativeAdapter implements FrameworkAdapter {
  readonly id: FrameworkId = 'native'
  name = 'Native'
  usesDoneSubfolder = true

  async detect(workspaceRoot: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(getFeaturesDir(workspaceRoot)))
      return true
    } catch {
      return false
    }
  }

  getWatchPatterns(workspaceRoot: string): string[] {
    const config = vscode.workspace.getConfiguration('kanban-extension')
    const featuresDirectory = config.get<string>('featuresDirectory') || '.devtool/features'
    return [`${featuresDirectory}/**/*.md`]
  }

  async getFiles(workspaceRoot: string): Promise<string[]> {
    const featuresDir = getFeaturesDir(workspaceRoot)
    const files: string[] = []

    try {
      const rootEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(featuresDir))
      for (const [name, type] of rootEntries) {
        if (type === vscode.FileType.File && name.endsWith('.md')) {
          files.push(path.join(featuresDir, name))
        }
      }
    } catch {
      return files
    }

    try {
      const doneDir = path.join(featuresDir, 'done')
      const doneEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(doneDir))
      for (const [name, type] of doneEntries) {
        if (type === vscode.FileType.File && name.endsWith('.md')) {
          files.push(path.join(doneDir, name))
        }
      }
    } catch {
      // done/ may not exist yet
    }

    return files
  }

  parseFile(content: string, filePath: string): Feature | null {
    return parseNativeFile(content, filePath)
  }

  serializeFeature(feature: Feature, _originalContent: string): string {
    return serializeNativeFeature(feature)
  }

  async createFeature(data: CreateFeatureData, workspaceRoot: string): Promise<Feature> {
    const featuresDir = getFeaturesDir(workspaceRoot)
    const config = vscode.workspace.getConfiguration('kanban-extension')
    const pattern = config.get<FilenamePattern>('filenamePattern', 'name-date')
    const addNewCardsToTop = config.get<boolean>('addNewCardsToTop', false)

    const title = getTitleFromContent(data.content)
    const filename = generateFeatureFilename(title, pattern)

    // Read existing features in the target status to compute fractional order
    const allFilePaths = await this.getFiles(workspaceRoot)
    const existingInStatus: Feature[] = []
    for (const filePath of allFilePaths) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
        const feature = this.parseFile(new TextDecoder().decode(bytes), filePath)
        if (feature && feature.status === data.status) {
          existingInStatus.push(feature)
        }
      } catch {
        // skip unreadable files
      }
    }
    existingInStatus.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

    const newOrder = addNewCardsToTop
      ? generateKeyBetween(null, existingInStatus.length > 0 ? existingInStatus[0].order : null)
      : generateKeyBetween(existingInStatus.length > 0 ? existingInStatus[existingInStatus.length - 1].order : null, null)

    let filePath = getFeatureFilePath(featuresDir, data.status, filename)
    let uniqueFilename = filename
    let counter = 1
    while (await fileExists(filePath)) {
      uniqueFilename = `${filename}-${counter}`
      filePath = getFeatureFilePath(featuresDir, data.status, uniqueFilename)
      counter++
    }

    const now = new Date().toISOString()
    const feature: Feature = {
      id: uniqueFilename,
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      epic: normalizeEpic(data.epic),
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

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)))
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(filePath),
      new TextEncoder().encode(this.serializeFeature(feature, ''))
    )

    return feature
  }

  async moveFile(currentPath: string, feature: Feature, workspaceRoot: string): Promise<string> {
    return moveFeatureFile(currentPath, getFeaturesDir(workspaceRoot), feature.status)
  }
}
