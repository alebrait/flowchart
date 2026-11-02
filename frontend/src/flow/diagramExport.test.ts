import { describe, expect, it } from 'vitest'
import type { DiagramFlowEdge, DiagramFlowNode, ShapeType } from '../types'
import { buildDiagramSvg, safeExportFilename } from './diagramExport'

function makeNode(
  id: string,
  shape: ShapeType,
  x: number,
  y: number,
  label: string,
  annotation = '',
): DiagramFlowNode {
  return {
    id,
    type: 'diagramNode',
    position: { x, y },
    style: { width: 160, height: 92 },
    data: {
      shape_type: shape,
      label,
      annotation,
      width: 160,
      height: 92,
      visual_properties: {},
      z_index: 0,
    },
  }
}

function makeEdge(
  source: string,
  target: string,
  options: Partial<NonNullable<DiagramFlowEdge['data']>> = {},
): DiagramFlowEdge {
  return {
    id: 'edge-1',
    source,
    target,
    sourceHandle: 'right',
    targetHandle: 'left',
    type: 'diagramEdge',
    data: {
      label: '',
      color: '#b83333',
      width: 2.5,
      line_style: 'solid',
      arrowheads: 'end',
      path_type: 'straight',
      bend_points: [],
      ...options,
    },
  }
}

describe('diagram SVG export', () => {
  it('exports all shapes, offscreen geometry, Unicode and multiline content as vector SVG', () => {
    const nodes = [
      makeNode('action', 'action', -400, -120, 'Review <request>', 'Owner & reviewer'),
      makeNode('decision', 'decision', 30, 20, '审批？\nReady?', '预计：15 分钟'),
      makeNode('terminator', 'terminator', 280, 20, 'Start / end'),
      makeNode('hexagon', 'hexagon', 520, 20, 'Preparation'),
      makeNode('text', 'text', 800, 5000, 'Note', 'Cost: $5\nUnicode ✓'),
    ]
    const edge = makeEdge('decision', 'action', {
      label: 'Yes\ncontinue',
      line_style: 'dashed',
      arrowheads: 'both',
      path_type: 'step',
      bend_points: [{ x: -150, y: 260 }],
    })

    const svg = buildDiagramSvg(nodes, [edge], 'A & <map>')
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')

    expect(parsed.querySelector('parsererror')).toBeNull()
    expect(svg).toContain('<title id="diagram-title">A &amp; &lt;map&gt;</title>')
    expect(svg).toContain('审批？')
    expect(svg).toContain('预计：15 分钟')
    expect(svg).toContain('Cost: $5')
    expect(svg).toContain('Owner &amp; reviewer')
    expect(svg).toContain('stroke-dasharray="7 5"')
    expect(svg).toContain('marker-start="url(#edge-arrow-0)"')
    expect(svg).toContain('marker-end="url(#edge-arrow-0)"')
    expect(svg).toContain('clipPath')
    expect(svg).not.toContain('foreignObject')
    expect(svg).toContain('viewBox="-')
    expect(svg).toContain('5000')
  })

  it('routes self-loops outside node bounds and retains edge labels', () => {
    const node = makeNode('loop', 'action', 100, 100, 'Loop')
    const edge = {
      ...makeEdge('loop', 'loop', { label: 'Retry' }),
      sourceHandle: 'top',
      targetHandle: 'top',
    }

    const svg = buildDiagramSvg([node], [edge], 'Loop')

    expect(svg).toContain('Retry')
    expect(svg).toContain(' L 290 70')
    expect(svg).toContain(' L 290 222')
  })

  it('can create white or transparent empty-canvas backgrounds', () => {
    const transparent = buildDiagramSvg([], [], 'Empty')
    const white = buildDiagramSvg([], [], 'Empty', 'white')

    expect(transparent).not.toContain('fill="#ffffff"/>')
    expect(white).toContain('fill="#ffffff"/>')
  })

  it('creates safe, readable download filenames', () => {
    expect(safeExportFilename('A process: review?', 'svg')).toBe('A process- review-.svg')
    expect(safeExportFilename('  ...  ', 'png')).toBe('diagram.png')
  })
})
