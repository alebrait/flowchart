import { createLoopRoute, polylineMidpoint } from './edgeRouting'
import { SHAPE_REGISTRY } from './shapes'
import type { DiagramFlowEdge, DiagramFlowNode } from '../types'

export type ExportBackground = 'transparent' | 'white'

interface Point {
  x: number
  y: number
}

interface EdgeGeometry {
  path: string
  labelPosition: Point
  bounds: Point[]
}

const EXPORT_PADDING = 32
const EDGE_LABEL_MAX_WIDTH = 180

function escapeXml(value: string) {
  let escaped = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (
      (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
      codePoint === 0xfffe ||
      codePoint === 0xffff
    ) {
      continue
    }
    if (character === '&') escaped += '&amp;'
    else if (character === '<') escaped += '&lt;'
    else if (character === '>') escaped += '&gt;'
    else if (character === '"') escaped += '&quot;'
    else if (character === "'") escaped += '&apos;'
    else escaped += character
  }
  return escaped
}

function number(value: number) {
  return String(Number(value.toFixed(2)))
}

function pointPath(points: Point[]) {
  return `M ${points.map((point) => `${number(point.x)} ${number(point.y)}`).join(' L ')}`
}

function glyphWidth(character: string, fontSize: number) {
  if (/\s/.test(character)) return fontSize * 0.32
  if (/[ilI.,'`|!]/.test(character)) return fontSize * 0.3
  if (/[MW@#%&]/.test(character)) return fontSize * 0.84
  if ((character.codePointAt(0) ?? 0) > 0xff) return fontSize
  return fontSize * 0.56
}

function splitLongWord(word: string, width: number, fontSize: number) {
  const segments: string[] = []
  let segment = ''
  let segmentWidth = 0
  for (const character of word) {
    const nextWidth = glyphWidth(character, fontSize)
    if (segment && segmentWidth + nextWidth > width) {
      segments.push(segment)
      segment = ''
      segmentWidth = 0
    }
    segment += character
    segmentWidth += nextWidth
  }
  if (segment) segments.push(segment)
  return segments
}

function wrapText(text: string, width: number, fontSize: number) {
  if (!text) return []
  const lines: string[] = []
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = ''
    let lineWidth = 0
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const wordWidth = [...word].reduce(
        (total, character) => total + glyphWidth(character, fontSize),
        0,
      )
      const spaceWidth = line ? glyphWidth(' ', fontSize) : 0
      if (line && lineWidth + spaceWidth + wordWidth <= width) {
        line += ` ${word}`
        lineWidth += spaceWidth + wordWidth
        continue
      }
      if (line) lines.push(line)
      const segments = splitLongWord(word, width, fontSize)
      lines.push(...segments.slice(0, -1))
      line = segments.at(-1) ?? ''
      lineWidth = [...line].reduce(
        (total, character) => total + glyphWidth(character, fontSize),
        0,
      )
    }
    lines.push(line)
  }
  return lines
}

function svgTextLines(
  lines: string[],
  x: number,
  startY: number,
  lineHeight: number,
  color: string,
  fontSize: number,
  weight: number,
) {
  if (!lines.length) return ''
  const spans = lines
    .map(
      (line, index) =>
        `<tspan x="${number(x)}" y="${number(startY + index * lineHeight)}">${escapeXml(line)}</tspan>`,
    )
    .join('')
  return `<text fill="${escapeXml(color)}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${number(fontSize)}" font-weight="${weight}" text-anchor="middle">${spans}</text>`
}

function shapePoints(node: DiagramFlowNode, inset = 0) {
  const x = node.position.x + inset
  const y = node.position.y + inset
  const width = node.data.width - inset * 2
  const height = node.data.height - inset * 2
  const centerX = x + width / 2
  const centerY = y + height / 2
  if (node.data.shape_type === 'decision') {
    return [
      { x: centerX, y },
      { x: x + width, y: centerY },
      { x: centerX, y: y + height },
      { x, y: centerY },
    ]
  }
  return [
    { x: x + width * 0.25, y },
    { x: x + width * 0.75, y },
    { x: x + width, y: centerY },
    { x: x + width * 0.75, y: y + height },
    { x: x + width * 0.25, y: y + height },
    { x, y: centerY },
  ]
}

function pointsAttribute(points: Point[]) {
  return points.map((point) => `${number(point.x)},${number(point.y)}`).join(' ')
}

function shapeSvg(node: DiagramFlowNode, index: number) {
  const { x, y } = node.position
  const { width, height, shape_type: shape, visual_properties: properties } = node.data
  const definition = SHAPE_REGISTRY[shape]
  const fill = properties.fill ?? definition.defaults.fill
  const stroke = properties.stroke ?? definition.defaults.stroke
  const textColor = properties.text ?? definition.defaults.text
  const centerX = x + width / 2
  const centerY = y + height / 2
  const clipId = `node-clip-${index}`
  let surface: string
  let clipShape: string

  if (shape === 'decision' || shape === 'hexagon') {
    const outerPoints = shapePoints(node)
    const innerPoints = shapePoints(node, 1.5)
    const polygon = `<polygon points="${pointsAttribute(outerPoints)}"/>`
    surface = `<polygon points="${pointsAttribute(outerPoints)}" fill="${escapeXml(stroke)}"/><polygon points="${pointsAttribute(innerPoints)}" fill="${escapeXml(fill)}"/>`
    clipShape = polygon
  } else if (shape === 'terminator') {
    const radius = Math.min(width, height) / 2
    surface = `<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" rx="${number(radius)}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="1.5"/>`
    clipShape = `<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" rx="${number(radius)}"/>`
  } else {
    const dash = shape === 'text' ? ' stroke-dasharray="5 4"' : ''
    const radius = shape === 'text' ? 3 : 7
    surface = `<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" rx="${radius}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="1.5"${dash}/>`
    clipShape = `<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" rx="${radius}"/>`
  }

  const textWidth =
    shape === 'decision' ? Math.max(20, Math.min(width - 24, height * 0.82)) : width - 24
  const labelLines = wrapText(node.data.label, textWidth, 13)
  const annotationLines = wrapText(node.data.annotation, textWidth, 10.14)
  const labelHeight = labelLines.length * 16.25
  const annotationHeight = annotationLines.length * 12.7
  const gap = labelLines.length && annotationLines.length ? 4 : 0
  const textHeight = labelHeight + annotationHeight + gap
  let cursorY = centerY - textHeight / 2
  const label = svgTextLines(
    labelLines,
    centerX,
    cursorY + 8.125,
    16.25,
    textColor,
    13,
    700,
  )
  cursorY += labelHeight + gap
  const annotation = svgTextLines(
    annotationLines,
    centerX,
    cursorY + 6.35,
    12.7,
    textColor,
    10.14,
    400,
  )

  return `<g><defs><clipPath id="${clipId}">${clipShape}</clipPath></defs>${surface}<g clip-path="url(#${clipId})">${label}${annotation}</g></g>`
}

function getPort(node: DiagramFlowNode, portId: string | null | undefined) {
  const port =
    SHAPE_REGISTRY[node.data.shape_type].ports.find((item) => item.id === portId) ??
    SHAPE_REGISTRY[node.data.shape_type].ports[0]
  return {
    point: {
      x: node.position.x + node.data.width * port.x,
      y: node.position.y + node.data.height * port.y,
    },
    side: port.position,
  }
}

function edgeGeometry(
  edge: DiagramFlowEdge,
  nodesById: Map<string, DiagramFlowNode>,
): EdgeGeometry | null {
  const source = nodesById.get(edge.source)
  const target = nodesById.get(edge.target)
  if (!source || !target) return null
  const sourcePort = getPort(source, edge.sourceHandle)
  const targetPort = getPort(target, edge.targetHandle)
  const start = sourcePort.point
  const end = targetPort.point
  const data = edge.data
  const bendPoints = data?.bend_points ?? []
  const offset = data?.parallel_offset ?? 0

  if (edge.source === edge.target) {
    const route = createLoopRoute(
      start,
      end,
      {
        x: source.position.x,
        y: source.position.y,
        width: source.data.width,
        height: source.data.height,
      },
      sourcePort.side,
      targetPort.side,
      offset,
    )
    const bounds = [
      start,
      end,
      { x: source.position.x - 30 - Math.abs(offset), y: source.position.y - 30 - Math.abs(offset) },
      {
        x: source.position.x + source.data.width + 30 + Math.abs(offset),
        y: source.position.y + source.data.height + 30 + Math.abs(offset),
      },
    ]
    return { path: route.path, labelPosition: route.labelPosition, bounds }
  }

  if (data?.path_type === 'step') {
    let currentY = start.y
    const route: Point[] = [{ x: start.x, y: start.y }]
    for (const point of bendPoints) {
      const x = point.x + offset
      route.push({ x, y: currentY }, { x, y: point.y })
      currentY = point.y
    }
    if (!bendPoints.length) {
      const laneX = (start.x + end.x) / 2 + offset
      route.push({ x: laneX, y: start.y }, { x: laneX, y: end.y })
    }
    route.push({ x: end.x, y: currentY }, { x: end.x, y: end.y })
    return { path: pointPath(route), labelPosition: polylineMidpoint(route), bounds: route }
  }

  if (bendPoints.length) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy) || 1
    const normalX = -dy / length
    const normalY = dx / length
    const route = [
      start,
      ...bendPoints.map((point) => ({
        x: point.x + normalX * offset,
        y: point.y + normalY * offset,
      })),
      end,
    ]
    return { path: pointPath(route), labelPosition: polylineMidpoint(route), bounds: route }
  }

  if (offset === 0) {
    return {
      path: pointPath([start, end]),
      labelPosition: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      bounds: [start, end],
    }
  }

  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  const control = {
    x: (start.x + end.x) / 2 - (dy / length) * offset,
    y: (start.y + end.y) / 2 + (dx / length) * offset,
  }
  return {
    path: `M ${number(start.x)} ${number(start.y)} Q ${number(control.x)} ${number(control.y)} ${number(end.x)} ${number(end.y)}`,
    labelPosition: {
      x: (start.x + 2 * control.x + end.x) / 4,
      y: (start.y + 2 * control.y + end.y) / 4,
    },
    bounds: [start, control, end],
  }
}

