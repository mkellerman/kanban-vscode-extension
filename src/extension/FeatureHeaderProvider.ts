import * as vscode from 'vscode'
import * as crypto from 'crypto'
import * as path from 'path'
import type { FeatureFrontmatter, EditorExtensionMessage, EditorWebviewMessage } from '../shared/editorTypes'
import type { Feature, AIAgent, KanbanColumn } from '../shared/types'
import { getTitleFromContent, DEFAULT_COLUMNS } from '../shared/types'
import { parseFeatureFile, serializeFeature } from '../shared/featureFrontmatter'
import { buildPrompt, PromptContext } from './ai/promptBuilder'
import { launchAgentTerminal } from './ai/agentLauncher'
import { t } from './l10n'

/**
 * Provides a webview panel that shows feature metadata (frontmatter) as a header.
 * The actual markdown editing is done by VSCode's native text editor.
 */
export class FeatureHeaderProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kanban-markdown.featureHeader'

  private _view?: vscode.WebviewView
  private _currentDocument?: vscode.TextDocument
  private _disposables: vscode.Disposable[] = []

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new FeatureHeaderProvider(context.extensionUri)

    const disposables: vscode.Disposable[] = []

    // Register the webview view provider
    disposables.push(
      vscode.window.registerWebviewViewProvider(
        FeatureHeaderProvider.viewType,
        provider,
        {
          webviewOptions: {
            retainContextWhenHidden: true
          }
        }
      )
    )

    // Listen for active editor changes
    disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        provider._onActiveEditorChanged(editor)
      })
    )

    // Listen for document changes
    disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        provider._onDocumentChanged(e)
      })
    )

    // Listen for settings changes
    disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kanban-markdown')) {
          // Re-evaluate current editor against fresh config
          // (e.g. featuresDirectory may have changed)
          provider._onActiveEditorChanged(vscode.window.activeTextEditor)
        }
      })
    )

    return vscode.Disposable.from(...disposables)
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'dist'),
        vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')
      ]
    }

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: EditorWebviewMessage) => {
      switch (message.type) {
        case 'ready':
          this._updateViewForCurrentEditor()
          break

        case 'frontmatterUpdate':
          await this._updateFrontmatter(message.frontmatter)
          break

        case 'requestSave':
          if (this._currentDocument) {
            await this._currentDocument.save()
          }
          break

        case 'startWithAI': {
          if (!vscode.workspace.isTrusted) {
            vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
            return
          }

          if (!this._currentDocument) return
          await this._currentDocument.save()

          const parsedFeature = parseFeatureFile(this._currentDocument.getText(), this._currentDocument.uri.fsPath)
          if (!parsedFeature) return
          const fm = this._extractFrontmatter(parsedFeature)
          const docContent = parsedFeature.content

          const workspaceRoot =
            vscode.workspace.getWorkspaceFolder(this._currentDocument.uri)?.uri.fsPath
            ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            ?? null

          const config = vscode.workspace.getConfiguration('kanban-markdown')
          const columns = config.get<KanbanColumn[]>('columns', DEFAULT_COLUMNS)
          const column = columns.find(c => c.id === fm.status)
            ?? { id: fm.status, name: fm.status, color: '' }

          const ctx: PromptContext = {
            title: getTitleFromContent(docContent),
            status: fm.status,
            priority: fm.priority,
            labels: fm.labels,
            content: docContent,
            filePath: this._currentDocument.uri.fsPath
          }
          const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot, column.prompt)

          const agent: AIAgent = message.agent || 'claude'
          const permissionMode = message.permissionMode || 'default'

          launchAgentTerminal(agent, permissionMode, prompt, workspaceRoot ?? undefined)
          break
        }
      }
    })

    // Update view when it becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._updateViewForCurrentEditor()
      }
    })

    // Check current editor
    this._updateViewForCurrentEditor()
  }

  private _onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this._currentDocument = undefined
      return
    }

    // Only track .md files in the features directory (including status subfolders)
    const uri = editor.document.uri
    const config = vscode.workspace.getConfiguration('kanban-markdown')
    const featuresDirectory = config.get<string>('featuresDirectory') || '.devtool/features'
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const fullFeaturesDir = workspaceRoot ? path.join(workspaceRoot, featuresDirectory) : featuresDirectory
    if (uri.fsPath.endsWith('.md') && uri.fsPath.startsWith(fullFeaturesDir + path.sep)) {
      this._currentDocument = editor.document
      this._updateViewForCurrentEditor()
    } else {
      this._currentDocument = undefined
      this._hideView()
    }
  }

  private _onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
    if (this._currentDocument && e.document.uri.toString() === this._currentDocument.uri.toString()) {
      this._updateViewForCurrentEditor()
    }
  }

  private _updateViewForCurrentEditor(): void {
    if (!this._view || !this._currentDocument) return

    const parsed = parseFeatureFile(this._currentDocument.getText(), this._currentDocument.uri.fsPath)
    if (!parsed) {
      this._hideView()
      return
    }
    const frontmatter = this._extractFrontmatter(parsed)
    const fileName = this._currentDocument.uri.path.split('/').pop()?.replace(/\.md$/, '') || 'Untitled'

    const message: EditorExtensionMessage = {
      type: 'init',
      content: '', // Not used anymore
      frontmatter,
      fileName
    }
    this._view.webview.postMessage(message)
  }

  private _hideView(): void {
    // Send empty state to hide content
    if (this._view) {
      this._view.webview.postMessage({
        type: 'init',
        content: '',
        frontmatter: null,
        fileName: ''
      })
    }
  }

  private async _updateFrontmatter(frontmatter: FeatureFrontmatter): Promise<void> {
    if (!this._currentDocument) return

    const parsed = parseFeatureFile(this._currentDocument.getText(), this._currentDocument.uri.fsPath)
    const content = parsed ? parsed.content : ''
    const feature: Feature = {
      ...frontmatter,
      modified: new Date().toISOString(),
      content,
      filePath: this._currentDocument.uri.fsPath
    }
    const newText = serializeFeature(feature)

    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      this._currentDocument.uri,
      new vscode.Range(0, 0, this._currentDocument.lineCount, 0),
      newText
    )
    await vscode.workspace.applyEdit(edit)
  }

  // Adapts Feature (which includes filePath and content) to FeatureFrontmatter for webview messaging
  private _extractFrontmatter(feature: Feature): FeatureFrontmatter {
    return {
      id: feature.id,
      status: feature.status,
      priority: feature.priority,
      assignee: feature.assignee,
      epic: feature.epic,
      dueDate: feature.dueDate,
      created: feature.created,
      modified: feature.modified,
      completedAt: feature.completedAt,
      labels: feature.labels,
      order: feature.order
    }
  }

  private _getNonce(): string {
    return crypto.randomBytes(24).toString('base64url')
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'editor.js')
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'style.css')
    )

    const nonce = this._getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Feature Header</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}
