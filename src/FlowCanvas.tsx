import {
  createContext, memo, useCallback, useContext, useEffect, useId, useLayoutEffect,
  useMemo, useRef, useState,
} from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  clamp, DEFAULT_PORTS, fitBounds, getBounds, getEdgePath, getPort, intersects,
  nodeRect, portPosition, portSide, screenToFlow, zoomAt,
} from './geometry.js';
import { History, isValidConnection, removeSelected, validateGraph, validateViewport } from './graph.js';
import type {
  ChangeReason, Connection, EdgeRenderer, FlowDocument, FlowEdge, FlowInstance, FlowNode,
  Graph, NodeRenderer, Point, Port, Rect, Size, Viewport,
} from './types.js';

const EMPTY_GRAPH: Graph<never, never> = { nodes: [], edges: [] };
const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const FlowContext = createContext<{ instance: FlowInstance<unknown, unknown>; size: Size } | null>(null);

/** Call only inside FlowCanvas children or a custom node/edge renderer. */
export function useFlowCanvas<N = Record<string, unknown>, E = Record<string, unknown>>(): FlowInstance<N, E> {
  const instance = useContext(FlowContext);
  if (!instance) throw new Error('useFlowCanvas must be used inside FlowCanvas.');
  return instance.instance as FlowInstance<N, E>;
}

export interface FlowCanvasProps<N = Record<string, unknown>, E = Record<string, unknown>> {
  /** Controlled graph. Update it synchronously in onChange. */
  value?: Graph<N, E>;
  defaultValue?: Graph<N, E>;
  onChange?: (graph: Graph<N, E>, reason: ChangeReason) => void;
  defaultViewport?: Viewport;
  onViewportChange?: (viewport: Viewport) => void;
  onInit?: (instance: FlowInstance<N, E>) => void;
  onConnect?: (connection: Connection) => void;
  onConnectionRejected?: (connection: Connection) => void;
  isValidConnection?: (connection: Connection, graph: Graph<N, E>) => boolean;
  autoConnect?: boolean;
  allowSelfConnections?: boolean;
  allowDuplicateConnections?: boolean;
  nodeTypes?: Record<string, NodeRenderer<N>>;
  edgeTypes?: Record<string, EdgeRenderer<E>>;
  onNodeClick?: (node: FlowNode<N>) => void;
  onEdgeClick?: (edge: FlowEdge<E>) => void;
  onPaneDoubleClick?: (position: Point) => void;
  onSelectionChange?: (selection: { nodes: FlowNode<N>[]; edges: FlowEdge<E>[] }) => void;
  minZoom?: number;
  maxZoom?: number;
  snapGrid?: readonly [number, number];
  nodeExtent?: Rect;
  fitView?: boolean;
  readOnly?: boolean;
  nodesDraggable?: boolean;
  nodesConnectable?: boolean;
  elementsSelectable?: boolean;
  panOnDrag?: boolean;
  zoomOnScroll?: boolean;
  /** Cull nodes and edges outside the viewport plus a 200px overscan. */
  onlyRenderVisibleElements?: boolean;
  historyLimit?: number;
  showControls?: boolean;
  showMiniMap?: boolean;
  background?: 'dots' | 'lines' | 'none';
  gridSize?: number;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

interface InteractionEvent {
  preventDefault(): void;
  stopPropagation(): void;
  pointerId?: number;
}
interface NodeViewProps<D> {
  node: FlowNode<D>;
  renderer?: NodeRenderer<D>;
  connectable: boolean;
  selectable: boolean;
  connecting: boolean;
  onStart: (event: ReactPointerEvent | KeyboardEvent, id: string) => void;
  onPort: (nodeId: string, port: Port, event: InteractionEvent) => void;
  onClick: (id: string) => void;
}
function NodeViewComponent<D>({ node, renderer, connectable, selectable, connecting, onStart, onPort, onClick }: NodeViewProps<D>) {
  const r = nodeRect(node);
  const Renderer = renderer;
  return (
    <div
      className={`rfc-node${node.selected ? ' rfc-selected' : ''}${node.className ? ` ${node.className}` : ''}`}
      style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: r.width, height: r.height }}
      data-node-id={node.id}
      role="group"
      aria-label={`Node ${defaultLabel(node)}${node.selected ? ', selected' : ''}`}
      tabIndex={selectable ? 0 : undefined}
      onPointerDown={event => onStart(event, node.id)}
      onClick={event => { if (event.detail === 0) onClick(node.id); }}
      onKeyDown={event => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault(); event.stopPropagation();
          onStart(event, node.id);
          onClick(node.id);
        }
      }}
    >
      <div className="rfc-node-content">
        {Renderer ? <Renderer node={node} selected={node.selected === true} /> : <span>{defaultLabel(node)}</span>}
      </div>
      {(node.ports ?? DEFAULT_PORTS).map(port => {
        const side = portSide(port), offset = `${(port.offset ?? 0.5) * 100}%`;
        const style: CSSProperties = {
          left: side === 'left' ? 0 : side === 'right' ? '100%' : offset,
          top: side === 'top' ? 0 : side === 'bottom' ? '100%' : offset,
        };
        return <button
          key={port.id}
          type="button"
          className={`rfc-port rfc-port-${port.type}${connecting && port.type === 'target' ? ' rfc-port-ready' : ''}`}
          style={style}
          disabled={!connectable}
          data-port-id={port.id}
          data-port-type={port.type}
          aria-label={port.label ?? `${port.type === 'source' ? 'Connect from' : 'Connect to'} ${node.id} ${port.id}`}
          title={port.label ?? `${port.type}: ${port.id}`}
          onPointerDown={event => { event.stopPropagation(); if (event.button === 0) onPort(node.id, port, event); }}
          onClick={event => {
            event.stopPropagation();
            if (event.detail === 0) onPort(node.id, port, event);
          }}
        />;
      })}
    </div>
  );
}
const NodeView = memo(NodeViewComponent) as typeof NodeViewComponent;
function defaultLabel(node: FlowNode<unknown>): string {
  if (typeof node.data === 'object' && node.data !== null && 'label' in node.data) return String(node.data.label);
  return node.id;
}
const editableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"], [data-flow-ignore]'));
const uniqueId = (prefix: string, used: Set<string>): string => {
  let id: string;
  do { id = `${prefix}-${globalThis.crypto.randomUUID()}`; } while (used.has(id));
  used.add(id); return id;
};
type Gesture =
  | { kind: 'pan'; start: Point; viewport: Viewport; pointerId: number }
  | { kind: 'select'; start: Point; current: Point; additive: boolean; pointerId: number }
  | { kind: 'move'; start: Point; nodes: Map<string, Point>; bounds: Rect; recorded: boolean; pointerId: number };
