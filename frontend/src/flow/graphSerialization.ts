import type { Viewport } from '@xyflow/react'
import type {
  DiagramEdgeData,
  DiagramFlowEdge,
  DiagramFlowNode,
  GraphEdgeRecord,
  GraphNodeRecord,
  GraphResponse,
  GraphSnapshot,
} from '../types'

export function withParallelOffsets(edges: DiagramFlowEdge[]) {
  const groups = new Map<string, DiagramFlowEdge[]>()
  for (const edge of edges) {
    const source = JSON.stringify([edge.source, edge.sourceHandle])
    const target = JSON.stringify([edge.target, edge.targetHandle])
    const key = JSON.stringify([source, target].sort())
    groups.set(key, [...(groups.get(key) ?? []), edge])
  }
  const offsets = new Map<string, number>()
  for (const group of groups.values()) {
    group.forEach((edge, index) => {
      offsets.set(edge.id, (index - (group.length - 1) / 2) * 28)
    })
  }
  return edges.map((edge): DiagramFlowEdge => {
    const data: DiagramEdgeData = {
      label: edge.data?.label ?? '',
      color: edge.data?.color ?? '#536273',
      width: edge.data?.width ?? 2,
      line_style: edge.data?.line_style ?? 'solid',
      arrowheads: edge.data?.arrowheads ?? 'end',
      path_type: edge.data?.path_type ?? 'straight',
      bend_points: edge.data?.bend_points ?? [],
      parallel_offset: offsets.get(edge.id) ?? 0,
    }
    return { ...edge, data }
  })
}

export function graphToFlow(graph: GraphResponse) {
  const nodes: DiagramFlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: 'diagramNode',
    position: { x: node.x, y: node.y },
    style: { width: node.width, height: node.height },
    data: {
      shape_type: node.shape_type,
      label: node.label,
      annotation: node.annotation,
      width: node.width,
      height: node.height,
      visual_properties: node.visual_properties,
      z_index: node.z_index,
    },
    zIndex: node.z_index,
  }))
  const edges = withParallelOffsets(graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.source_port,
    targetHandle: edge.target_port,
    type: 'diagramEdge',
    data: {
      label: edge.label,
      color: edge.color,
      width: edge.width,
      line_style: edge.line_style,
      arrowheads: edge.arrowheads,
      path_type: edge.path_type,
      bend_points: edge.bend_points,
    },
  })))
  return { nodes, edges, viewport: graph.viewport }
}

export function snapshotToFlow(snapshot: GraphSnapshot, graph: GraphResponse) {
  return graphToFlow({
    ...graph,
    revision: snapshot.expected_revision,
    viewport: snapshot.viewport,
    nodes: snapshot.nodes,
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      source_port: edge.source_port,
      target_port: edge.target_port,
      label: edge.label,
      color: edge.color,
      width: edge.width,
      line_style: edge.line_style,
      arrowheads: edge.arrowheads,
      path_type: edge.path_type,
      bend_points: edge.bend_points,
    })),
  })
}

export function remapSnapshotIdentities(
  snapshot: GraphSnapshot,
  nodeIds: Map<string, string>,
  edgeIds: Map<string, string>,
  createId: () => string = () => crypto.randomUUID(),
) {
  const remapId = (id: string, identityMap: Map<string, string>) => {
    let mappedId = identityMap.get(id)
    if (!mappedId) {
      mappedId = createId()
      identityMap.set(id, mappedId)
    }
    return mappedId
  }

  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => ({ ...node, id: remapId(node.id, nodeIds) })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      id: remapId(edge.id, edgeIds),
      source: remapId(edge.source, nodeIds),
      target: remapId(edge.target, nodeIds),
    })),
  }
}

export function flowToSnapshot(
  nodes: DiagramFlowNode[],
  edges: DiagramFlowEdge[],
  viewport: Viewport,
  expectedRevision: number,
  title: string,
  description: string,
): GraphSnapshot {
  const graphNodes: GraphNodeRecord[] = nodes.map((node) => ({
    id: node.id,
    shape_type: node.data.shape_type,
    label: node.data.label,
    annotation: node.data.annotation,
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
    visual_properties: node.data.visual_properties,
    z_index: node.data.z_index,
  }))
  const graphEdges: GraphEdgeRecord[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    source_port: edge.sourceHandle ?? '',
    target_port: edge.targetHandle ?? '',
    label: edge.data?.label ?? '',
    color: edge.data?.color ?? '#536273',
    width: edge.data?.width ?? 2,
    line_style: edge.data?.line_style ?? 'solid',
    arrowheads: edge.data?.arrowheads ?? 'end',
    path_type: edge.data?.path_type ?? 'straight',
    bend_points: edge.data?.bend_points ?? [],
  }))
  return {
    expected_revision: expectedRevision,
    title,
    description,
    viewport,
    nodes: graphNodes,
    edges: graphEdges,
  }
}
