import { Position } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { ShapeType, VisualProperties } from '../types'

export interface ShapePort {
  id: string
  x: number
  y: number
  position: Position
}

export interface ShapeDefinition {
  label: string
  minWidth: number
  minHeight: number
  className: string
  ports: ShapePort[]
  defaults: { fill: string; stroke: string; text: string }
}

const cardinalPorts: ShapePort[] = [
  { id: 'top', x: 0.5, y: 0, position: Position.Top },
  { id: 'right', x: 1, y: 0.5, position: Position.Right },
  { id: 'bottom', x: 0.5, y: 1, position: Position.Bottom },
  { id: 'left', x: 0, y: 0.5, position: Position.Left },
]

const hexagonPorts: ShapePort[] = [
  { id: 'top', x: 0.5, y: 0, position: Position.Top },
  { id: 'upper-right', x: 0.86, y: 0.25, position: Position.Right },
  { id: 'lower-right', x: 0.86, y: 0.75, position: Position.Right },
  { id: 'bottom', x: 0.5, y: 1, position: Position.Bottom },
  { id: 'lower-left', x: 0.14, y: 0.75, position: Position.Left },
  { id: 'upper-left', x: 0.14, y: 0.25, position: Position.Left },
]

const neutral = { fill: '#ffffff', stroke: '#687887', text: '#20262e' }

export const SHAPE_REGISTRY = {
  action: {
    label: 'Action',
    minWidth: 120,
    minHeight: 64,
    className: 'shape-action',
    ports: cardinalPorts,
    defaults: neutral,
  },
  decision: {
    label: 'Decision',
    minWidth: 112,
    minHeight: 92,
    className: 'shape-decision',
    ports: cardinalPorts,
    defaults: { fill: '#f5f8fc', stroke: '#687887', text: '#20262e' },
  },
  terminator: {
    label: 'Start / end',
    minWidth: 120,
    minHeight: 64,
    className: 'shape-terminator',
    ports: cardinalPorts,
    defaults: { fill: '#edf5ef', stroke: '#5e8069', text: '#20262e' },
  },
  hexagon: {
    label: 'Hexagon',
    minWidth: 136,
    minHeight: 78,
    className: 'shape-hexagon',
    ports: hexagonPorts,
    defaults: { fill: '#f7f4ed', stroke: '#8c7957', text: '#20262e' },
  },
  text: {
    label: 'Text note',
    minWidth: 100,
    minHeight: 56,
    className: 'shape-text',
    ports: cardinalPorts,
    defaults: { fill: '#fff8db', stroke: '#b39a45', text: '#20262e' },
  },
} satisfies Record<ShapeType, ShapeDefinition>

export function shapeStyle(shape: ShapeType, properties: VisualProperties): CSSProperties {
  const defaults = SHAPE_REGISTRY[shape].defaults
  return {
    '--shape-fill': properties.fill ?? defaults.fill,
    '--shape-stroke': properties.stroke ?? defaults.stroke,
    '--shape-text': properties.text ?? defaults.text,
  } as CSSProperties
}
