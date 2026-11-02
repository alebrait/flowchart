import { describe, expect, it } from 'vitest'
import { Position } from '@xyflow/react'
import { createLoopRoute } from './edgeRouting'

describe('self-loop routing', () => {
  it('routes connections around the outside of their node', () => {
    const route = createLoopRoute(
      { x: 160, y: 40 },
      { x: 0, y: 40 },
      { x: 0, y: 0, width: 160, height: 80 },
      Position.Right,
      Position.Left,
      0,
    )

    expect(route.path).toContain(' L 190 110')
    expect(route.path).toContain(' L -30 110')
    expect(route.labelPosition.y).toBeGreaterThan(80)
  })

  it('gives same-port loops a complete visible route', () => {
    const route = createLoopRoute(
      { x: 80, y: 0 },
      { x: 80, y: 0 },
      { x: 0, y: 0, width: 160, height: 80 },
      Position.Top,
      Position.Top,
      0,
    )

    expect(route.path).toContain(' L 190 -30')
    expect(route.path).toContain(' L 190 110')
    expect(route.path).toContain(' L -30 110')
    expect(route.path).toContain(' L -30 -30')
  })
})
