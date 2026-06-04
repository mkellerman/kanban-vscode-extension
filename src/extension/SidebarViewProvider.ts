import * as vscode from 'vscode'
import * as crypto from 'crypto'
import * as path from 'path'
import type { KanbanColumn, Feature } from '../shared/types'
import type { IFeatureRepository } from './FeatureRepository'
import { KanbanPanel } from './KanbanPanel'
import { t } from './l10n'

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kanban-extension.boardView'

  private _view?: vscode.WebviewView
  private _disposables: vscode.Disposable[] = []

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    private readonly _repo: IFeatureRepository
  ) {
    this._repo.onDidChange(features => {
      this._postUpdate(features)
    }, null, this._disposables)

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('kanban-extension')) {
        if (e.affectsConfiguration('kanban-extension.featuresDirectory')) {
          this._repo.load()
        } else {
          this._postUpdate(this._repo.features as Feature[])
        }
      }
    }, null, this._disposables)
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true
    }

    webviewView.webview.onDidReceiveMessage(async message => {
      switch (message.type) {
        case 'ready':
          this._postUpdate(this._repo.features as Feature[])
          break
        case 'openBoard':
          vscode.commands.executeCommand('kanban-extension.open')
          break
        case 'newFeature':
          vscode.commands.executeCommand('kanban-extension.open')
          // Wait for the panel to be ready, then trigger create dialog
          setTimeout(() => {
            KanbanPanel.currentPanel?.triggerCreateDialog()
          }, 500)
          break
        case 'openFeature':
          vscode.commands.executeCommand('kanban-extension.open')
          setTimeout(() => {
            KanbanPanel.currentPanel?.openFeature(message.featureId)
          }, 500)
          break
        case 'switchWorkspace': {
          try {
            const folders = vscode.workspace.workspaceFolders ?? []
            const folderItems = folders.map(f => ({
              label: f.name,
              description: f.uri.fsPath
            }))
            const openItem = { label: t('sidebar.switchWorkspace.openFolder'), description: '__open__' }
            const items = [...folderItems, openItem]

            const selected = await vscode.window.showQuickPick(items, {
              placeHolder: t('sidebar.switchWorkspace.placeholder')
            })
            if (!selected) break

            if (selected.description === '__open__') {
              const uris = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: t('sidebar.switchWorkspace.openLabel')
              })
              if (!uris || uris.length === 0) break
              await this._repo.setRoot(uris[0].fsPath)
            } else {
              await this._repo.setRoot(selected.description!)
            }
          } catch (err) {
            vscode.window.showErrorMessage(
              t('sidebar.switchWorkspace.error', { error: err instanceof Error ? err.message : String(err) })
            )
          }
          break
        }
      }
    }, null, this._disposables)

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        vscode.commands.executeCommand('kanban-extension.open')
      }
    }, null, this._disposables)

    webviewView.onDidDispose(() => {
      this._view = undefined
    })

    // Auto-open the board when the sidebar first loads
    vscode.commands.executeCommand('kanban-extension.open')

    webviewView.webview.html = this._getHtml()
  }

  public setBoardOpen(open: boolean): void {
    if (this._view) {
      this._view.webview.postMessage({ type: 'boardOpenChanged', open })
    }
  }

  public dispose(): void {
    for (const d of this._disposables) d.dispose()
  }

  private _postUpdate(features: readonly Feature[]): void {
    if (!this._view) return
    const mapped = features.map(f => ({
      id: f.id,
      title: f.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.id,
      status: f.status,
      priority: f.priority
    }))
    this._view.webview.postMessage({
      type: 'update',
      features: mapped,
      columns: this._getColumns(),
      folderName: path.basename(this._repo.getEffectiveRoot() ?? '')
    })
    this._view.webview.postMessage({
      type: 'boardOpenChanged',
      open: !!KanbanPanel.currentPanel
    })
  }

  private _getColumns(): KanbanColumn[] {
    const config = vscode.workspace.getConfiguration('kanban-extension')
    const defaultColumns: KanbanColumn[] = [
      { id: 'backlog', name: 'Backlog', color: '#6b7280' },
      { id: 'todo', name: 'To Do', color: '#3b82f6' },
      { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
      { id: 'review', name: 'Review', color: '#8b5cf6' },
      { id: 'done', name: 'Done', color: '#22c55e' }
    ]
    return config.get<KanbanColumn[]>('columns', defaultColumns)
  }

  private _getHtml(): string {
    const nonce = this._getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
      padding: 12px 14px;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }

    button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 20px;
    }

    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .btn-folder {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      width: 100%;
      padding: 5px 10px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-sideBarSectionHeader-border, transparent));
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 20px;
      background: var(--vscode-sideBar-background, transparent);
      color: var(--vscode-foreground);
    }
    .btn-folder:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .btn-folder span {
      flex: 1;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .section {
      margin-bottom: 14px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      opacity: 0.8;
    }

    .section-header .total {
      font-weight: 400;
      opacity: 0.7;
    }

    .stat-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 0;
      font-size: var(--vscode-font-size);
    }

    .stat-label {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .stat-count {
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
    }

    .feature-list {
      list-style: none;
    }

    .feature-item {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: var(--vscode-font-size);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .feature-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .feature-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .feature-title {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .empty-state {
      color: var(--vscode-descriptionForeground);
      font-size: var(--vscode-font-size);
      font-style: italic;
      padding: 4px 0;
    }

    .separator {
      height: 1px;
      background: var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border, transparent));
      margin: 12px 0;
    }
  </style>
</head>
<body>
  <div class="actions">
    <button class="btn-folder" id="switchWorkspace" title="${t('sidebar.switchWorkspace.title')}">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.19a2 2 0 0 1 1.45.63l.06.06a1 1 0 0 0 .72.31H13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3.87zm.05.13H2a1 1 0 0 0-.99.91L1 4v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H7.53a2 2 0 0 1-1.45-.63l-.06-.06a1 1 0 0 0-.72-.31H2.5a1 1 0 0 0-.98.84L1.54 4z"/></svg>
      <span id="folderName">${path.basename(this._repo.getEffectiveRoot() ?? '') || t('sidebar.switchWorkspace.noFolder')}</span>
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>
    </button>
    <button class="btn-primary" id="openBoard">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2zm3 4a1 1 0 0 0-1 1v6a1 1 0 0 0 2 0V5a1 1 0 0 0-1-1zm3 0a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0V5a1 1 0 0 0-1-1zm3 0a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0V5a1 1 0 0 0-1-1z"/></svg>
      ${t('sidebar.openBoard')}
    </button>
    <button class="btn-secondary" id="newFeature">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a.5.5 0 0 1 .5.5V7h5.5a.5.5 0 0 1 0 1H8.5v5.5a.5.5 0 0 1-1 0V8H2a.5.5 0 0 1 0-1h5.5V1.5A.5.5 0 0 1 8 1z"/></svg>
      ${t('sidebar.newFeature')}
    </button>
  </div>

  <div class="separator"></div>

  <div class="section" id="overviewSection">
    <div class="section-header">
      <span>${t('sidebar.overview')}</span>
      <span class="total" id="totalCount">0 total</span>
    </div>
    <div id="statRows"></div>
  </div>

  <div class="separator"></div>

  <div class="section" id="inProgressSection" style="display:none;">
    <div class="section-header">
      <span>${t('sidebar.inProgress')}</span>
    </div>
    <ul class="feature-list" id="inProgressList"></ul>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      let columns = [];
      let features = [];

      document.getElementById('switchWorkspace').addEventListener('click', () => {
        vscode.postMessage({ type: 'switchWorkspace' });
      });
      document.getElementById('openBoard').addEventListener('click', () => {
        vscode.postMessage({ type: 'openBoard' });
      });
      document.getElementById('newFeature').addEventListener('click', () => {
        vscode.postMessage({ type: 'newFeature' });
      });

      window.addEventListener('message', e => {
        const msg = e.data;
        if (msg.type === 'update') {
          columns = msg.columns;
          features = msg.features;
          if (msg.folderName !== undefined) {
            document.getElementById('folderName').textContent = msg.folderName || '${t('sidebar.switchWorkspace.noFolder')}';
          }
          render();
        } else if (msg.type === 'boardOpenChanged') {
          document.getElementById('openBoard').style.display = msg.open ? 'none' : '';
        }
      });

      function render() {
        // Total count
        document.getElementById('totalCount').textContent = '${t('sidebar.total', { count: '{COUNT}' })}'.replace('{COUNT}', features.length);

        // Stat rows
        const statRows = document.getElementById('statRows');
        statRows.innerHTML = '';
        for (const col of columns) {
          const count = features.filter(f => f.status === col.id).length;
          const row = document.createElement('div');
          row.className = 'stat-row';
          row.innerHTML =
            '<span class="stat-label">' +
              '<span class="dot" style="background:' + escapeHtml(col.color) + '"></span>' +
              escapeHtml(col.name) +
            '</span>' +
            '<span class="stat-count">' + count + '</span>';
          statRows.appendChild(row);
        }

        // In-progress features
        const inProgressCol = columns.find(c => c.id === 'in-progress');
        const inProgressColor = inProgressCol ? inProgressCol.color : '#f59e0b';
        const inProgress = features.filter(f => f.status === 'in-progress');
        const section = document.getElementById('inProgressSection');
        const list = document.getElementById('inProgressList');

        if (inProgress.length > 0) {
          section.style.display = '';
          list.innerHTML = '';
          for (const f of inProgress) {
            const li = document.createElement('li');
            li.className = 'feature-item';
            li.title = f.title;
            li.innerHTML =
              '<span class="feature-dot" style="background:' + escapeHtml(inProgressColor) + '"></span>' +
              '<span class="feature-title">' + escapeHtml(f.title) + '</span>';
            li.addEventListener('click', () => {
              vscode.postMessage({ type: 'openFeature', featureId: f.id });
            });
            list.appendChild(li);
          }
        } else {
          section.style.display = 'none';
        }
      }

      function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
      }

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`
  }

  private _getNonce(): string {
    return crypto.randomBytes(24).toString('base64url')
  }
}