function textWidth(text: string, fontSize: number) {
  return [...text].reduce((total, character) => total + glyphWidth(character, fontSize), 0)
}

function edgeLabelSvg(label: string, position: Point) {
  const lines = wrapText(label, EDGE_LABEL_MAX_WIDTH - 14, 11.5)
  const lineHeight = 14
  const width = Math.min(
    EDGE_LABEL_MAX_WIDTH,
    Math.max(20, ...lines.map((line) => textWidth(line, 11.5) + 14)),
  )
  const height = Math.max(18, lines.length * lineHeight + 6)
  const x = position.x - width / 2
  const y = position.y - height / 2
  const text = lines
    .map(
      (line, lineIndex) =>
        `<tspan x="${number(position.x)}" y="${number(y + 12 + lineIndex * lineHeight)}">${escapeXml(line)}</tspan>`,
    )
    .join('')
  return {
    svg: `<g><rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" rx="4" fill="#ffffff" fill-opacity="0.94" stroke="#d6dfe5"/><text fill="#20262e" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="11.5" text-anchor="middle">${text}</text></g>`,
    bounds: [{ x, y }, { x: x + width, y: y + height }],
  }
}

export function buildDiagramSvg(
  nodes: DiagramFlowNode[],
  edges: DiagramFlowEdge[],
  title: string,
  background: ExportBackground = 'transparent',
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const geometries = edges.map((edge) => edgeGeometry(edge, nodesById))
  const bounds = nodes.flatMap((node) => [
    node.position,
    { x: node.position.x + node.data.width, y: node.position.y + node.data.height },
  ])
  for (const geometry of geometries) {
    if (geometry) bounds.push(...geometry.bounds)
  }
  edges.forEach((edge, index) => {
    const geometry = geometries[index]
    if (!geometry) return
    const markerPadding =
      edge.data?.arrowheads && edge.data.arrowheads !== 'none'
        ? (edge.data.width ?? 2) * 8
        : (edge.data?.width ?? 2) / 2
    for (const point of geometry.bounds) {
      bounds.push(
        { x: point.x - markerPadding, y: point.y - markerPadding },
        { x: point.x + markerPadding, y: point.y + markerPadding },
      )
    }
  })

  const labels = edges.map((edge, index) => {
    const geometry = geometries[index]
    if (!geometry || !edge.data?.label) return null
    const label = edgeLabelSvg(edge.data.label, geometry.labelPosition)
    bounds.push(...label.bounds)
    return label.svg
  })

  if (!bounds.length) bounds.push({ x: 0, y: 0 }, { x: 640, y: 360 })
  const extrema = bounds.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.x),
      minY: Math.min(result.minY, point.y),
      maxX: Math.max(result.maxX, point.x),
      maxY: Math.max(result.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
  const minX = extrema.minX - EXPORT_PADDING
  const minY = extrema.minY - EXPORT_PADDING
  const maxX = extrema.maxX + EXPORT_PADDING
  const maxY = extrema.maxY + EXPORT_PADDING
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const backgroundRect =
    background === 'white'
      ? `<rect x="${number(minX)}" y="${number(minY)}" width="${number(width)}" height="${number(height)}" fill="#ffffff"/>`
      : ''
  const edgeSvg = edges
    .map((edge, index) => {
      const geometry = geometries[index]
      if (!geometry) return ''
      const data = edge.data
      const markerId = `edge-arrow-${index}`
      const markerStart =
        data?.arrowheads === 'start' || data?.arrowheads === 'both'
          ? ` marker-start="url(#${markerId})"`
          : ''
      const markerEnd =
        data?.arrowheads === 'end' || data?.arrowheads === 'both'
          ? ` marker-end="url(#${markerId})"`
          : ''
      const dash = data?.line_style === 'dashed' ? ' stroke-dasharray="7 5"' : ''
      const path = `<path d="${geometry.path}" fill="none" stroke="${escapeXml(data?.color ?? '#536273')}" stroke-width="${number(data?.width ?? 2)}"${dash}${markerStart}${markerEnd}/>`
      return `${path}${labels[index] ?? ''}`
    })
    .join('')
  const nodeSvg = [...nodes]
    .map((node, index) => ({ node, index }))
    .sort((a, b) => (a.node.zIndex ?? a.node.data.z_index) - (b.node.zIndex ?? b.node.data.z_index))
    .map(({ node, index }) => shapeSvg(node, index))
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="${number(minX)} ${number(minY)} ${number(width)} ${number(height)}" role="img" aria-labelledby="diagram-title"><title id="diagram-title">${escapeXml(title)}</title><desc>Exported flowchart diagram</desc><defs>${edges
    .map((edge, index) => {
      const color = edge.data?.color ?? '#536273'
      return edge.data?.arrowheads && edge.data.arrowheads !== 'none'
        ? `<marker id="edge-arrow-${index}" markerHeight="8" markerWidth="8" markerUnits="strokeWidth" orient="auto-start-reverse" refX="7" refY="4" viewBox="0 0 8 8"><path d="M 0 0 L 8 4 L 0 8 z" fill="${escapeXml(color)}"/></marker>`
        : ''
    })
    .join('')}</defs>${backgroundRect}${edgeSvg}${nodeSvg}</svg>`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function createPngBlob(svg: string, background: ExportBackground) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('The diagram could not be rendered for PNG export.'))
      image.src = url
    })

    const width = Number(image.width)
    const height = Number(image.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('The diagram has invalid dimensions and cannot be exported.')
    }
    const scale = Math.min(2, 8192 / Math.max(width, height), Math.sqrt(32_000_000 / (width * height)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(width * scale))
    canvas.height = Math.max(1, Math.floor(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('PNG export is unavailable in this browser.')
    if (background === 'white') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('The browser could not encode the PNG export.'))
        },
        'image/png',
      )
    })
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function safeExportFilename(title: string, extension: 'svg' | 'png') {
  const sanitized = [...title.normalize('NFKC')]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return /[<>:"/\\|?*]/.test(character) || codePoint < 0x20 ? '-' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
  return `${sanitized || 'diagram'}.${extension}`
}
