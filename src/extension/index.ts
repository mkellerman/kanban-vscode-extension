import * as vscode from 'vscode'
import { KanbanPanel } from './KanbanPanel'
import { SidebarViewProvider } from './SidebarViewProvider'
import { getActiveAdapters } from './frameworkRegistry'
import type { CreateFeatureData } from './frameworks/FrameworkAdapter'
import type { FeatureStatus, Priority } from '../shared/types'
import type { FrameworkId } from '../shared/frameworks/types'
import { t, loadBundle } from './l10n'

interface StatusQuickPickItem extends vscode.QuickPickItem {
  statusValue: FeatureStatus
}

interface PriorityQuickPickItem extends vscode.QuickPickItem {
  priorityValue: Priority
}

async function createFeatureFromPrompts(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) {
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

  const config = vscode.workspace.getConfiguration('kanban-extension')
  const frameworkSetting = config.get<'auto' | FrameworkId>('framework', 'auto')
  const adapters = await getActiveAdapters(workspaceRoot, frameworkSetting)
  const adapter = adapters.find(candidate => candidate.id === 'native') ?? adapters[0]
  if (!adapter) {
    vscode.window.showErrorMessage(t('ext.noWorkspace'))
    return
  }

  // Build content with title as first # heading
  const content = `# ${title}${description ? '\n\n' + description : ''}`
  const data: CreateFeatureData = {
    status,
    priority,
    assignee: null,
    epic: null,
    dueDate: null,
    labels: [],
    content
  }
  const feature = await adapter.createFeature(data, workspaceRoot)

  // Open the created file
  const document = await vscode.workspace.openTextDocument(feature.filePath)
  await vscode.window.showTextDocument(document)

  vscode.window.showInformationMessage(t('ext.createdFeature', { title }))
}

export function activate(context: vscode.ExtensionContext) {
  loadBundle(context.extensionPath)
  // Sidebar webview in the activity bar
  const sidebarProvider = new SidebarViewProvider(context.extensionUri, context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider)
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-extension.open', () => {
      const wasOpen = !!KanbanPanel.currentPanel
      KanbanPanel.createOrShow(context.extensionUri, context)
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
      createFeatureFromPrompts()
    })
  )

  // If a panel already exists, revive it
  if (vscode.window.registerWebviewPanelSerializer) {
    vscode.window.registerWebviewPanelSerializer(KanbanPanel.viewType, {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
        KanbanPanel.revive(webviewPanel, context.extensionUri, context)
        sidebarProvider.setBoardOpen(true)
        KanbanPanel.currentPanel?.onDispose(() => {
          sidebarProvider.setBoardOpen(false)
        })
      }
    })
  }
}

export function deactivate() {}