interface PendingConnection { nodeId: string; port: Port; start: Point; end: Point }

export function FlowCanvas<N = Record<string, unknown>, E = Record<string, unknown>>(props: FlowCanvasProps<N, E>) {
  const {
    minZoom = 0.1, maxZoom = 4, snapGrid, nodeExtent, gridSize = 20,
    historyLimit = 100, readOnly = false, elementsSelectable = true,
  } = props;
  if (!Number.isFinite(minZoom) || !Number.isFinite(maxZoom) || minZoom <= 0 || maxZoom < minZoom) throw new RangeError('Invalid zoom limits.');
  if (!Number.isFinite(gridSize) || gridSize <= 0) throw new RangeError('gridSize must be positive.');
  if (snapGrid && (!Array.isArray(snapGrid) || snapGrid.length !== 2 || snapGrid.some(n => !Number.isFinite(n) || n <= 0))) throw new RangeError('snapGrid requires two positive numbers.');
  if (nodeExtent && (![nodeExtent.x, nodeExtent.y, nodeExtent.width, nodeExtent.height].every(Number.isFinite) || nodeExtent.width <= 0 || nodeExtent.height <= 0)) throw new RangeError('nodeExtent must be a finite positive rectangle.');
  const [internal, setInternal] = useState<Graph<N, E>>(() => {
    const graph = props.value ?? props.defaultValue ?? EMPTY_GRAPH;
    validateGraph(graph); return graph;
  });
  const graph = props.value ?? internal;
  useMemo(() => { validateGraph(graph); }, [graph]);
  const [viewport, setViewportState] = useState<Viewport>(() => {
    const value = props.defaultViewport ?? INITIAL_VIEWPORT;
    validateViewport(value); return { ...value, zoom: clamp(value.zoom, minZoom, maxZoom) };
  });
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [connection, setConnectionState] = useState<PendingConnection | null>(null);
  const [selectionBox, setSelectionBox] = useState<Rect | null>(null);
  const [announcement, announce] = useState('');
  const [, redraw] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const graphRef = useRef(graph); graphRef.current = graph;
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const propsRef = useRef(props); propsRef.current = props;
  const sizeRef = useRef(size); sizeRef.current = size;
  const history = useMemo(() => new History<Graph<N, E>>(historyLimit), [historyLimit]);
  const gesture = useRef<Gesture | null>(null);
  const nodePress = useRef<{ id: string; start: Point; pointerId: number; moved: boolean } | null>(null);
  const connectionRef = useRef(connection);
  const connectionPointer = useRef<number | null>(null);
  const space = useRef(false);
  const frame = useRef<number | null>(null);
  const queued = useRef<(() => void) | null>(null);
  const markerId = `rfc-arrow-${useId().replace(/:/g, '')}`;
  const setConnection = useCallback((next: PendingConnection | null) => {
    connectionRef.current = next; setConnectionState(next);
  }, []);
  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const task = queued.current; queued.current = null; task?.();
  }, []);
  const schedule = useCallback((task: () => void) => {
    queued.current = task;
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  }, [flush]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const commit = useCallback((next: Graph<N, E>, reason: ChangeReason, record = true, validate = true) => {
    if (validate) validateGraph(next);
    if (next === graphRef.current) return;
    if (record) history.push(graphRef.current);
    graphRef.current = next;
    if (propsRef.current.value === undefined) setInternal(next);
    else redraw(n => n + 1);
    propsRef.current.onChange?.(next, reason);
  }, [history]);
  const setViewport = useCallback((next: Viewport) => {
    validateViewport(next);
    const p = propsRef.current;
    const value = { ...next, zoom: clamp(next.zoom, p.minZoom ?? 0.1, p.maxZoom ?? 4) };
    viewportRef.current = value; setViewportState(value); p.onViewportChange?.(value);
  }, []);
  const localPoint = useCallback((client: Point): Point => {
    const rect = root.current?.getBoundingClientRect();
    return { x: client.x - (rect?.left ?? 0), y: client.y - (rect?.top ?? 0) };
  }, []);
  const fitView = useCallback((padding = 40) => {
    if (!Number.isFinite(padding) || padding < 0) throw new RangeError('Fit padding must be nonnegative.');
    if (!graphRef.current.nodes.length || !sizeRef.current.width || !sizeRef.current.height) return;
    setViewport(fitBounds(getBounds(graphRef.current.nodes), sizeRef.current, padding, propsRef.current.minZoom ?? 0.1, propsRef.current.maxZoom ?? 4));
  }, [setViewport]);
  const zoomBy = useCallback((factor: number) => {
    const p = propsRef.current, v = viewportRef.current, s = sizeRef.current;
    setViewport(zoomAt(v, { x: s.width / 2, y: s.height / 2 }, clamp(v.zoom * factor, p.minZoom ?? 0.1, p.maxZoom ?? 4)));
  }, [setViewport]);
  const select = useCallback((nodes: Set<string>, edges = new Set<string>()) => {
    const g = graphRef.current;
    const next = {
      nodes: g.nodes.map(n => Boolean(n.selected) === nodes.has(n.id) ? n : { ...n, selected: nodes.has(n.id) }),
      edges: g.edges.map(e => Boolean(e.selected) === edges.has(e.id) ? e : { ...e, selected: edges.has(e.id) }),
    };
    commit(next, 'select', false, false);
  }, [commit]);
  const instance = useMemo<FlowInstance<N, E>>(() => ({
    getGraph: () => graphRef.current,
    setGraph: next => commit(next, 'load'),
    addNodes: nodes => commit({ ...graphRef.current, nodes: [...graphRef.current.nodes, ...nodes] }, 'add'),
    addEdges: edges => commit({ ...graphRef.current, edges: [...graphRef.current.edges, ...edges] }, 'add'),
    updateNode: (id, patch) => {
      if (!graphRef.current.nodes.some(n => n.id === id)) throw new Error(`Unknown node: ${id}`);
      commit({ ...graphRef.current, nodes: graphRef.current.nodes.map(n => n.id === id ? { ...n, ...patch, id } : n) }, 'update');
    },
    updateEdge: (id, patch) => {
      if (!graphRef.current.edges.some(e => e.id === id)) throw new Error(`Unknown edge: ${id}`);
      commit({ ...graphRef.current, edges: graphRef.current.edges.map(e => e.id === id ? { ...e, ...patch, id } : e) }, 'update');
    },
    deleteSelected: () => commit(removeSelected(graphRef.current), 'remove', true, false),
    selectAll: () => select(new Set(graphRef.current.nodes.map(n => n.id)), new Set(graphRef.current.edges.map(e => e.id))),
    duplicateSelected: () => {
      const g = graphRef.current, ids = new Set(g.nodes.map(n => n.id)), edgeIds = new Set(g.edges.map(e => e.id));
      const mapping = new Map(g.nodes.filter(n => n.selected).map(n => [n.id, uniqueId(n.id, ids)]));
      if (!mapping.size) return;
      const nodes = g.nodes.filter(n => mapping.has(n.id)).map(n => ({
        ...n, id: mapping.get(n.id)!, position: { x: n.position.x + 30, y: n.position.y + 30 }, selected: true,
      }));
      const edges = g.edges.filter(e => mapping.has(e.source) && mapping.has(e.target)).map(e => ({
        ...e, id: uniqueId(e.id, edgeIds), source: mapping.get(e.source)!, target: mapping.get(e.target)!, selected: true,
      }));
      commit({ nodes: [...g.nodes.map(n => n.selected ? { ...n, selected: false } : n), ...nodes], edges: [...g.edges.map(e => e.selected ? { ...e, selected: false } : e), ...edges] }, 'add');
    },
    undo: () => {
      const next = history.undo(graphRef.current);
      if (next) commit(next, 'undo', false, false);
    },
    redo: () => {
      const next = history.redo(graphRef.current);
      if (next) commit(next, 'redo', false, false);
    },
    canUndo: () => history.canUndo,
    canRedo: () => history.canRedo,
    getViewport: () => viewportRef.current,
    setViewport, fitView,
    zoomIn: () => zoomBy(1.2),
    zoomOut: () => zoomBy(1 / 1.2),
    screenToFlowPosition: client => screenToFlow(localPoint(client), viewportRef.current),
    toJSON: () => ({ version: 1, graph: graphRef.current, viewport: viewportRef.current }),
    load: (document: FlowDocument<N, E>) => {
      if (document.version !== 1) throw new Error('Unsupported flow document version.');
      validateGraph(document.graph); validateViewport(document.viewport);
      commit(document.graph, 'load'); setViewport(document.viewport);
    },
  }), [commit, fitView, history, localPoint, select, setViewport, zoomBy]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      sizeRef.current = next;
      setSize(old => old.width === next.width && old.height === next.height ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { propsRef.current.onInit?.(instance); }, [instance]);
  const fitted = useRef(false);
  useEffect(() => {
    if (props.fitView && !fitted.current && size.width && size.height && graph.nodes.length) { fitted.current = true; fitView(); }
  }, [props.fitView, size, graph.nodes.length, fitView]);
  useEffect(() => {
    const v = viewportRef.current;
    if (v.zoom < minZoom || v.zoom > maxZoom) setViewport(v);
  }, [minZoom, maxZoom, setViewport]);
  const selectedNodes = useMemo(() => graph.nodes.filter(n => n.selected), [graph.nodes]);
  const selectedEdges = useMemo(() => graph.edges.filter(e => e.selected), [graph.edges]);
  const selectionKey = JSON.stringify([selectedNodes.map(n => n.id), selectedEdges.map(e => e.id)]);
  useEffect(() => {
    const g = graphRef.current;
    propsRef.current.onSelectionChange?.({ nodes: g.nodes.filter(n => n.selected), edges: g.edges.filter(e => e.selected) });
  }, [selectionKey]);

  const finishConnection = useCallback((nodeId: string, port: Port) => {
    const pending = connectionRef.current;
    if (!pending) return;
    const candidate: Connection = { source: pending.nodeId, sourcePort: pending.port.id, target: nodeId, targetPort: port.id };
    const p = propsRef.current, g = graphRef.current;
    if (p.readOnly || p.nodesConnectable === false) { setConnection(null); return; }
    const valid = port.type === 'target' && isValidConnection(candidate, g, {
      allowSelfConnections: p.allowSelfConnections, allowDuplicates: p.allowDuplicateConnections,
    }) && (p.isValidConnection?.(candidate, g) ?? true);
    setConnection(null);
    if (!valid) { announce('Connection rejected.'); p.onConnectionRejected?.(candidate); return; }
    if (p.autoConnect !== false) {
      const id = uniqueId('edge', new Set(g.edges.map(e => e.id)));
      commit({ ...g, edges: [...g.edges, { id, ...candidate }] }, 'connect');
    }
    announce(`Connected ${candidate.source} to ${candidate.target}.`);
    p.onConnect?.(candidate);
  }, [commit, setConnection]);
  const onPort = useCallback((nodeId: string, port: Port, event: InteractionEvent) => {
    event.preventDefault(); event.stopPropagation();
    const p = propsRef.current;
    if (p.readOnly || p.nodesConnectable === false) return;
    if (connectionRef.current) { finishConnection(nodeId, port); return; }
    if (port.type !== 'source') { announce('Start a connection at an output port.'); return; }
    const node = graphRef.current.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const start = portPosition(node, port);
    setConnection({ nodeId, port, start, end: start });
    if (event.pointerId !== undefined) {
      connectionPointer.current = event.pointerId;
      root.current?.setPointerCapture(event.pointerId);
    }
    announce('Choose an input port to finish the connection. Press Escape to cancel.');
  }, [finishConnection, setConnection]);
  const startNode = useCallback((event: ReactPointerEvent | KeyboardEvent, id: string) => {
    if (editableTarget(event.target)) return;
    if ('pointerId' in event && (gesture.current || nodePress.current || connectionPointer.current !== null)) return;
    const p = propsRef.current, g = graphRef.current;
    if ('button' in event && event.button !== 0) return;
    event.stopPropagation();
    const node = g.nodes.find(n => n.id === id);
    if (!node) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    let selected = new Set(g.nodes.filter(n => n.selected).map(n => n.id));
    if (p.elementsSelectable !== false) {
      if (additive) { if (selected.has(id)) selected.delete(id); else selected.add(id); }
      else if (!node.selected) selected = new Set([id]);
      select(selected, additive ? new Set(g.edges.filter(e => e.selected).map(e => e.id)) : new Set());
    }
    root.current?.focus({ preventScroll: true });
    if ('pointerId' in event) {
      nodePress.current = { id, start: { x: event.clientX, y: event.clientY }, pointerId: event.pointerId, moved: false };
      root.current?.setPointerCapture(event.pointerId);
    }
    if (!('pointerId' in event) || p.readOnly || p.nodesDraggable === false || node.draggable === false || additive && !selected.has(id)) return;
    const moving = g.nodes.filter(n => (selected.has(n.id) || n.id === id) && n.draggable !== false);
    gesture.current = {
      kind: 'move', start: { x: event.clientX, y: event.clientY }, nodes: new Map(moving.map(n => [n.id, n.position])),
      bounds: getBounds(moving), recorded: false, pointerId: event.pointerId,
    };
  }, [select]);
  const clickNode = useCallback((id: string) => {
    const node = graphRef.current.nodes.find(n => n.id === id);
    if (node) propsRef.current.onNodeClick?.(node);
  }, []);
  const constrainDelta = useCallback((delta: Point, bounds: Rect): Point => {
    const extent = propsRef.current.nodeExtent;
    if (!extent) return delta;
    return {
      x: clamp(delta.x, extent.x - bounds.x, Math.max(extent.x - bounds.x, extent.x + extent.width - bounds.x - bounds.width)),
      y: clamp(delta.y, extent.y - bounds.y, Math.max(extent.y - bounds.y, extent.y + extent.height - bounds.y - bounds.height)),
    };
  }, []);
  const moveNodes = useCallback((current: Extract<Gesture, { kind: 'move' }>, client: Point) => {
    const p = propsRef.current, v = viewportRef.current;
    if (p.readOnly || p.nodesDraggable === false) return;
    let delta = { x: (client.x - current.start.x) / v.zoom, y: (client.y - current.start.y) / v.zoom };
    if (!current.recorded && Math.hypot(client.x - current.start.x, client.y - current.start.y) < 3) return;
    const first = current.nodes.values().next().value as Point | undefined;
    if (p.snapGrid && first) delta = {
      x: Math.round((first.x + delta.x) / p.snapGrid[0]) * p.snapGrid[0] - first.x,
      y: Math.round((first.y + delta.y) / p.snapGrid[1]) * p.snapGrid[1] - first.y,
    };
    delta = constrainDelta(delta, current.bounds);
    const g = graphRef.current;
    const next = { ...g, nodes: g.nodes.map(n => {
      const start = current.nodes.get(n.id);
      return start ? { ...n, position: { x: start.x + delta.x, y: start.y + delta.y } } : n;
    }) };
    commit(next, 'move', !current.recorded, false); current.recorded = true;
  }, [commit, constrainDelta]);
  const startPane = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.button !== 0 && event.button !== 1)) return;
    if (gesture.current || nodePress.current || connectionPointer.current !== null) return;
    event.preventDefault(); root.current?.focus({ preventScroll: true });
    if (connectionRef.current) { setConnection(null); announce('Connection cancelled.'); return; }
    const start = { x: event.clientX, y: event.clientY };
    if (event.button === 0 && event.shiftKey && elementsSelectable) {
      gesture.current = { kind: 'select', start, current: start, additive: event.ctrlKey || event.metaKey, pointerId: event.pointerId };
    } else if (props.panOnDrag !== false || space.current || event.button === 1) {
      gesture.current = { kind: 'pan', start, viewport: viewportRef.current, pointerId: event.pointerId };
      if (!space.current && event.button === 0 && elementsSelectable) select(new Set());
    } else if (elementsSelectable) select(new Set());
    if (gesture.current) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const client = { x: event.clientX, y: event.clientY };
    const current = gesture.current;
    if (current && event.pointerId !== current.pointerId) return;
    const pressed = nodePress.current;
    if (pressed && event.pointerId !== pressed.pointerId) return;
    if (pressed && Math.hypot(client.x - pressed.start.x, client.y - pressed.start.y) >= 3) pressed.moved = true;
    if (connectionPointer.current !== null && event.pointerId !== connectionPointer.current) return;
    if (connectionRef.current) {
      const end = screenToFlow(localPoint(client), viewportRef.current);
      schedule(() => { if (connectionRef.current) setConnection({ ...connectionRef.current, end }); });
    } else if (current?.kind === 'pan') {
      schedule(() => setViewport({ ...current.viewport, x: current.viewport.x + client.x - current.start.x, y: current.viewport.y + client.y - current.start.y }));
    } else if (current?.kind === 'move') {
      schedule(() => moveNodes(current, client));
    } else if (current?.kind === 'select') {
      current.current = client;
      const a = screenToFlow(localPoint(current.start), viewportRef.current), b = screenToFlow(localPoint(client), viewportRef.current);
      schedule(() => setSelectionBox({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }));
    }
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current && event.pointerId !== current.pointerId) return;
    const pressed = nodePress.current;
    if (pressed && event.pointerId !== pressed.pointerId) return;
    if (connectionPointer.current !== null && event.pointerId !== connectionPointer.current) return;
    flush();
    const client = { x: event.clientX, y: event.clientY };
    if (current?.kind === 'move') moveNodes(current, client);
    if (current?.kind === 'pan') setViewport({ ...current.viewport, x: current.viewport.x + client.x - current.start.x, y: current.viewport.y + client.y - current.start.y });
    if (current?.kind === 'select') current.current = client;
    if (pressed && !pressed.moved && Math.hypot(client.x - pressed.start.x, client.y - pressed.start.y) < 3) clickNode(pressed.id);
    nodePress.current = null;
    if (connectionRef.current) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-port-type="target"]');
      const nodeId = target?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
      const node = graphRef.current.nodes.find(n => n.id === nodeId);
      const port = node && getPort(node, 'target', target?.dataset.portId);
      if (node && port && root.current?.contains(target ?? null)) finishConnection(node.id, port);
    }
    if (current?.kind === 'select') {
      const a = screenToFlow(localPoint(current.start), viewportRef.current), b = screenToFlow(localPoint(current.current), viewportRef.current);
      const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
      const ids = new Set(graphRef.current.nodes.filter(n => intersects(nodeRect(n), box) || current.additive && n.selected).map(n => n.id));
      select(ids, current.additive ? new Set(graphRef.current.edges.filter(e => e.selected).map(e => e.id)) : new Set());
    }
    gesture.current = null; connectionPointer.current = null; setSelectionBox(null);
    if (root.current?.hasPointerCapture(event.pointerId)) root.current.releasePointerCapture(event.pointerId);
  };
  const cancelGesture = useCallback(() => {
    flush();
    const pointerId = gesture.current?.pointerId ?? connectionPointer.current ?? nodePress.current?.pointerId;
    gesture.current = null; connectionPointer.current = null; nodePress.current = null;
    if (pointerId !== null && pointerId !== undefined && root.current?.hasPointerCapture(pointerId)) root.current.releasePointerCapture(pointerId);
    setConnection(null); setSelectionBox(null); space.current = false;
  }, [flush, setConnection]);
  useEffect(() => {
    // Pointer cancellation (OS gestures, focus loss) must never leave a connection armed.
    const cancel = () => cancelGesture();
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [cancelGesture]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (editableTarget(event.target) || propsRef.current.zoomOnScroll === false) return;
      event.preventDefault();
      const p = propsRef.current, v = viewportRef.current;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? sizeRef.current.height : 1);
      setViewport(zoomAt(v, localPoint({ x: event.clientX, y: event.clientY }), clamp(v.zoom * Math.exp(-delta * 0.002), p.minZoom ?? 0.1, p.maxZoom ?? 4)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [localPoint, setViewport]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); cancelGesture(); announce('Interaction cancelled.'); return; }
    if (editableTarget(event.target)) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (key === ' ') { event.preventDefault(); space.current = true; return; }
    if (mod && key === 'a' && elementsSelectable) { event.preventDefault(); instance.selectAll(); return; }
    if (readOnly) return;
    if (mod && key === 'z') { event.preventDefault(); cancelGesture(); if (event.shiftKey) instance.redo(); else instance.undo(); }
    else if (mod && key === 'y') { event.preventDefault(); cancelGesture(); instance.redo(); }
    else if (mod && key === 'd') { event.preventDefault(); instance.duplicateSelected(); }
    else if (key === 'delete' || key === 'backspace') { event.preventDefault(); instance.deleteSelected(); }
    else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && props.nodesDraggable !== false) {
      const g = graphRef.current, moving = g.nodes.filter(n => n.selected && n.draggable !== false);
      if (!moving.length) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const delta = constrainDelta({
        x: key === 'arrowleft' ? -(snapGrid?.[0] ?? step) : key === 'arrowright' ? snapGrid?.[0] ?? step : 0,
        y: key === 'arrowup' ? -(snapGrid?.[1] ?? step) : key === 'arrowdown' ? snapGrid?.[1] ?? step : 0,
      }, getBounds(moving));
      const ids = new Set(moving.map(n => n.id));
      commit({ ...g, nodes: g.nodes.map(n => ids.has(n.id) ? { ...n, position: { x: n.position.x + delta.x, y: n.position.y + delta.y } } : n) }, 'move', true, false);
    }
  };
  const nodeMap = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph.nodes]);
  const viewRect = { x: (-viewport.x - 200) / viewport.zoom, y: (-viewport.y - 200) / viewport.zoom, width: (size.width + 400) / viewport.zoom, height: (size.height + 400) / viewport.zoom };
  const visibleNodes = props.onlyRenderVisibleElements ? graph.nodes.filter(n => intersects(nodeRect(n), viewRect)) : graph.nodes;
  const background = props.background ?? 'dots';
  const grid = gridSize * viewport.zoom;
  const canvasStyle: CSSProperties = {
    ...props.style,
    backgroundImage: background === 'dots' ? 'radial-gradient(circle, var(--rfc-grid) 1px, transparent 1px)' : background === 'lines' ? 'linear-gradient(var(--rfc-grid) 1px, transparent 1px), linear-gradient(90deg, var(--rfc-grid) 1px, transparent 1px)' : 'none',
    backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px`,
  };
  return <FlowContext.Provider value={{ instance, size }}>
    <div
      ref={root} className={`rfc-canvas${readOnly ? ' rfc-readonly' : ''}${props.className ? ` ${props.className}` : ''}`}
      style={canvasStyle} tabIndex={0} role="region" aria-label={props.ariaLabel ?? 'Flow editor'}
      aria-roledescription="interactive graph editor"
      onPointerDown={startPane} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={cancelGesture}
      onKeyDown={keyDown} onKeyUp={event => { if (event.key === ' ') space.current = false; }}
      onDoubleClick={event => {
        if (event.target === event.currentTarget) props.onPaneDoubleClick?.(screenToFlow(localPoint({ x: event.clientX, y: event.clientY }), viewportRef.current));
      }}
    >
      <div className="rfc-viewport" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        <svg className="rfc-edges" aria-label="Connections">
          <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
          {graph.edges.map(edge => {
            const sourceNode = nodeMap.get(edge.source), targetNode = nodeMap.get(edge.target);
            if (!sourceNode || !targetNode) return null;
            const sp = getPort(sourceNode, 'source', edge.sourcePort), tp = getPort(targetNode, 'target', edge.targetPort);
            if (!sp || !tp) return null;
            const source = portPosition(sourceNode, sp), target = portPosition(targetNode, tp);
            const geometry = getEdgePath(source, target, edge.type, portSide(sp), portSide(tp));
            if (props.onlyRenderVisibleElements) {
              // Control points can extend beyond endpoints. Include their maximum excursion.
              const margin = Math.max(48, Math.hypot(target.x - source.x, target.y - source.y) * 0.4) + 32;
              if (!intersects({ x: Math.min(source.x, target.x) - margin, y: Math.min(source.y, target.y) - margin, width: Math.abs(target.x - source.x) + 2 * margin, height: Math.abs(target.y - source.y) + 2 * margin }, viewRect)) return null;
            }
            const Renderer = props.edgeTypes?.[edge.type ?? 'bezier'];
            const selectEdge = (additive: boolean) => {
              if (!elementsSelectable) return;
              const g = graphRef.current;
              const ids = new Set(additive ? g.edges.filter(e => e.selected).map(e => e.id) : []);
              if (additive && ids.has(edge.id)) ids.delete(edge.id); else ids.add(edge.id);
              select(new Set(additive ? g.nodes.filter(n => n.selected).map(n => n.id) : []), ids);
            };
            return <g
              key={edge.id} className={`rfc-edge${edge.selected ? ' rfc-selected' : ''}${edge.animated ? ' rfc-animated' : ''}`}
              data-edge-id={edge.id} role="button" aria-label={edge.label ?? `Edge ${edge.source} to ${edge.target}`}
              aria-pressed={edge.selected === true} tabIndex={elementsSelectable ? 0 : undefined}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => { selectEdge(event.shiftKey || event.ctrlKey || event.metaKey); props.onEdgeClick?.(edge); root.current?.focus({ preventScroll: true }); }}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); selectEdge(event.shiftKey); } }}
            >
              <path className="rfc-edge-hit" d={geometry.path} />
              {Renderer ? <Renderer edge={edge} {...geometry} source={source} target={target} markerId={markerId} /> :
                <path className="rfc-edge-path" d={geometry.path} style={edge.style} markerEnd={`url(#${markerId})`} />}
              {edge.label && <g className="rfc-edge-label" transform={`translate(${geometry.label.x}, ${geometry.label.y})`}>
                <rect x={-Math.max(28, edge.label.length * 3.5 + 8)} y="-12" width={Math.max(56, edge.label.length * 7 + 16)} height="24" rx="5" />
                <text textAnchor="middle" dominantBaseline="central">{edge.label}</text>
              </g>}
            </g>;
          })}
          {connection && <path className="rfc-connection-preview" d={getEdgePath(connection.start, connection.end, 'bezier', portSide(connection.port)).path} />}
        </svg>
        <div className="rfc-nodes">
          {visibleNodes.map(node => <NodeView
            key={node.id} node={node} renderer={props.nodeTypes?.[node.type ?? 'default']}
            selectable={elementsSelectable} connectable={!readOnly && props.nodesConnectable !== false}
            connecting={connection !== null} onStart={startNode} onPort={onPort} onClick={clickNode}
          />)}
        </div>
        {selectionBox && <div className="rfc-selection" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }} />}
      </div>
      {props.showControls !== false && <Controls readOnly={readOnly} />}
      {props.showMiniMap && <MiniMap />}
      {props.children}
      <span className="rfc-sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  </FlowContext.Provider>;
}

