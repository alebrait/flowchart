import { describe, expect, it } from 'vitest'
import { EditorHistory } from './editorHistory'
import type { DiagramFlowEdge, DiagramFlowNode } from '../types'

const firstNode: DiagramFlowNode = {
  id: 'first',
  type: 'diagramNode',
  position: { x: 0, y: 0 },
  data: {
    shape_type: 'action',
    label: '',
    annotation: '',
    width: 120,
    height: 64,
    visual_properties: {},
    z_index: 0,
  },
}
const secondNode: DiagramFlowNode = { ...firstNode, id: 'second' }
const edge: DiagramFlowEdge = {
  id: 'edge',
  source: 'first',
  target: 'second',
  sourceHandle: 'right',
  targetHandle: 'left',
  type: 'diagramEdge',
  data: {
    label: '',
    color: '#536273',
    width: 2,
    line_style: 'solid',
    arrowheads: 'end',
    path_type: 'straight',
    bend_points: [],
  },
}

describe('editor history', () => {
  it('restores removed nodes and their attached edges together', () => {
    const history = new EditorHistory()
    history.record({ nodes: [firstNode, secondNode], edges: [edge] })

    const restored = history.undo({ nodes: [], edges: [] })

    expect(restored?.nodes.map((node) => node.id)).toEqual(['first', 'second'])
    expect(restored?.edges.map((item) => item.id)).toEqual(['edge'])
  })

  it('groups repeated updates within one gesture into a single undo step', () => {
    const history = new EditorHistory()
    const before = { nodes: [firstNode], edges: [] }
    history.beginGesture(before)
    history.beginGesture({ nodes: [{ ...firstNode, position: { x: 5, y: 5 } }], edges: [] })
    history.endGesture()

    const restored = history.undo({
      nodes: [{ ...firstNode, position: { x: 30, y: 30 } }],
      edges: [],
    })

    expect(restored?.nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
  })
})
