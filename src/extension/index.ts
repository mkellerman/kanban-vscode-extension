import * as vscode from 'vscode'
import { generateKeyBetween } from 'fractional-indexing'
import { KanbanPanel } from './KanbanPanel'
import { SidebarViewProvider } from './SidebarViewProvider'
import { generateFeatureFilename } from '../shared/types'
import { serializeFeature } from '../shared/featureFrontmatter'
import type { Feature, FeatureStatus, Priority } from '../shared/types'
import { ensureStatusSubfolders, getFeatureFilePath } from './featureFileUtils'
import { t, loadBundle } from './l10n'
import { FeatureRepositoryManager } from './FeatureRepositoryManager'
import type { IFeatureRepository } from './FeatureRepository'
import type { GroomedDirectory, SchemaType } from '../shared/types'
import { AgentLauncher } from './AgentLauncher'
import { FeatureHeaderProvider } from './FeatureHeaderProvider'

interface StatusQuickPickItem extends vscode.QuickPickItem {
  statusValue: FeatureStatus
}

interface PriorityQuickPickItem extends vscode.QuickPickItem {
  priorityValue: Priority
}

async function createFeatureFromPrompts(repo: IFeatureRepository): Promise<void> {
  const featuresDir = repo.getFeaturesDir()
  if (!featuresDir) {
    vscode.window.showErrorMessage(t('ext.noWorkspace'))
    return
  }

  // Ask for title
  const title = await vscode.window.showInputBox({
    prompt: t('ext.featureTitle'),
    placeHolder: t('ext.featureTitlePlaceholder')
  })
  if (!title) return

  // Ask for status
  const statusItems: StatusQuickPickItem[] = [
    { label: t('status.backlog'), description: t('status.backlog.description'), statusValue: 'backlog' },
    { label: t('status.todo'), description: t('status.todo.description'), statusValue: 'todo' },
    { label: t('status.inProgress'), description: t('status.inProgress.description'), statusValue: 'in-progress' },
    { label: t('status.review'), description: t('status.review.description'), statusValue: 'review' },
    { label: t('status.done'), description: t('status.done.description'), statusValue: 'done' }
  ]
  const statusPick = await vscode.window.showQuickPick(statusItems, {
    placeHolder: t('ext.selectStatus')
  })
  if (!statusPick) return

  const status = statusPick.statusValue

  // Ask for priority
  const priorityItems: PriorityQuickPickItem[] = [
    { label: t('priority.critical'), description: t('priority.critical.description'), priorityValue: 'critical' },
    { label: t('priority.high'), description: t('priority.high.description'), priorityValue: 'high' },
    { label: t('priority.medium'), description: t('priority.medium.description'), priorityValue: 'medium' },
    { label: t('priority.low'), description: t('priority.low.description'), priorityValue: 'low' }
  ]
  const priorityPick = await vscode.window.showQuickPick(priorityItems, {
    placeHolder: t('ext.selectPriority')
  })
  if (!priorityPick) return

  const priority = priorityPick.priorityValue

  // Ask for description (optional)
  const description = await vscode.window.showInputBox({
    prompt: t('ext.descriptionOptional'),
    placeHolder: t('ext.descriptionPlaceholder')
  })

  // Create the feature file
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(featuresDir))
  await ensureStatusSubfolders(featuresDir)

  const filename = generateFeatureFilename(title)
  const now = new Date().toISOString()

  // Build content with title as first # heading
  const content = `# ${title}${description ? '\n\n' + description : ''}`

  const feature: Feature = {
    id: filename,
    status,
    priority,
    assignee: null,
    epic: null,
    dueDate: null,
    created: now,
    modified: now,
    completedAt: status === 'done' ? now : null,
    labels: [],
    order: generateKeyBetween(null, null),
    workspace: null,
    content,
    filePath: getFeatureFilePath(featuresDir, status, filename)
  }

  const fileContent = serializeFeature(feature)
  await vscode.workspace.fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(fileContent))

  // Open the created file
  const document = await vscode.workspace.openTextDocument(feature.filePath)
  await vscode.window.showTextDocument(document)

  vscode.window.showInformationMessage(t('ext.createdFeature', { title }))
}

export function activate(context: vscode.ExtensionContext) {
  loadBundle(context.extensionPath)

  const config = vscode.workspace.getConfiguration('kanban-extension')
  const groomedDirs = config.get<GroomedDirectory[]>('groomedDirectories') ?? []
  const effectiveDirs: GroomedDirectory[] = groomedDirs.length > 0
    ? groomedDirs
    : [
        { path: config.get<string>('featuresDirectory') || '.kanban/features', schema: 'feature' as SchemaType },
        { path: 'docs/superpowers', schema: 'superpowers' as SchemaType }
      ]
  const repo = new FeatureRepositoryManager(context, effectiveDirs)
  const launcher = new AgentLauncher(context.extensionUri)
  context.subscriptions.push(launcher)

  const sidebarProvider = new SidebarViewProvider(context.extensionUri, context, repo)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider),
    { dispose: () => sidebarProvider.dispose() }
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-extension.open', () => {
      const wasOpen = !!KanbanPanel.currentPanel
      KanbanPanel.createOrShow(context.extensionUri, context, repo, launcher)
      if (!wasOpen && KanbanPanel.currentPanel) {
        sidebarProvider.setBoardOpen(true)
        KanbanPanel.currentPanel.onDispose(() => {
          sidebarProvider.setBoardOpen(false)
        })
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-extension.addFeature', () => {
      createFeatureFromPrompts(repo)
    })
  )

  if (vscode.window.registerWebviewPanelSerializer) {
    vscode.window.registerWebviewPanelSerializer(KanbanPanel.viewType, {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
        KanbanPanel.revive(webviewPanel, context.extensionUri, context, repo, launcher)
        sidebarProvider.setBoardOpen(true)
        KanbanPanel.currentPanel?.onDispose(() => {
          sidebarProvider.setBoardOpen(false)
        })
      }
    })
  }

  context.subscriptions.push(
    FeatureHeaderProvider.register(context, launcher, repo)
  )

  context.subscriptions.push(repo)
}

export function deactivate() {}
