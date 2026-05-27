import type { Feature, FeatureStatus, Priority } from '../../shared/types'
import type { FrameworkId } from '../../shared/frameworks/types'

export interface CreateFeatureData {
  status: FeatureStatus
  priority: Priority
  content: string
  assignee: string | null
  epic: string | null
  dueDate: string | null
  labels: string[]
}

export interface FrameworkAdapter {
  readonly id: FrameworkId
  name: string
  usesDoneSubfolder: boolean

  /** Return true if this framework is detected in the given workspace root. */
  detect(workspaceRoot: string): Promise<boolean>

  /** Return glob patterns (relative to workspaceRoot) for file watching. */
  getWatchPatterns(workspaceRoot: string): string[]

  /** Return absolute paths of all files claimed by this adapter. */
  getFiles(workspaceRoot: string): Promise<string[]>

  /** Parse raw file content into a Feature, or null if unrecognised. */
  parseFile(content: string, filePath: string): Feature | null

  /**
   * Serialize a feature back to file content.
   * originalContent is the raw string read from disk before any edits;
   * adapters that embed frontmatter inside a larger template may use it
   * to preserve surrounding structure. Native adapter ignores it.
   */
  serializeFeature(feature: Feature, originalContent: string): string

  /** Create a new feature file and return the resulting Feature. */
  createFeature(data: CreateFeatureData, workspaceRoot: string): Promise<Feature>

  /**
   * Move a file when its status changes (e.g. done ↔ non-done transition).
   * Returns the new absolute file path.
   */
  moveFile(currentPath: string, feature: Feature, workspaceRoot: string): Promise<string>
}
