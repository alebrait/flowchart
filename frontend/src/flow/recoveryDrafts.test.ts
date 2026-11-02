import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearUserRecoveryDrafts,
  readRecoveryDraft,
  recoveryDraftDiffers,
  recoveryDraftKey,
  writeRecoveryDraft,
} from './recoveryDrafts'
import type { GraphSnapshot } from '../types'

const snapshot: GraphSnapshot = {
  expected_revision: 2,
  title: 'Map',
  description: '',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
}

describe('recovery drafts', () => {
  beforeEach(() => localStorage.clear())

  it('stores drafts scoped to both user and diagram', () => {
    const draft = {
      user_id: 7,
      diagram_id: 'diagram-a',
      base_revision: 2,
      snapshot,
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    writeRecoveryDraft(localStorage, draft)

    expect(readRecoveryDraft(localStorage, 7, 'diagram-a')).toEqual(draft)
    expect(readRecoveryDraft(localStorage, 8, 'diagram-a')).toBeNull()
    expect(readRecoveryDraft(localStorage, 7, 'diagram-b')).toBeNull()
  })

  it('only clears the signed-in user drafts and detects differing content', () => {
    const saved = { ...snapshot, expected_revision: 3 }
    const changed = { ...snapshot, title: 'Local edit' }
    writeRecoveryDraft(localStorage, {
      user_id: 7,
      diagram_id: 'diagram-a',
      base_revision: 2,
      snapshot: changed,
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    localStorage.setItem(recoveryDraftKey(8, 'diagram-a'), 'keep')

    expect(recoveryDraftDiffers(changed, saved)).toBe(true)
    expect(recoveryDraftDiffers(snapshot, saved)).toBe(false)
    clearUserRecoveryDrafts(localStorage, 7)
    expect(localStorage.getItem(recoveryDraftKey(7, 'diagram-a'))).toBeNull()
    expect(localStorage.getItem(recoveryDraftKey(8, 'diagram-a'))).toBe('keep')
  })

  it('rejects malformed stored drafts instead of restoring them', () => {
    localStorage.setItem(recoveryDraftKey(7, 'diagram-a'), '{"snapshot":{"nodes":null}}')
    expect(() => readRecoveryDraft(localStorage, 7, 'diagram-a')).toThrow(
      'The stored recovery draft is invalid.',
    )
  })
})
