export type StoryMode = 'selection' | 'detail' | 'updated' | 'breakdown'

export type StoryStatus = 'todo' | 'in-progress' | 'review' | 'done' | 'blocked'

export type StoryPriority = 'critical' | 'high' | 'medium' | 'low'

export interface StorySource {
  path: string
}

export interface StorySummary {
  id: string
  title: string
  status: StoryStatus
  priority?: StoryPriority
  labels?: string[]
  assignee: string | null
  path: string
  summary?: string
}

export interface StoryValidation {
  schema: 'pass' | 'fail'
  dependencyCheck: 'pass' | 'fail'
  message?: string
}

export interface McpMetadata {
  mcpVersion: string
  schemaVersion: string
  createdAt: string
  executionTimeMs: number
  agentUsed: string
  sourceCount: number
  sources: StorySource[]
  validated: true
  validation: StoryValidation
  mode: StoryMode
  selectionInstruction?: string
}

export interface StoryResponseEnvelope {
  metadata: McpMetadata
}

export interface StorySelectionResponse extends StoryResponseEnvelope {
  metadata: McpMetadata & { mode: 'selection'; selectionInstruction: string }
  stories: StorySummary[]
}

export interface StoryDetailResponse extends StoryResponseEnvelope {
  metadata: McpMetadata & { mode: 'detail' | 'updated' | 'breakdown' }
  story: StorySummary
}

export type StoryResponse = StorySelectionResponse | StoryDetailResponse

function createMetadata(input: {
  mode: StoryMode
  agentUsed: string
  sources: StorySource[]
  executionTimeMs?: number
  selectionInstruction?: string
}): McpMetadata {
  const metadata: McpMetadata = {
    mcpVersion: '1.0.0',
    schemaVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    executionTimeMs: input.executionTimeMs ?? 0,
    agentUsed: input.agentUsed,
    sourceCount: input.sources.length,
    sources: input.sources,
    validated: true,
    validation: {
      schema: 'pass',
      dependencyCheck: 'pass'
    },
    mode: input.mode
  }

  if (input.mode === 'selection') {
    metadata.selectionInstruction = input.selectionInstruction ?? 'Present the returned stories as a numbered menu.'
  }

  return metadata
}

export function buildSelectionResponse(input: {
  agentUsed: string
  sources: StorySource[]
  stories: StorySummary[]
  executionTimeMs?: number
  selectionInstruction?: string
}): StorySelectionResponse {
  return {
    metadata: createMetadata({
      mode: 'selection',
      agentUsed: input.agentUsed,
      sources: input.sources,
      executionTimeMs: input.executionTimeMs,
      selectionInstruction: input.selectionInstruction
    }) as StorySelectionResponse['metadata'],
    stories: input.stories
  }
}

export function buildDetailResponse(input: {
  agentUsed: string
  sources: StorySource[]
  story: StorySummary
  executionTimeMs?: number
}): StoryDetailResponse {
  return {
    metadata: createMetadata({
      mode: 'detail',
      agentUsed: input.agentUsed,
      sources: input.sources,
      executionTimeMs: input.executionTimeMs
    }) as StoryDetailResponse['metadata'],
    story: input.story
  }
}

export function buildStoryResponse(input: {
  mode: Exclude<StoryMode, 'selection'>
  agentUsed: string
  sources: StorySource[]
  story: StorySummary
  executionTimeMs?: number
}): StoryDetailResponse {
  return {
    metadata: createMetadata({
      mode: input.mode,
      agentUsed: input.agentUsed,
      sources: input.sources,
      executionTimeMs: input.executionTimeMs
    }) as StoryDetailResponse['metadata'],
    story: input.story
  }
}
