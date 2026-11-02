import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type EdgeProps,
  type EdgeMouseHandler,
  type OnReconnect,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { api, ApiError } from './api'
import {
  flowToSnapshot,
  graphToFlow,
  remapSnapshotIdentities,
  snapshotToFlow,
  withParallelOffsets,
} from './flow/graphSerialization'
import { createLoopRoute, polylineMidpoint } from './flow/edgeRouting'
import { EditorHistory } from './flow/editorHistory'
import { saveUntilCurrent } from './flow/saveSequencing'
import {
  buildDiagramSvg,
  createPngBlob,
  downloadBlob,
  safeExportFilename,
  type ExportBackground,
} from './flow/diagramExport'
import {
  readRecoveryDraft,
  recoveryDraftDiffers,
  removeRecoveryDraft,
  writeRecoveryDraft,
} from './flow/recoveryDrafts'
import { SHAPE_REGISTRY, shapeStyle } from './flow/shapes'
import type { ShapePort } from './flow/shapes'
import type { EditorHistorySnapshot } from './flow/editorHistory'
import type { RecoveryDraft } from './flow/recoveryDrafts'
import type {
  DiagramFlowEdge,
  DiagramFlowNode,
  DiagramEdgeData,
  DiagramSummary,
  GraphResponse,
  ShapeType,
  User,
  VisualProperties,
} from './types'

interface EditorProps {
  diagram: DiagramSummary
  user: User
  onBack: () => void
  onOpenDiagram: (id: string) => void
  onSessionExpired: (message: string) => void
  onDiagramChanged: (diagram: DiagramSummary) => void
}

type SaveState = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'

interface ResizeContextValue {
  beginGesture: () => void
  finish: (nodeId: string, width: number, height: number) => void
}

const ResizeContext = createContext<ResizeContextValue>({
  beginGesture: () => undefined,
  finish: () => undefined,
})
interface BendContextValue {
  beginGesture: () => void
  update: (edgeId: string, pointIndex: number, point: { x: number; y: number }) => void
  endGesture: () => void
}

const BendContext = createContext<BendContextValue>({
  beginGesture: () => undefined,
  update: () => undefined,
  endGesture: () => undefined,
})

function portStyle(port: ShapePort) {
  return {
    left: `${port.x * 100}%`,
    top: `${port.y * 100}%`,
    transform: 'translate(-50%, -50%)',
  }
}

function DiagramNodeView({
  id,
  data,
  selected,
}: {
  id: string
  data: DiagramFlowNode['data']
  selected: boolean
}) {
  const resize = useContext(ResizeContext)
  const definition = SHAPE_REGISTRY[data.shape_type]
  const style = shapeStyle(data.shape_type, data.visual_properties)

  return (
    <div className={`diagram-node ${definition.className}`} style={style}>
      <NodeResizer
        isVisible={selected}
        minWidth={definition.minWidth}
        minHeight={definition.minHeight}
        onResizeStart={resize.beginGesture}
        onResizeEnd={(_event, dimensions) => resize.finish(id, dimensions.width, dimensions.height)}
      />
      <div className="shape-surface">
        <div className="node-copy">
          <span className="node-label">{data.label}</span>
          {data.annotation && <span className="node-annotation">{data.annotation}</span>}
        </div>
      </div>
      {definition.ports.map((port) => (
        <span className="port-pair" key={port.id} style={portStyle(port)}>
          <Handle
            className="diagram-port port-target"
            id={port.id}
            position={port.position}
            type="target"
          />
          <Handle
            className="diagram-port port-source"
            id={port.id}
            position={port.position}
            type="source"
          />
        </span>
      ))}
    </div>
  )
}

const nodeTypes = { diagramNode: DiagramNodeView }

