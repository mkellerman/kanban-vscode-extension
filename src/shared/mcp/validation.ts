import type { StoryResponse, StorySource } from './contracts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStorySource(value: unknown): value is StorySource {
  return isObject(value) && typeof value.path === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function validateMetadata(metadata: unknown): asserts metadata is StoryResponse['metadata'] {
  if (!isObject(metadata)) throw new Error('Story response metadata must be an object')
  if (metadata.validated !== true) throw new Error('Story response metadata must be validated')
  if (typeof metadata.mcpVersion !== 'string') throw new Error('Story response metadata must include mcpVersion')
  if (typeof metadata.schemaVersion !== 'string') throw new Error('Story response metadata must include schemaVersion')
  if (typeof metadata.createdAt !== 'string') throw new Error('Story response metadata must include createdAt')
  if (typeof metadata.executionTimeMs !== 'number' || !Number.isFinite(metadata.executionTimeMs)) {
    throw new Error('Story response metadata must include executionTimeMs')
  }
  if (typeof metadata.agentUsed !== 'string') throw new Error('Story response metadata must include agentUsed')
  if (typeof metadata.sourceCount !== 'number' || !Number.isInteger(metadata.sourceCount) || metadata.sourceCount < 0) {
    throw new Error('Story response metadata must include sourceCount')
  }
  if (!Array.isArray(metadata.sources) || !metadata.sources.every(isStorySource)) {
    throw new Error('Story response metadata must include sources')
  }
  if (metadata.sourceCount !== metadata.sources.length) {
    throw new Error('Story response metadata sourceCount must match sources.length')
  }
  if (!isObject(metadata.validation)) throw new Error('Story response metadata must include validation')
  if (metadata.validation.schema !== 'pass' && metadata.validation.schema !== 'fail') {
    throw new Error('Story response metadata must include validation.schema')
  }
  if (metadata.validation.dependencyCheck !== 'pass' && metadata.validation.dependencyCheck !== 'fail') {
    throw new Error('Story response metadata must include validation.dependencyCheck')
  }
  if (
    metadata.mode !== 'selection' &&
    metadata.mode !== 'detail' &&
    metadata.mode !== 'updated' &&
    metadata.mode !== 'breakdown'
  ) {
    throw new Error('Story response metadata must include mode')
  }
  if (metadata.mode === 'selection') {
    if (typeof metadata.selectionInstruction !== 'string' || metadata.selectionInstruction.length === 0) {
      throw new Error('Selection responses must include selectionInstruction')
    }
  }
}

export function validateStoryResponse(value: unknown): asserts value is StoryResponse {
  if (!isObject(value)) throw new Error('Story response must be an object')
  validateMetadata(value.metadata)

  if ('stories' in value) {
    if (!Array.isArray(value.stories)) throw new Error('Selection responses must include stories')
    for (const story of value.stories) {
      if (!isObject(story)) throw new Error('Story summaries must be objects')
      if (typeof story.id !== 'string') throw new Error('Story summaries must include id')
      if (typeof story.title !== 'string') throw new Error('Story summaries must include title')
      if (
        story.status !== 'todo' &&
        story.status !== 'in-progress' &&
        story.status !== 'review' &&
        story.status !== 'done' &&
        story.status !== 'blocked'
      ) {
        throw new Error('Story summaries must include status')
      }
      if (story.priority !== undefined && story.priority !== 'critical' && story.priority !== 'high' && story.priority !== 'medium' && story.priority !== 'low') {
        throw new Error('Story summaries must include a valid priority')
      }
      if (story.labels !== undefined && !isStringArray(story.labels)) {
        throw new Error('Story summaries must include valid labels')
      }
      if (typeof story.assignee !== 'string' && story.assignee !== null) {
        throw new Error('Story summaries must include assignee')
      }
      if (typeof story.path !== 'string') throw new Error('Story summaries must include path')
      if (story.summary !== undefined && typeof story.summary !== 'string') {
        throw new Error('Story summaries must include a valid summary')
      }
    }
    return
  }

  if ('story' in value) {
    const story = value.story
    if (!isObject(story)) throw new Error('Story response must include story')
    if (typeof story.id !== 'string') throw new Error('Story response must include story.id')
    if (typeof story.title !== 'string') throw new Error('Story response must include story.title')
    if (
      story.status !== 'todo' &&
      story.status !== 'in-progress' &&
      story.status !== 'review' &&
      story.status !== 'done' &&
      story.status !== 'blocked'
    ) {
      throw new Error('Story response must include story.status')
    }
    if (story.priority !== undefined && story.priority !== 'critical' && story.priority !== 'high' && story.priority !== 'medium' && story.priority !== 'low') {
      throw new Error('Story response must include a valid story.priority')
    }
    if (story.labels !== undefined && !isStringArray(story.labels)) {
      throw new Error('Story response must include valid story.labels')
    }
    if (typeof story.assignee !== 'string' && story.assignee !== null) {
      throw new Error('Story response must include story.assignee')
    }
    if (typeof story.path !== 'string') throw new Error('Story response must include story.path')
    if (story.summary !== undefined && typeof story.summary !== 'string') {
      throw new Error('Story response must include a valid story.summary')
    }
    return
  }

  throw new Error('Story response must include stories or story')
}
