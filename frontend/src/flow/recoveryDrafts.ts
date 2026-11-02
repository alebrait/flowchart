import type { GraphEdgeRecord, GraphNodeRecord, GraphSnapshot } from '../types'

export interface RecoveryDraft {
  user_id: number
  diagram_id: string
  base_revision: number
  snapshot: GraphSnapshot
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function isNode(value: unknown): value is GraphNodeRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    ['action', 'decision', 'terminator', 'hexagon', 'text'].includes(String(value.shape_type)) &&
    typeof value.label === 'string' &&
    typeof value.annotation === 'string' &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isNumber(value.width) &&
    value.width > 0 &&
    isNumber(value.height) &&
    value.height > 0 &&
    Number.isInteger(value.z_index) &&
    isRecord(value.visual_properties) &&
    Object.entries(value.visual_properties).every(
      ([key, color]) => ['fill', 'stroke', 'text'].includes(key) && isColor(color),
    )
  )
}

function isEdge(value: unknown): value is GraphEdgeRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    typeof value.source_port === 'string' &&
    typeof value.target_port === 'string' &&
    typeof value.label === 'string' &&
    isColor(value.color) &&
    isNumber(value.width) &&
    value.width > 0 &&
    ['solid', 'dashed'].includes(String(value.line_style)) &&
    ['none', 'start', 'end', 'both'].includes(String(value.arrowheads)) &&
    ['straight', 'step'].includes(String(value.path_type)) &&
    Array.isArray(value.bend_points) &&
    value.bend_points.every(
      (point) => isRecord(point) && isNumber(point.x) && isNumber(point.y),
    )
  )
}

function isSnapshot(value: unknown): value is GraphSnapshot {
  if (!isRecord(value) || !isRecord(value.viewport)) return false
  return (
    Number.isInteger(value.expected_revision) &&
    Number(value.expected_revision) >= 0 &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    isNumber(value.viewport.x) &&
    isNumber(value.viewport.y) &&
    isNumber(value.viewport.zoom) &&
    value.viewport.zoom > 0 &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isEdge)
  )
}

function isRecoveryDraft(value: unknown): value is RecoveryDraft {
  return (
    isRecord(value) &&
    Number.isInteger(value.user_id) &&
    typeof value.diagram_id === 'string' &&
    Number.isInteger(value.base_revision) &&
    typeof value.updated_at === 'string' &&
    isSnapshot(value.snapshot)
  )
}

export function recoveryDraftKey(userId: number, diagramId: string) {
  return `flowchart:recovery:${userId}:${diagramId}`
}

export function readRecoveryDraft(storage: Storage, userId: number, diagramId: string) {
  const key = recoveryDraftKey(userId, diagramId)
  const raw = storage.getItem(key)
  if (raw === null) return null
  const value: unknown = JSON.parse(raw)
  if (!isRecoveryDraft(value) || value.user_id !== userId || value.diagram_id !== diagramId) {
    throw new Error('The stored recovery draft is invalid.')
  }
  return value
}

export function writeRecoveryDraft(storage: Storage, draft: RecoveryDraft) {
  storage.setItem(recoveryDraftKey(draft.user_id, draft.diagram_id), JSON.stringify(draft))
}

export function removeRecoveryDraft(storage: Storage, userId: number, diagramId: string) {
  storage.removeItem(recoveryDraftKey(userId, diagramId))
}

export function clearUserRecoveryDrafts(storage: Storage, userId: number) {
  const prefix = `flowchart:recovery:${userId}:`
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
}

export function recoveryDraftDiffers(draft: GraphSnapshot, saved: GraphSnapshot) {
  return (
    draft.title !== saved.title ||
    draft.description !== saved.description ||
    JSON.stringify(draft.viewport) !== JSON.stringify(saved.viewport) ||
    JSON.stringify(draft.nodes) !== JSON.stringify(saved.nodes) ||
    JSON.stringify(draft.edges) !== JSON.stringify(saved.edges)
  )
}