function DiagramEdgeView(props: EdgeProps<DiagramFlowEdge>) {
  const data = props.data
  const bendPoints = data?.bend_points ?? []
  const offset = data?.parallel_offset ?? 0
  const { getNode } = useReactFlow<DiagramFlowNode, DiagramFlowEdge>()
  let path: string
  let labelPosition: { x: number; y: number }
  if (props.source === props.target) {
    const node = getNode(props.source)
    const width = node?.measured?.width ?? node?.width ?? node?.data.width
    const height = node?.measured?.height ?? node?.height ?? node?.data.height
    if (node && width && height) {
      const route = createLoopRoute(
        { x: props.sourceX, y: props.sourceY },
        { x: props.targetX, y: props.targetY },
        { ...node.position, width, height },
        props.sourcePosition ?? Position.Right,
        props.targetPosition ?? Position.Left,
        offset,
      )
      path = route.path
      labelPosition = route.labelPosition
    } else {
      path = `M ${props.sourceX} ${props.sourceY} C ${props.sourceX + 46} ${props.sourceY - 46}, ${props.targetX + 46} ${props.targetY + 46}, ${props.targetX} ${props.targetY}`
      labelPosition = {
        x: (props.sourceX + props.targetX) / 2 + 34.5,
        y: (props.sourceY + props.targetY) / 2,
      }
    }
  } else if (data?.path_type === 'step') {
    let currentY = props.sourceY
    const route = [{ x: props.sourceX, y: props.sourceY }]
    for (const point of bendPoints) {
      const x = point.x + offset
      route.push({ x, y: currentY }, { x, y: point.y })
      currentY = point.y
    }
    if (bendPoints.length === 0) {
      const laneX = (props.sourceX + props.targetX) / 2 + offset
      route.push({ x: laneX, y: props.sourceY }, { x: laneX, y: props.targetY })
    }
    route.push({ x: props.targetX, y: currentY }, { x: props.targetX, y: props.targetY })
    path = `M ${route.map((point) => `${point.x} ${point.y}`).join(' L ')}`
    labelPosition = polylineMidpoint(route)
  } else if (bendPoints.length) {
    const dx = props.targetX - props.sourceX
    const dy = props.targetY - props.sourceY
    const length = Math.hypot(dx, dy) || 1
    const normalX = -dy / length
    const normalY = dx / length
    const route = [
      { x: props.sourceX, y: props.sourceY },
      ...bendPoints.map((point) => ({
        x: point.x + normalX * offset,
        y: point.y + normalY * offset,
      })),
      { x: props.targetX, y: props.targetY },
    ]
    path = `M ${route.map((point) => `${point.x} ${point.y}`).join(' L ')}`
    labelPosition = polylineMidpoint(route)
  } else if (offset === 0) {
    path = `M ${props.sourceX} ${props.sourceY} L ${props.targetX} ${props.targetY}`
    labelPosition = {
      x: (props.sourceX + props.targetX) / 2,
      y: (props.sourceY + props.targetY) / 2,
    }
  } else {
    const dx = props.targetX - props.sourceX
    const dy = props.targetY - props.sourceY
    const length = Math.hypot(dx, dy) || 1
    const controlX = (props.sourceX + props.targetX) / 2 - (dy / length) * offset
    const controlY = (props.sourceY + props.targetY) / 2 + (dx / length) * offset
    path = `M ${props.sourceX} ${props.sourceY} Q ${controlX} ${controlY} ${props.targetX} ${props.targetY}`
    labelPosition = {
      x: (props.sourceX + 2 * controlX + props.targetX) / 4,
      y: (props.sourceY + 2 * controlY + props.targetY) / 4,
    }
  }
  const markerId = `arrow-${props.id}`
  const markerStart =
    data?.arrowheads === 'start' || data?.arrowheads === 'both'
      ? `url(#${markerId})`
      : undefined
  const markerEnd =
    data?.arrowheads === 'end' || data?.arrowheads === 'both'
      ? `url(#${markerId})`
      : undefined

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerHeight="8"
          markerWidth="8"
          orient="auto-start-reverse"
          refX="7"
          refY="4"
          viewBox="0 0 8 8"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill={data?.color ?? '#536273'} />
        </marker>
      </defs>
      <BaseEdge
        id={props.id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{
          stroke: data?.color ?? '#536273',
          strokeWidth: data?.width ?? 2,
          strokeDasharray: data?.line_style === 'dashed' ? '7 5' : undefined,
        }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="edge-label nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelPosition.x}px,${labelPosition.y}px)`,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {props.selected &&
        bendPoints.map((point, index) => (
          <BendPointControl
            edgeId={props.id}
            index={index}
            key={`${props.id}-bend-${index}`}
            point={point}
          />
        ))}
    </>
  )
}

function BendPointControl({
  edgeId,
  index,
  point,
}: {
  edgeId: string
  index: number
  point: { x: number; y: number }
}) {
  const bend = useContext(BendContext)
  const { screenToFlowPosition } = useReactFlow<DiagramFlowNode, DiagramFlowEdge>()
  const [dragging, setDragging] = useState(false)
  return (
    <EdgeLabelRenderer>
      <button
        aria-label={`Drag bend point ${index + 1}`}
        className="bend-point nodrag nopan"
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          bend.beginGesture()
          setDragging(true)
        }}
        onPointerMove={(event) => {
          if (!dragging) return
          const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          bend.update(edgeId, index, position)
        }}
        onPointerUp={(event) => {
          setDragging(false)
          bend.endGesture()
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={() => {
          setDragging(false)
          bend.endGesture()
        }}
        style={{ transform: `translate(-50%, -50%) translate(${point.x}px,${point.y}px)` }}
        type="button"
      />
    </EdgeLabelRenderer>
  )
}

const edgeTypes = { diagramEdge: DiagramEdgeView }

function newNode(shape: ShapeType, x: number, y: number): DiagramFlowNode {
  const definition = SHAPE_REGISTRY[shape]
  return {
    id: crypto.randomUUID(),
    type: 'diagramNode',
    selected: true,
    position: { x, y },
    style: { width: Math.max(definition.minWidth, 160), height: Math.max(definition.minHeight, 80) },
    data: {
      shape_type: shape,
      label: '',
      annotation: '',
      width: Math.max(definition.minWidth, 160),
      height: Math.max(definition.minHeight, 80),
      visual_properties: {},
      z_index: 0,
    },
  }
}

function defaultEdge(connection: Connection): DiagramFlowEdge | null {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return null
  }
  return {
    id: crypto.randomUUID(),
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
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
}

const EMPTY_EDGE_DATA: NonNullable<DiagramFlowEdge['data']> = {
  label: '',
  color: '#536273',
  width: 2,
  line_style: 'solid',
  arrowheads: 'end',
  path_type: 'straight',
  bend_points: [],
}

