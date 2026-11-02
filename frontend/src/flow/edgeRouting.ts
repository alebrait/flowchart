import { Position } from '@xyflow/react'

export interface RoutePoint {
  x: number
  y: number
}

export interface NodeBounds {
  x: number
  y: number
  width: number
  height: number
}

export function polylineMidpoint(points: RoutePoint[]) {
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point.x - points[index].x, point.y - points[index].y),
  )
  const halfLength = lengths.reduce((sum, length) => sum + length, 0) / 2
  let distance = 0
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (distance + length >= halfLength) {
      const start = points[index]
      const end = points[index + 1]
      const fraction = length === 0 ? 0 : (halfLength - distance) / length
      return {
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      }
    }
    distance += length
  }
  return points[0]
}

export function createLoopRoute(
  start: RoutePoint,
  end: RoutePoint,
  bounds: NodeBounds,
  sourceSide: Position,
  targetSide: Position,
  offset: number,
) {
  const padding = 30 + Math.abs(offset)
  const left = bounds.x - padding
  const right = bounds.x + bounds.width + padding
  const top = bounds.y - padding
  const bottom = bounds.y + bounds.height + padding
  const width = right - left
  const height = bottom - top
  const perimeter = 2 * (width + height)
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.max(minimum, Math.min(maximum, value))

  function project(point: RoutePoint, side: Position): RoutePoint {
    if (side === Position.Top) return { x: clamp(point.x, left, right), y: top }
    if (side === Position.Right) return { x: right, y: clamp(point.y, top, bottom) }
    if (side === Position.Bottom) return { x: clamp(point.x, left, right), y: bottom }
    return { x: left, y: clamp(point.y, top, bottom) }
  }

  function distanceAlong(point: RoutePoint, side: Position) {
    if (side === Position.Top) return point.x - left
    if (side === Position.Right) return width + point.y - top
    if (side === Position.Bottom) return width + height + right - point.x
    return 2 * width + height + bottom - point.y
  }

  function pointAt(distance: number): RoutePoint {
    const normalized = ((distance % perimeter) + perimeter) % perimeter
    if (normalized <= width) return { x: left + normalized, y: top }
    if (normalized <= width + height) {
      return { x: right, y: top + normalized - width }
    }
    if (normalized <= 2 * width + height) {
      return { x: right - (normalized - width - height), y: bottom }
    }
    return { x: left, y: bottom - (normalized - 2 * width - height) }
  }

  const sourceOutside = project(start, sourceSide)
  const targetOutside = project(end, targetSide)
  const sourceDistance = distanceAlong(sourceOutside, sourceSide)
  const targetDistance = distanceAlong(targetOutside, targetSide)
  let routeDistance = (targetDistance - sourceDistance + perimeter) % perimeter
  if (routeDistance < 1) routeDistance = perimeter

  const route: RoutePoint[] = [start, sourceOutside]
  const corners = [width, width + height, 2 * width + height, perimeter]
  for (let lap = 0; lap <= 1; lap += 1) {
    for (const corner of corners) {
      const cornerDistance = corner + lap * perimeter
      if (
        cornerDistance > sourceDistance &&
        cornerDistance < sourceDistance + routeDistance
      ) {
        route.push(pointAt(cornerDistance))
      }
    }
  }
  route.push(targetOutside, end)
  const path = `M ${route.map((point) => `${point.x} ${point.y}`).join(' L ')}`
  return { path, labelPosition: polylineMidpoint(route) }
}
