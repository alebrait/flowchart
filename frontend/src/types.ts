import type { Edge as XYEdge, Node as XYNode, Viewport } from '@xyflow/react'

export type ShapeType = 'action' | 'decision' | 'terminator' | 'hexagon' | 'text'
export type LineStyle = 'solid' | 'dashed'
export type Arrowheads = 'none' | 'start' | 'end' | 'both'
export type PathType = 'straight' | 'step'

export interface User {
  id: number
  username: string
  is_superuser: boolean
}

export interface DiagramSummary {
  id: string
  title: string
  description: string
  owner: { id: number; username: string }
  revision: number
  created_at: string
  updated_at: string
}

export interface VisualProperties {
  fill?: string
  stroke?: string
  text?: string
}

export interface GraphNodeRecord {
  id: string
  shape_type: ShapeType
  label: string
  annotation: string
  x: number
  y: number
  width: number
  height: number
  visual_properties: VisualProperties
  z_index: number
}

export interface GraphEdgeRecord {
  id: string
  source: string
  target: string
  source_port: string
  target_port: string
  label: string
  color: string
  width: number
  line_style: LineStyle
  arrowheads: Arrowheads
  path_type: PathType
  bend_points: { x: number; y: number }[]
}

export interface GraphResponse {
  diagram: DiagramSummary
  revision: number
  viewport: Viewport
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
}

export interface GraphSnapshot {
  expected_revision: number
  title: string
  description: string
  viewport: Viewport
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
}

export interface DiagramNodeData extends Record<string, unknown> {
  shape_type: ShapeType
  label: string
  annotation: string
  width: number
  height: number
  visual_properties: VisualProperties
  z_index: number
}

export interface DiagramEdgeData extends Record<string, unknown> {
  label: string
  color: string
  width: number
  line_style: LineStyle
  arrowheads: Arrowheads
  path_type: PathType
  bend_points: { x: number; y: number }[]
  parallel_offset?: number
}

export type DiagramFlowNode = XYNode<DiagramNodeData, 'diagramNode'>
export type DiagramFlowEdge = XYEdge<DiagramEdgeData, 'diagramEdge'>
