import * as vscode from 'vscode'
import * as crypto from 'crypto'
import type { KanbanColumn, Feature } from '../shared/types'
import type { FeatureRepository } from './FeatureRepository'
import { KanbanPanel } from './KanbanPanel'
import { t } from './l10n'

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kanban-markdown.boardView'

  private _view?: vscode.WebviewView
  private _disposables: vscode.Disposable[] = []

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    private readonly _repo: FeatureRepository
  ) {
    this._repo.onDidChange(features => {
      this._postUpdate(features)
    }, null, this._disposables)

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('kanban-markdown')) {
        if (e.affectsConfiguration('kanban-markdown.featuresDirectory')) {
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

    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.type) {
        case 'ready':
          this._postUpdate(this._repo.features as Feature[])
          break
        case 'openBoard':
          vscode.commands.executeCommand('kanban-markdown.open')
          break
        case 'newFeature':
          vscode.commands.executeCommand('kanban-markdown.open')
          // Wait for the panel to be ready, then trigger create dialog
          setTimeout(() => {
            KanbanPanel.currentPanel?.triggerCreateDialog()
          }, 500)
          break
        case 'openFeature':
          vscode.commands.executeCommand('kanban-markdown.open')
          setTimeout(() => {
            KanbanPanel.currentPanel?.openFeature(message.featureId)
          }, 500)
          break
      }
    }, null, this._disposables)

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        vscode.commands.executeCommand('kanban-markdown.open')
      }
    }, null, this._disposables)

    webviewView.onDidDispose(() => {
      this._view = undefined
    })

    // Auto-open the board when the sidebar first loads
    vscode.commands.executeCommand('kanban-markdown.open')

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
      columns: this._getColumns()
    })
    this._view.webview.postMessage({
      type: 'boardOpenChanged',
      open: !!KanbanPanel.currentPanel
    })
  }

  private _getColumns(): KanbanColumn[] {
    const config = vscode.workspace.getConfiguration('kanban-markdown')
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
