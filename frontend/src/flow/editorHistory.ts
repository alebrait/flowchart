import type { DiagramFlowEdge, DiagramFlowNode } from '../types'

export interface EditorHistorySnapshot {
  nodes: DiagramFlowNode[]
  edges: DiagramFlowEdge[]
}

function copySnapshot(snapshot: EditorHistorySnapshot): EditorHistorySnapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node, selected: false, dragging: false })),
    edges: snapshot.edges.map((edge) => ({ ...edge, selected: false })),
  }
}

function sameSnapshot(left: EditorHistorySnapshot, right: EditorHistorySnapshot) {
  const content = (snapshot: EditorHistorySnapshot) =>
    JSON.stringify({
      nodes: snapshot.nodes.map(({ selected: _selected, dragging: _dragging, ...node }) => node),
      edges: snapshot.edges.map(({ selected: _selected, ...edge }) => edge),
    })
  return content(left) === content(right)
}

export class EditorHistory {
  private readonly past: EditorHistorySnapshot[] = []
  private readonly future: EditorHistorySnapshot[] = []
  private gestureOpen = false
  private readonly limit = 100

  get canUndo() {
    return this.past.length > 0
  }

  get canRedo() {
    return this.future.length > 0
  }

  get hasOpenGesture() {
    return this.gestureOpen
  }

  record(snapshot: EditorHistorySnapshot) {
    if (this.gestureOpen) return
    if (this.past.length && sameSnapshot(this.past[this.past.length - 1], snapshot)) return
    this.push(snapshot)
    this.future.length = 0
  }

  beginGesture(snapshot: EditorHistorySnapshot) {
    if (this.gestureOpen) return
    this.push(snapshot)
    this.future.length = 0
    this.gestureOpen = true
  }

  endGesture() {
    this.gestureOpen = false
  }

  undo(current: EditorHistorySnapshot) {
    this.endGesture()
    const previous = this.past.pop()
    if (!previous) return null
    this.future.push(copySnapshot(current))
    return copySnapshot(previous)
  }

  redo(current: EditorHistorySnapshot) {
    this.endGesture()
    const next = this.future.pop()
    if (!next) return null
    this.push(current)
    return copySnapshot(next)
  }

  clear() {
    this.past.length = 0
    this.future.length = 0
    this.endGesture()
  }

  private push(snapshot: EditorHistorySnapshot) {
    this.past.push(copySnapshot(snapshot))
    if (this.past.length > this.limit) this.past.shift()
  }
}
