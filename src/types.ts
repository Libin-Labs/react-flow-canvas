import type { CSSProperties, ReactNode } from 'react';

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect extends Point, Size {}
export interface Viewport extends Point { zoom: number }
export type Side = 'left' | 'right' | 'top' | 'bottom';
export interface Port {
  id: string;
  type: 'source' | 'target';
  side?: Side;
  /** Fraction along the side, between 0 and 1. */
  offset?: number;
  label?: string;
}
export interface FlowNode<D = Record<string, unknown>> {
  id: string;
  position: Point;
  data: D;
  type?: string;
  width?: number;
  height?: number;
  ports?: Port[];
  selected?: boolean;
  draggable?: boolean;
  deletable?: boolean;
  className?: string;
}
export type EdgeType = 'bezier' | 'straight' | 'step';
export interface FlowEdge<D = Record<string, unknown>> {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  type?: EdgeType;
  data?: D;
  label?: string;
  selected?: boolean;
  animated?: boolean;
  deletable?: boolean;
  style?: CSSProperties;
}
export interface Graph<N = Record<string, unknown>, E = Record<string, unknown>> {
  nodes: FlowNode<N>[];
  edges: FlowEdge<E>[];
}
export interface Connection {
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
}
export interface FlowDocument<N = Record<string, unknown>, E = Record<string, unknown>> {
  version: 1;
  graph: Graph<N, E>;
  viewport: Viewport;
}
export interface NodeRenderProps<D = Record<string, unknown>> {
  node: FlowNode<D>;
  selected: boolean;
}
export type NodeRenderer<D = Record<string, unknown>> = (props: NodeRenderProps<D>) => ReactNode;
export interface EdgeRenderProps<D = Record<string, unknown>> {
  edge: FlowEdge<D>;
  path: string;
  source: Point;
  target: Point;
  label: Point;
  /** Unique per-canvas SVG marker ID. */
  markerId: string;
}
export type EdgeRenderer<D = Record<string, unknown>> = (props: EdgeRenderProps<D>) => ReactNode;
export type ChangeReason = 'add' | 'remove' | 'move' | 'select' | 'connect' | 'update' | 'undo' | 'redo' | 'load';
export interface FlowInstance<N = Record<string, unknown>, E = Record<string, unknown>> {
  getGraph(): Graph<N, E>;
  setGraph(graph: Graph<N, E>): void;
  addNodes(nodes: FlowNode<N>[]): void;
  addEdges(edges: FlowEdge<E>[]): void;
  updateNode(id: string, patch: Partial<Omit<FlowNode<N>, 'id'>>): void;
  updateEdge(id: string, patch: Partial<Omit<FlowEdge<E>, 'id'>>): void;
  deleteSelected(): void;
  selectAll(): void;
  duplicateSelected(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  getViewport(): Viewport;
  setViewport(viewport: Viewport): void;
  fitView(padding?: number): void;
  zoomIn(): void;
  zoomOut(): void;
  screenToFlowPosition(client: Point): Point;
  toJSON(): FlowDocument<N, E>;
  load(document: FlowDocument<N, E>): void;
}
