import { describe, expect, it } from 'vitest'
import {
  flowToSnapshot,
  graphToFlow,
  remapSnapshotIdentities,
  withParallelOffsets,
} from './graphSerialization'
import type { GraphResponse } from '../types'

const graph: GraphResponse = {
  diagram: {
    id: 'diagram-id',
    title: 'Delivery process',
    description: 'A small sample',
    owner: { id: 7, username: 'mapper' },
    revision: 4,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  revision: 4,
  viewport: { x: 36, y: -18, zoom: 0.8 },
  nodes: [
    {
      id: 'node-one',
      shape_type: 'decision',
      label: 'Ready?\nÅ',
      annotation: 'Wait: 15 minutes',
      x: 40,
      y: 80,
      width: 132,
      height: 96,
      visual_properties: { fill: '#f5f8fc', stroke: '#687887', text: '#20262e' },
      z_index: 3,
    },
    {
      id: 'node-two',
      shape_type: 'hexagon',
      label: 'Pack',
      annotation: '',
      x: 320,
      y: 100,
      width: 160,
      height: 80,
      visual_properties: {},
      z_index: 0,
    },
  ],
  edges: [
    {
      id: 'edge-one',
      source: 'node-one',
      target: 'node-two',
      source_port: 'right',
      target_port: 'upper-left',
      label: 'Yes',
      color: '#b83333',
      width: 2.5,
      line_style: 'dashed',
      arrowheads: 'both',
      path_type: 'step',
      bend_points: [{ x: 212, y: 120 }],
    },
  ],
}

describe('graph serialization', () => {
  it('round-trips graph content, geometry, styles, and viewport', () => {
    const flow = graphToFlow(graph)
    const snapshot = flowToSnapshot(
      flow.nodes,
      flow.edges,
      flow.viewport,
      graph.revision,
      graph.diagram.title,
      graph.diagram.description,
    )

    expect(snapshot).toEqual({
      expected_revision: 4,
      title: 'Delivery process',
      description: 'A small sample',
      viewport: { x: 36, y: -18, zoom: 0.8 },
      nodes: graph.nodes,
      edges: graph.edges,
    })
  })

  it('keeps parallel edges distinct and assigns visible offsets', () => {
    const flow = graphToFlow(graph)
    const originalEdge = flow.edges[0]
    if (!originalEdge.data) {
      throw new Error('Serialized edges must include data')
    }
    const parallelEdge = {
      ...originalEdge,
      id: 'edge-two',
      data: { ...originalEdge.data, label: 'No' },
    }
    const reverseEdge = {
      ...originalEdge,
      id: 'edge-return',
      source: originalEdge.target,
      target: originalEdge.source,
      sourceHandle: originalEdge.targetHandle,
      targetHandle: originalEdge.sourceHandle,
    }
    const edges = withParallelOffsets([...flow.edges, parallelEdge, reverseEdge])
    const offsets = edges.map((edge) => edge.data?.parallel_offset)

    expect(new Set(edges.map((edge) => edge.id)).size).toBe(3)
    expect(new Set(offsets).size).toBe(3)
    expect(flowToSnapshot(flow.nodes, edges, flow.viewport, 4, 'Map', '').edges).toHaveLength(3)
  })

  it('remaps copied node and edge identities without breaking endpoints', () => {
    const flow = graphToFlow(graph)
    const snapshot = flowToSnapshot(
      flow.nodes,
      flow.edges,
      flow.viewport,
      graph.revision,
      graph.diagram.title,
      graph.diagram.description,
    )
    const nodeIds = new Map<string, string>()
    const edgeIds = new Map<string, string>()
    let nextId = 0
    const createId = () => `copy-${++nextId}`

    const copied = remapSnapshotIdentities(snapshot, nodeIds, edgeIds, createId)
    const repeated = remapSnapshotIdentities(snapshot, nodeIds, edgeIds, createId)

    expect(copied.nodes.map((node) => node.id)).toEqual(['copy-1', 'copy-2'])
    expect(copied.edges[0]).toMatchObject({
      id: 'copy-3',
      source: 'copy-1',
      target: 'copy-2',
    })
    expect(repeated).toEqual(copied)
  })
})