export function Controls({ readOnly = false }: { readOnly?: boolean }) {
  const flow = useFlowCanvas();
  return <div className="rfc-controls" data-flow-ignore role="toolbar" aria-label="Canvas controls">
    <button type="button" onClick={flow.zoomIn} aria-label="Zoom in" title="Zoom in">+</button>
    <button type="button" onClick={flow.zoomOut} aria-label="Zoom out" title="Zoom out">-</button>
    <button type="button" onClick={() => flow.fitView()} aria-label="Fit view" title="Fit view">Fit</button>
    {!readOnly && <>
      <button type="button" onClick={flow.undo} disabled={!flow.canUndo()} aria-label="Undo" title="Undo">Undo</button>
      <button type="button" onClick={flow.redo} disabled={!flow.canRedo()} aria-label="Redo" title="Redo">Redo</button>
    </>}
  </div>;
}

export interface MiniMapProps { width?: number; height?: number; className?: string }
export function MiniMap({ width = 180, height = 120, className = '' }: MiniMapProps) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new RangeError('Minimap dimensions must be positive.');
  const flow = useFlowCanvas();
  const context = useContext(FlowContext);
  const graph = flow.getGraph(), v = flow.getViewport();
  // Context consumers re-render with the canvas, including on viewport changes.
  const bounds = getBounds(graph.nodes);
  const fitted = fitBounds(bounds, { width, height }, 12, 0.001, 1);
  const size = context?.size ?? { width: 0, height: 0 };
  const view = { x: -v.x / v.zoom, y: -v.y / v.zoom, width: size.width / v.zoom, height: size.height / v.zoom };
  return <svg
    className={`rfc-minimap ${className}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
    data-flow-ignore role="img" aria-label="Graph minimap. Click to center the viewport."
    onPointerDown={event => {
      event.stopPropagation(); event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const center = screenToFlow({ x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height }, fitted);
      flow.setViewport({ x: size.width / 2 - center.x * v.zoom, y: size.height / 2 - center.y * v.zoom, zoom: v.zoom });
    }}
  >
    <g transform={`translate(${fitted.x}, ${fitted.y}) scale(${fitted.zoom})`}>
      {graph.nodes.map(node => { const r = nodeRect(node); return <rect key={node.id} {...r} rx={4 / fitted.zoom} className={node.selected ? 'rfc-minimap-selected' : 'rfc-minimap-node'} />; })}
      <rect {...view} className="rfc-minimap-viewport" strokeWidth={1 / fitted.zoom} />
    </g>
  </svg>;
}

export function Panel({ children, position = 'top-left', className = '' }: { children: ReactNode; position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; className?: string }) {
  return <div className={`rfc-panel rfc-panel-${position} ${className}`} data-flow-ignore>{children}</div>;
}