function EditorCanvas({
  diagram,
  user,
  onBack,
  onOpenDiagram,
  onSessionExpired,
  onDiagramChanged,
}: EditorProps) {
  const [nodes, setNodes] = useNodesState<DiagramFlowNode>([])
  const [edges, setEdges] = useEdgesState<DiagramFlowEdge>([])
  const [title, setTitle] = useState(diagram.title)
  const [description, setDescription] = useState(diagram.description)
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [error, setError] = useState('')
  const [editVersion, setEditVersion] = useState(0)
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })
  const [recoveryOffer, setRecoveryOffer] = useState<RecoveryDraft | null>(null)
  const [storageWarning, setStorageWarning] = useState('')
  const [copying, setCopying] = useState(false)
  const [exportBackground, setExportBackground] = useState<ExportBackground>('transparent')
  const [exportError, setExportError] = useState('')
  const [selectedIds, setSelectedIds] = useState<{ node: string | null; edge: string | null }>({
    node: null,
    edge: null,
  })
  const saveStateRef = useRef(saveState)
  const revisionRef = useRef(diagram.revision)
  const editVersionRef = useRef(0)
  const savePromiseRef = useRef<Promise<void> | null>(null)
  const historyRef = useRef(new EditorHistory())
  const pendingEdgeRemovalRef = useRef<{
    snapshot: EditorHistorySnapshot
    timer: number
  } | null>(null)
  const serverGraphRef = useRef<GraphResponse | null>(null)
  const latestContentRef = useRef({ nodes, edges, viewport, title, description })
  const { fitView, getViewport } = useReactFlow<DiagramFlowNode, DiagramFlowEdge>()

  useLayoutEffect(() => {
    latestContentRef.current = { nodes, edges, viewport, title, description }
  }, [nodes, edges, viewport, title, description])

  const transitionSaveState = useCallback((next: SaveState) => {
    saveStateRef.current = next
    setSaveState(next)
  }, [])

  const currentHistorySnapshot = useCallback(
    (): EditorHistorySnapshot => ({
      nodes: [...latestContentRef.current.nodes],
      edges: [...latestContentRef.current.edges],
    }),
    [],
  )

  const refreshHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: historyRef.current.canUndo,
      canRedo: historyRef.current.canRedo,
    })
  }, [])

  const recordHistorySnapshot = useCallback((snapshot: EditorHistorySnapshot) => {
    historyRef.current.record(snapshot)
    refreshHistoryState()
  }, [refreshHistoryState])

  const recordHistory = useCallback(() => {
    recordHistorySnapshot(currentHistorySnapshot())
  }, [currentHistorySnapshot, recordHistorySnapshot])

  const beginHistoryGesture = useCallback(() => {
    historyRef.current.beginGesture(currentHistorySnapshot())
    refreshHistoryState()
  }, [currentHistorySnapshot, refreshHistoryState])

  const markUnsaved = useCallback(() => {
    editVersionRef.current += 1
    setEditVersion(editVersionRef.current)
    if (saveStateRef.current !== 'conflict' && saveStateRef.current !== 'saving') {
      transitionSaveState('unsaved')
      setError('')
    }
  }, [transitionSaveState])

  useEffect(() => {
    let active = true
    api
      .get<GraphResponse>(`/diagrams/${diagram.id}/graph/`)
      .then((graph) => {
        if (!active) return
        serverGraphRef.current = graph
        const flow = graphToFlow(graph)
        setNodes(flow.nodes)
        setEdges(flow.edges)
        setViewport(graph.viewport)
        revisionRef.current = graph.revision
        setTitle(graph.diagram.title)
        setDescription(graph.diagram.description)
        historyRef.current.clear()
        refreshHistoryState()
        const serverSnapshot = flowToSnapshot(
          flow.nodes,
          flow.edges,
          graph.viewport,
          graph.revision,
          graph.diagram.title,
          graph.diagram.description,
        )
        try {
          const draft = readRecoveryDraft(window.localStorage, user.id, diagram.id)
          if (draft && recoveryDraftDiffers(draft.snapshot, serverSnapshot)) {
            setRecoveryOffer(draft)
          } else if (draft) {
            removeRecoveryDraft(window.localStorage, user.id, diagram.id)
          }
        } catch (storageError) {
          setStorageWarning(
            storageError instanceof Error
              ? `Browser recovery storage is unavailable: ${storageError.message}`
              : 'Browser recovery storage is unavailable.',
          )
        }
        setLoaded(true)
        transitionSaveState('saved')
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load this diagram.')
        transitionSaveState('error')
      })
    return () => {
      active = false
    }
  }, [diagram.id, user.id, refreshHistoryState, setEdges, setNodes, transitionSaveState])

  useEffect(() => {
    if (!loaded || saveState === 'saved' || saveState === 'loading') return
    const timer = window.setTimeout(() => {
      const current = latestContentRef.current
      const snapshot = flowToSnapshot(
        current.nodes,
        current.edges,
        current.viewport,
        revisionRef.current,
        current.title,
        current.description,
      )
      try {
        writeRecoveryDraft(window.localStorage, {
          user_id: user.id,
          diagram_id: diagram.id,
          base_revision: revisionRef.current,
          snapshot,
          updated_at: new Date().toISOString(),
        })
        setStorageWarning('')
      } catch (storageError) {
        setStorageWarning(
          storageError instanceof Error
            ? `Browser recovery storage is unavailable: ${storageError.message}`
            : 'Browser recovery storage is unavailable.',
        )
      }
    }, 200)
    return () => window.clearTimeout(timer)
  }, [diagram.id, editVersion, loaded, saveState, user.id])

  const onNodesChange = useCallback(
    (changes: NodeChange<DiagramFlowNode>[]) => {
      const positionChanges = changes.filter((change) => change.type === 'position')
      if (positionChanges.some((change) => change.type === 'position' && change.dragging)) {
        beginHistoryGesture()
      } else if (positionChanges.length && !historyRef.current.hasOpenGesture) {
        recordHistory()
      }
      setNodes((current) => applyNodeChanges(changes, current))
      const removed = changes.flatMap((change) =>
        change.type === 'remove' ? [change.id] : [],
      )
      if (removed.length) {
        const pendingRemoval = pendingEdgeRemovalRef.current
        if (pendingRemoval) {
          window.clearTimeout(pendingRemoval.timer)
          pendingEdgeRemovalRef.current = null
          recordHistorySnapshot(pendingRemoval.snapshot)
        } else {
          recordHistory()
        }
        setEdges((current) =>
          current.filter((edge) => !removed.includes(edge.source) && !removed.includes(edge.target)),
        )
        setSelectedIds((current) => ({
          node: current.node && removed.includes(current.node) ? null : current.node,
          edge: null,
        }))
        markUnsaved()
      }
      if (positionChanges.length) markUnsaved()
      if (positionChanges.some((change) => change.type === 'position' && change.dragging === false)) {
        historyRef.current.endGesture()
        refreshHistoryState()
      }
    },
    [
      beginHistoryGesture,
      markUnsaved,
      recordHistory,
      recordHistorySnapshot,
      refreshHistoryState,
      setEdges,
      setNodes,
    ],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<DiagramFlowEdge>[]) => {
      const removedEdges = changes.filter((change) => change.type === 'remove')
      const existingRemovedEdges = removedEdges.filter((change) =>
        latestContentRef.current.edges.some((edge) => edge.id === change.id),
      )
      if (existingRemovedEdges.length) {
        if (pendingEdgeRemovalRef.current) {
          window.clearTimeout(pendingEdgeRemovalRef.current.timer)
        }
        const snapshot = currentHistorySnapshot()
        const timer = window.setTimeout(() => {
          if (pendingEdgeRemovalRef.current?.snapshot === snapshot) {
            pendingEdgeRemovalRef.current = null
            recordHistorySnapshot(snapshot)
          }
        }, 0)
        pendingEdgeRemovalRef.current = { snapshot, timer }
      }
      setEdges((current) => withParallelOffsets(applyEdgeChanges(changes, current)))
      if (removedEdges.length) markUnsaved()
    },
    [currentHistorySnapshot, markUnsaved, recordHistorySnapshot, setEdges],
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      const edge = defaultEdge(connection)
      if (!edge) return
      recordHistory()
      setEdges((current) => withParallelOffsets([...current, edge]))
      markUnsaved()
    },
    [markUnsaved, recordHistory, setEdges],
  )

  const startResize = useCallback(() => beginHistoryGesture(), [beginHistoryGesture])

  const finishResize = useCallback(
    (nodeId: string, width: number, height: number) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? { ...node, style: { ...node.style, width, height }, data: { ...node.data, width, height } }
            : node,
        ),
      )
      historyRef.current.endGesture()
      refreshHistoryState()
      markUnsaved()
    },
    [markUnsaved, refreshHistoryState, setNodes],
  )

  const handleNodeClick: NodeMouseHandler<DiagramFlowNode> = useCallback(
    (_event, node) => setSelectedIds({ node: node.id, edge: null }),
    [],
  )
  const handleEdgeClick: EdgeMouseHandler<DiagramFlowEdge> = useCallback(
    (_event, edge) => setSelectedIds({ node: null, edge: edge.id }),
    [],
  )
  const clearSelection = useCallback(
    () => setSelectedIds({ node: null, edge: null }),
    [],
  )

  const addShape = (shape: ShapeType) => {
    const column = nodes.length % 4
    const row = Math.floor(nodes.length / 4)
    const node = newNode(shape, 120 + column * 220, 100 + row * 140)
    recordHistory()
    setNodes((current) => [...current, node])
    setSelectedIds({ node: node.id, edge: null })
    markUnsaved()
  }

  const updateNode = (nodeId: string, update: Partial<DiagramFlowNode['data']>) => {
    recordHistory()
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...update } } : node,
      ),
    )
    markUnsaved()
  }

  const updateNodeColor = (node: DiagramFlowNode, key: keyof VisualProperties, color: string) => {
    const visualProperties = { ...node.data.visual_properties }
    visualProperties[key] = color
    updateNode(node.id, { visual_properties: visualProperties })
  }

  type EdgeUpdate = Partial<
    Pick<
      DiagramEdgeData,
      'label' | 'color' | 'width' | 'line_style' | 'arrowheads' | 'path_type' | 'bend_points'
    >
  >

  const updateEdge = (edgeId: string, update: EdgeUpdate) => {
    recordHistory()
    setEdges((current) =>
      current.map((edge) => {
        if (edge.id !== edgeId) return edge
        const data = edge.data ?? EMPTY_EDGE_DATA
        return {
          ...edge,
          data: {
            label: update.label ?? data.label,
            color: update.color ?? data.color,
            width: update.width ?? data.width,
            line_style: update.line_style ?? data.line_style,
            arrowheads: update.arrowheads ?? data.arrowheads,
            path_type: update.path_type ?? data.path_type,
            bend_points: update.bend_points ?? data.bend_points,
            parallel_offset: data.parallel_offset,
          },
        }
      }),
    )
    markUnsaved()
  }

  const updateBendPoint = useCallback(
    (edgeId: string, pointIndex: number, point: { x: number; y: number }) => {
      setEdges((current) =>
        current.map((edge) => {
          if (edge.id !== edgeId) return edge
          const points = [...(edge.data?.bend_points ?? [])]
          points[pointIndex] = point
          return {
            ...edge,
            data: { ...EMPTY_EDGE_DATA, ...edge.data, bend_points: points },
          }
        }),
      )
      markUnsaved()
    },
    [markUnsaved, setEdges],
  )
  const beginBendGesture = useCallback(() => beginHistoryGesture(), [beginHistoryGesture])
  const endBendGesture = useCallback(() => {
    historyRef.current.endGesture()
    refreshHistoryState()
  }, [refreshHistoryState])

  const handleReconnect: OnReconnect<DiagramFlowEdge> = useCallback(
    (edge, connection) => {
      if (
        !connection.source ||
        !connection.target ||
        !connection.sourceHandle ||
        !connection.targetHandle
      ) {
        return
      }
      recordHistory()
      setEdges((current) =>
        withParallelOffsets(
          current.map((item) =>
            item.id === edge.id
              ? {
                  ...item,
                  source: connection.source,
                  target: connection.target,
                  sourceHandle: connection.sourceHandle,
                  targetHandle: connection.targetHandle,
                }
              : item,
          ),
        ),
      )
      markUnsaved()
    },
    [markUnsaved, recordHistory, setEdges],
  )

  const persistRecoveryDraft = useCallback(() => {
    const current = latestContentRef.current
    const snapshot = flowToSnapshot(
      current.nodes,
      current.edges,
      current.viewport,
      revisionRef.current,
      current.title,
      current.description,
    )
    writeRecoveryDraft(window.localStorage, {
      user_id: user.id,
      diagram_id: diagram.id,
      base_revision: revisionRef.current,
      snapshot,
      updated_at: new Date().toISOString(),
    })
  }, [diagram.id, user.id])

  const save = useCallback(() => {
    if (!loaded) return Promise.resolve()
    if (savePromiseRef.current) return savePromiseRef.current

    transitionSaveState('saving')
    setError('')
    const task = (async () => {
      try {
        await saveUntilCurrent(
          () => {
            const current = latestContentRef.current
            return {
              version: editVersionRef.current,
              snapshot: flowToSnapshot(
                current.nodes,
                current.edges,
                getViewport(),
                revisionRef.current,
                current.title,
                current.description,
              ),
            }
          },
          (snapshot) => api.put<GraphResponse>(`/diagrams/${diagram.id}/graph/`, snapshot),
          (response) => {
            revisionRef.current = response.revision
            serverGraphRef.current = response
            onDiagramChanged(response.diagram)
          },
          (version) => version === editVersionRef.current,
        )
        transitionSaveState('saved')
        setError('')
        setRecoveryOffer(null)
        try {
          removeRecoveryDraft(window.localStorage, user.id, diagram.id)
          setStorageWarning('')
        } catch (storageError) {
          setStorageWarning(
            storageError instanceof Error
              ? `The diagram was saved, but its browser recovery draft could not be cleared: ${storageError.message}`
              : 'The diagram was saved, but its browser recovery draft could not be cleared.',
          )
        }
      } catch (saveError) {
        if (saveError instanceof ApiError && saveError.status === 409) {
          transitionSaveState('conflict')
        } else {
          transitionSaveState('error')
        }
        let message =
          saveError instanceof Error ? saveError.message : 'Could not save this diagram.'
        let recoveryAvailable = true
        try {
          persistRecoveryDraft()
          setStorageWarning('')
        } catch (storageError) {
          recoveryAvailable = false
          const storageMessage =
            storageError instanceof Error ? storageError.message : 'Browser storage failed.'
          message += ` Recovery storage also failed: ${storageMessage}`
          setStorageWarning(`Browser recovery storage is unavailable: ${storageMessage}`)
        }
        setError(message)
        if (saveError instanceof ApiError && saveError.status === 401) {
          const sessionMessage = recoveryAvailable
            ? 'Your session expired. Sign in again to continue editing. Your unsaved changes are saved in this browser.'
            : `Your session expired. Sign in again to continue editing. ${message}`
          onSessionExpired(sessionMessage)
        }
      } finally {
        savePromiseRef.current = null
      }
    })()
    savePromiseRef.current = task
    return task
  }, [
    diagram.id,
    getViewport,
    loaded,
    onDiagramChanged,
    onSessionExpired,
    persistRecoveryDraft,
    transitionSaveState,
    user.id,
  ])

  useEffect(() => {
    if (!loaded || saveState !== 'unsaved') return
    const timer = window.setTimeout(() => void save(), 750)
    return () => window.clearTimeout(timer)
  }, [editVersion, loaded, save, saveState])

  const reloadGraph = async () => {
    setError('')
    transitionSaveState('loading')
    try {
      const graph = await api.get<GraphResponse>(`/diagrams/${diagram.id}/graph/`)
      const flow = graphToFlow(graph)
      serverGraphRef.current = graph
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setViewport(graph.viewport)
      revisionRef.current = graph.revision
      setTitle(graph.diagram.title)
      setDescription(graph.diagram.description)
      editVersionRef.current = 0
      setEditVersion(0)
      historyRef.current.clear()
      refreshHistoryState()
      setSelectedIds({ node: null, edge: null })
      setRecoveryOffer(null)
      try {
        removeRecoveryDraft(window.localStorage, user.id, diagram.id)
        setStorageWarning('')
      } catch (storageError) {
        setStorageWarning(
          storageError instanceof Error
            ? `The saved diagram was reloaded, but its browser recovery draft could not be cleared: ${storageError.message}`
            : 'The saved diagram was reloaded, but its browser recovery draft could not be cleared.',
        )
      }
      transitionSaveState('saved')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not reload this diagram.')
      transitionSaveState('error')
    }
  }

  const recoverDraft = () => {
    if (!recoveryOffer || !serverGraphRef.current) return
    const currentGraph = serverGraphRef.current
    const flow = snapshotToFlow(recoveryOffer.snapshot, currentGraph)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setViewport(flow.viewport)
    setTitle(recoveryOffer.snapshot.title)
    setDescription(recoveryOffer.snapshot.description)
    revisionRef.current = recoveryOffer.base_revision
    historyRef.current.clear()
    refreshHistoryState()
    setSelectedIds({ node: null, edge: null })
    setRecoveryOffer(null)
    markUnsaved()
    if (recoveryOffer.base_revision !== currentGraph.revision) {
      setError(
        'This recovery draft is based on an older saved version. Reload the saved version or save this draft as a separate copy.',
      )
      transitionSaveState('conflict')
    }
  }

  const discardRecoveryDraft = () => {
    setRecoveryOffer(null)
    try {
      removeRecoveryDraft(window.localStorage, user.id, diagram.id)
      setStorageWarning('')
    } catch (storageError) {
      setStorageWarning(
        storageError instanceof Error
          ? `The recovery draft could not be removed: ${storageError.message}`
          : 'The recovery draft could not be removed.',
      )
    }
  }

  const saveAsCopy = async () => {
    if (copying) return
    setCopying(true)
    transitionSaveState('saving')
    setError('')
    let copy: DiagramSummary | null = null
    try {
      copy = await api.post<DiagramSummary>(`/diagrams/${diagram.id}/duplicate/`)
      const copyId = copy.id
      const copyGraph = await api.get<GraphResponse>(`/diagrams/${copyId}/graph/`)
      let copyRevision = copyGraph.revision
      const copyNodeIds = new Map<string, string>()
      const copyEdgeIds = new Map<string, string>()
      await saveUntilCurrent(
        () => {
          const current = latestContentRef.current
          const copyTitle = (current.title ? `${current.title} copy` : 'Untitled diagram copy').slice(
            0,
            200,
          )
          return {
            version: editVersionRef.current,
            snapshot: remapSnapshotIdentities(
              flowToSnapshot(
                current.nodes,
                current.edges,
                getViewport(),
                copyRevision,
                copyTitle,
                current.description,
              ),
              copyNodeIds,
              copyEdgeIds,
            ),
          }
        },
        (snapshot) => api.put<GraphResponse>(`/diagrams/${copyId}/graph/`, snapshot),
        (response) => {
          copyRevision = response.revision
          copy = response.diagram
        },
        (version) => version === editVersionRef.current,
      )
      try {
        removeRecoveryDraft(window.localStorage, user.id, diagram.id)
        setStorageWarning('')
      } catch (storageError) {
        setStorageWarning(
          storageError instanceof Error
            ? `The copy was saved, but the original recovery draft could not be cleared: ${storageError.message}`
            : 'The copy was saved, but the original recovery draft could not be cleared.',
        )
      }
      onOpenDiagram(copyId)
    } catch (copyError) {
      if (copyError instanceof ApiError && copyError.status === 401) {
        let sessionMessage = 'Your session expired. Sign in again to continue editing.'
        try {
          persistRecoveryDraft()
          sessionMessage += ' Your unsaved changes are saved in this browser.'
        } catch (storageError) {
          sessionMessage +=
            storageError instanceof Error
              ? ` Browser recovery storage also failed: ${storageError.message}`
              : ' Browser recovery storage also failed.'
        }
        onSessionExpired(sessionMessage)
        return
      }
      try {
        persistRecoveryDraft()
      } catch (storageError) {
        setStorageWarning(
          storageError instanceof Error
            ? `Browser recovery storage is unavailable: ${storageError.message}`
            : 'Browser recovery storage is unavailable.',
        )
      }
      if (copy) {
        try {
          await api.delete(`/diagrams/${copy.id}/`)
        } catch (cleanupError) {
          const cleanupMessage =
            cleanupError instanceof Error ? cleanupError.message : 'Cleanup failed.'
          setError(
            `${copyError instanceof Error ? copyError.message : 'Could not save a copy.'} The incomplete copy could not be removed: ${cleanupMessage}`,
          )
          transitionSaveState('conflict')
          setCopying(false)
          return
        }
      }
      setError(copyError instanceof Error ? copyError.message : 'Could not save a copy.')
      transitionSaveState('conflict')
    } finally {
      setCopying(false)
    }
  }

  const exportSvg = () => {
    setExportError('')
    try {
      const current = latestContentRef.current
      const svg = buildDiagramSvg(current.nodes, current.edges, current.title, exportBackground)
      downloadBlob(
        new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
        safeExportFilename(current.title, 'svg'),
      )
    } catch (exportFailure) {
      setExportError(
        exportFailure instanceof Error ? exportFailure.message : 'Could not export this diagram as SVG.',
      )
    }
  }

  const exportPng = async () => {
    setExportError('')
    try {
      const current = latestContentRef.current
      const svg = buildDiagramSvg(current.nodes, current.edges, current.title, exportBackground)
      const png = await createPngBlob(svg, exportBackground)
      downloadBlob(png, safeExportFilename(current.title, 'png'))
    } catch (exportFailure) {
      setExportError(
        exportFailure instanceof Error ? exportFailure.message : 'Could not export this diagram as PNG.',
      )
    }
  }

  const undo = useCallback(() => {
    const previous = historyRef.current.undo(currentHistorySnapshot())
    if (!previous) return
    setNodes(previous.nodes)
    setEdges(withParallelOffsets(previous.edges))
    setSelectedIds({ node: null, edge: null })
    refreshHistoryState()
    markUnsaved()
  }, [currentHistorySnapshot, markUnsaved, refreshHistoryState, setEdges, setNodes])

  const redo = useCallback(() => {
    const next = historyRef.current.redo(currentHistorySnapshot())
    if (!next) return
    setNodes(next.nodes)
    setEdges(withParallelOffsets(next.edges))
    setSelectedIds({ node: null, edge: null })
    refreshHistoryState()
    markUnsaved()
  }, [currentHistorySnapshot, markUnsaved, refreshHistoryState, setEdges, setNodes])

  const duplicateSelection = useCallback(() => {
    const current = latestContentRef.current
    const selectedNodes = current.nodes.filter((node) => node.selected)
    const selectedEdges = current.edges.filter((edge) => edge.selected)
    if (!selectedNodes.length && !selectedEdges.length) return

    recordHistory()
    const nodeIds = new Map(selectedNodes.map((node) => [node.id, crypto.randomUUID()]))
    const duplicatedNodes = selectedNodes.map((node) => {
      const id = nodeIds.get(node.id)
      if (!id) throw new Error('A selected node identity could not be duplicated.')
      return {
        ...node,
        id,
        position: { x: node.position.x + 24, y: node.position.y + 24 },
        selected: true,
        zIndex: (node.zIndex ?? node.data.z_index) + 1,
        data: { ...node.data, z_index: node.data.z_index + 1 },
      }
    })
    const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id))
    const edgesToDuplicate = current.edges.filter(
      (edge) =>
        selectedEdgeIds.has(edge.id) || (nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    )
    const duplicatedEdges = edgesToDuplicate.map((edge) => ({
      ...edge,
      id: crypto.randomUUID(),
      source: nodeIds.get(edge.source) ?? edge.source,
      target: nodeIds.get(edge.target) ?? edge.target,
      selected: true,
      data: {
        ...EMPTY_EDGE_DATA,
        ...edge.data,
        bend_points: edge.data?.bend_points.map((point) => ({ ...point })) ?? [],
      },
    }))
    setNodes((existing) => [
      ...existing.map((node) => (node.selected ? { ...node, selected: false } : node)),
      ...duplicatedNodes,
    ])
    setEdges((existing) =>
      withParallelOffsets([
        ...existing.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
        ...duplicatedEdges,
      ]),
    )
    setSelectedIds({
      node: duplicatedNodes[0]?.id ?? null,
      edge: duplicatedEdges[0]?.id ?? null,
    })
    markUnsaved()
  }, [markUnsaved, recordHistory, setEdges, setNodes])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))
      ) {
        return
      }
      const modifier = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (modifier && key === 's') {
        event.preventDefault()
        void save()
      } else if (modifier && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (event.ctrlKey && key === 'y') {
        event.preventDefault()
        redo()
      } else if (modifier && key === 'd') {
        const hasSelection =
          latestContentRef.current.nodes.some((node) => node.selected) ||
          latestContentRef.current.edges.some((edge) => edge.selected)
        if (hasSelection) {
          event.preventDefault()
          duplicateSelection()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [duplicateSelection, redo, save, undo])

  const selectedNode = nodes.find((node) => node.id === selectedIds.node)
  const selectedEdge = edges.find((edge) => edge.id === selectedIds.edge)
  const selectedEdgeSource = selectedEdge
    ? nodes.find((node) => node.id === selectedEdge.source)
    : undefined
  const selectedEdgeTarget = selectedEdge
    ? nodes.find((node) => node.id === selectedEdge.target)
    : undefined
  const saveLabel: Record<SaveState, string> = {
    loading: 'Loading',
    saved: 'Saved',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Save failed',
    conflict: 'Conflict',
  }

  const backToDashboard = () => {
    if (loaded && saveStateRef.current !== 'saved') {
      try {
        persistRecoveryDraft()
      } catch (storageError) {
        setStorageWarning(
          storageError instanceof Error
            ? `The draft could not be saved for recovery: ${storageError.message}`
            : 'The draft could not be saved for recovery.',
        )
        return
      }
    }
    onBack()
  }

  return (
    <div className="editor-shell">
      <header className="editor-header">
        <button className="button button-quiet back-button" onClick={backToDashboard} type="button">
          <span aria-hidden="true">‹</span> Diagrams
        </button>
        <div className="editor-title-wrap">
          <label className="visually-hidden" htmlFor="diagram-title">Diagram title</label>
          <input
            className="editor-title"
            id="diagram-title"
            maxLength={200}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              markUnsaved()
            }}
          />
          {user.is_superuser && diagram.owner.id !== user.id && (
            <span className="owner-label">Owned by {diagram.owner.username}</span>
          )}
        </div>
        <div className="editor-save">
          <span className={`save-status status-${saveState}`} role="status">
            {saveLabel[saveState]}
          </span>
          <button
            className="button button-primary"
            disabled={
              !loaded ||
              saveState === 'saving' ||
              saveState === 'loading' ||
              saveState === 'conflict'
            }
            onClick={() => void save()}
            type="button"
          >
            Save
          </button>
        </div>
      </header>

      <div className="editor-workspace">
        <aside className="shape-palette" aria-label="Shape palette">
          <h2>Add to canvas</h2>
          <p>Choose a shape, then connect its ports.</p>
          {(Object.keys(SHAPE_REGISTRY) as ShapeType[]).map((shape) => (
            <button
              className="palette-item"
              disabled={!loaded}
              key={shape}
              onClick={() => addShape(shape)}
              type="button"
            >
              <span className={`palette-glyph ${SHAPE_REGISTRY[shape].className}`} aria-hidden="true">
                <i />
              </span>
              {SHAPE_REGISTRY[shape].label}
            </button>
          ))}
        </aside>

        <main className="editor-canvas-area">
          <div className="canvas-toolbar">
            <span>{nodes.length} {nodes.length === 1 ? 'shape' : 'shapes'}</span>
            <div className="canvas-toolbar-actions">
              <button
                aria-label="Undo"
                className="button button-quiet button-small"
                disabled={!historyState.canUndo}
                onClick={undo}
                type="button"
              >
                Undo
              </button>
              <button
                aria-label="Redo"
                className="button button-quiet button-small"
                disabled={!historyState.canRedo}
                onClick={redo}
                type="button"
              >
                Redo
              </button>
              <button
                className="button button-quiet button-small"
                disabled={!nodes.some((node) => node.selected) && !edges.some((edge) => edge.selected)}
                onClick={duplicateSelection}
                type="button"
              >
                Duplicate selection
              </button>
            <button className="button button-quiet button-small" onClick={() => void fitView({ padding: 0.2 })} type="button">
              Fit diagram
            </button>
              <label className="export-background">
                Export background
                <select
                  aria-label="Export background"
                  disabled={!loaded}
                  onChange={(event) =>
                    setExportBackground(event.target.value as ExportBackground)
                  }
                  value={exportBackground}
                >
                  <option value="transparent">Transparent</option>
                  <option value="white">White</option>
                </select>
              </label>
              <button
                className="button button-secondary button-small"
                disabled={!loaded}
                onClick={exportSvg}
                type="button"
              >
                Export SVG
              </button>
              <button
                className="button button-secondary button-small"
                disabled={!loaded}
                onClick={() => void exportPng()}
                type="button"
              >
                Export PNG
              </button>
            </div>
          </div>
          {exportError && (
            <div className="notice notice-error export-error" role="alert">
              {exportError}
            </div>
          )}
          {recoveryOffer && (
            <div className="notice notice-recovery" role="alert">
              <span>A browser recovery draft differs from the saved diagram.</span>
              <button className="text-button" onClick={recoverDraft} type="button">
                Restore draft
              </button>
              <button className="text-button" onClick={discardRecoveryDraft} type="button">
                Discard draft
              </button>
            </div>
          )}
          {error && (
            <div className={`notice ${saveState === 'conflict' ? 'notice-conflict' : 'notice-error'}`} role="alert">
              <span>{error}</span>
              {saveState === 'conflict' && (
                <>
                  <button className="text-button" onClick={() => void reloadGraph()} type="button">
                    Reload saved version
                  </button>
                  <button
                    className="text-button"
                    disabled={copying}
                    onClick={() => void saveAsCopy()}
                    type="button"
                  >
                    {copying ? 'Saving copy…' : 'Save as separate copy'}
                  </button>
                </>
              )}
            </div>
          )}
          {storageWarning && (
            <div className="notice notice-storage" role="status">
              {storageWarning}
            </div>
          )}
          <div className="canvas-frame">
            {!loaded ? (
              <div className="canvas-loading">{saveState === 'error' ? 'The diagram could not be loaded.' : 'Loading canvas…'}</div>
            ) : (
              <ResizeContext.Provider value={{ beginGesture: startResize, finish: finishResize }}>
                <BendContext.Provider
                  value={{
                    beginGesture: beginBendGesture,
                    update: updateBendPoint,
                    endGesture: endBendGesture,
                  }}
                >
                  <ReactFlow<DiagramFlowNode, DiagramFlowEdge>
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={handleConnect}
                    onReconnect={handleReconnect}
                    onNodeClick={handleNodeClick}
                    onEdgeClick={handleEdgeClick}
                    onPaneClick={clearSelection}
                    onMoveEnd={(_event, nextViewport) => {
                      setViewport(nextViewport)
                      markUnsaved()
                    }}
                    defaultViewport={viewport}
                    fitView={false}
                    deleteKeyCode={['Backspace', 'Delete']}
                    selectionKeyCode="Shift"
                    multiSelectionKeyCode="Shift"
                    minZoom={0.1}
                    maxZoom={3}
                  >
                    <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d7dde3" />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </BendContext.Provider>
              </ResizeContext.Provider>
            )}
          </div>
        </main>

        <aside className="properties-panel" aria-label="Selection properties">
          <h2>Properties</h2>
          {selectedNode ? (
            <div className="property-fields">
              <p className="property-type">{SHAPE_REGISTRY[selectedNode.data.shape_type].label}</p>
              <label>
                Label
                <textarea
                  rows={2}
                  maxLength={300}
                  value={selectedNode.data.label}
                  onChange={(event) => updateNode(selectedNode.id, { label: event.target.value })}
                />
              </label>
              <label>
                Annotation
                <textarea
                  rows={5}
                  maxLength={10000}
                  value={selectedNode.data.annotation}
                  onChange={(event) => updateNode(selectedNode.id, { annotation: event.target.value })}
                />
              </label>
              <div className="color-properties">
                {(
                  [
                    ['fill', 'Fill'],
                    ['stroke', 'Border'],
                    ['text', 'Text'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="color-field" key={key}>
                    {label}
                    <input
                      aria-label={`${label} color`}
                      type="color"
                      value={
                        selectedNode.data.visual_properties[key] ??
                        SHAPE_REGISTRY[selectedNode.data.shape_type].defaults[key]
                      }
                      onChange={(event) => updateNodeColor(selectedNode, key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
              <p className="field-help">Use annotation for free-text notes, time, or cost.</p>
              <p className="size-readout">{Math.round(selectedNode.data.width)} × {Math.round(selectedNode.data.height)} px</p>
            </div>
          ) : selectedEdge ? (
            <div className="property-fields">
              <p className="property-type">Connection</p>
              <label>
                Label
                <input
                  maxLength={300}
                  value={selectedEdge.data?.label ?? ''}
                  onChange={(event) => updateEdge(selectedEdge.id, { label: event.target.value })}
                />
              </label>
              <label className="color-field">
                Line color
                <input
                  aria-label="Line color"
                  type="color"
                  value={selectedEdge.data?.color ?? '#536273'}
                  onChange={(event) => updateEdge(selectedEdge.id, { color: event.target.value })}
                />
              </label>
              <label>
                Line width
                <input
                  aria-label="Line width"
                  type="range"
                  min="0.5"
                  max="12"
                  step="0.5"
                  value={selectedEdge.data?.width ?? 2}
                  onChange={(event) =>
                    updateEdge(selectedEdge.id, { width: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Line style
                <select
                  value={selectedEdge.data?.line_style ?? 'solid'}
                  onChange={(event) =>
                    updateEdge(selectedEdge.id, {
                      line_style: event.target.value as DiagramEdgeData['line_style'],
                    })
                  }
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                </select>
              </label>
              <label>
                Arrowheads
                <select
                  value={selectedEdge.data?.arrowheads ?? 'end'}
                  onChange={(event) =>
                    updateEdge(selectedEdge.id, {
                      arrowheads: event.target.value as DiagramEdgeData['arrowheads'],
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="start">Start</option>
                  <option value="end">End</option>
                  <option value="both">Both</option>
                </select>
              </label>
              <label>
                Path
                <select
                  value={selectedEdge.data?.path_type ?? 'straight'}
                  onChange={(event) =>
                    updateEdge(selectedEdge.id, {
                      path_type: event.target.value as DiagramEdgeData['path_type'],
                    })
                  }
                >
                  <option value="straight">Straight</option>
                  <option value="step">Orthogonal</option>
                </select>
              </label>
              <div className="bend-actions">
                <button
                  className="button button-secondary button-small"
                  onClick={() => {
                    if (!selectedEdgeSource || !selectedEdgeTarget) return
                    const sourceCenter = {
                      x: selectedEdgeSource.position.x + selectedEdgeSource.data.width / 2,
                      y: selectedEdgeSource.position.y + selectedEdgeSource.data.height / 2,
                    }
                    const targetCenter = {
                      x: selectedEdgeTarget.position.x + selectedEdgeTarget.data.width / 2,
                      y: selectedEdgeTarget.position.y + selectedEdgeTarget.data.height / 2,
                    }
                    const lift = selectedEdge.source === selectedEdge.target ? 80 : 45
                    updateEdge(selectedEdge.id, {
                      bend_points: [
                        ...(selectedEdge.data?.bend_points ?? []),
                        {
                          x: (sourceCenter.x + targetCenter.x) / 2,
                          y: (sourceCenter.y + targetCenter.y) / 2 - lift,
                        },
                      ],
                    })
                  }}
                  type="button"
                >
                  Add bend point
                </button>
                {!!selectedEdge.data?.bend_points.length && (
                  <button
                    className="text-button"
                    onClick={() => updateEdge(selectedEdge.id, { bend_points: [] })}
                    type="button"
                  >
                    Clear points
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="empty-properties">Select a shape or connection to edit its text.</p>
          )}
        </aside>
      </div>
      <input type="hidden" value={description} readOnly aria-hidden="true" />
    </div>
  )
}

export function DiagramEditor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <EditorCanvas {...props} />
    </ReactFlowProvider>
  )
}
