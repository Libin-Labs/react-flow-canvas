import { getPort } from './geometry.js';
import type { Connection, FlowDocument, FlowEdge, Graph, Viewport } from './types.js';

export class FlowValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'FlowValidationError'; }
}
const fail = (message: string): never => { throw new FlowValidationError(message); };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const point = (value: unknown): boolean => record(value) && finite(value.x) && finite(value.y);
const optionalBoolean = (value: unknown): boolean => value === undefined || typeof value === 'boolean';

export function validateViewport(value: unknown): asserts value is Viewport {
  if (!record(value) || !point(value) || !finite(value.zoom) || value.zoom <= 0) fail('Viewport requires finite x/y and a positive zoom.');
}
/** Validates structural graph fields. Application data requires your own schema. */
export function validateGraph(value: unknown): asserts value is Graph<unknown, unknown> {
  if (!record(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) fail('Graph requires nodes and edges arrays.');
  const graph = value as Record<string, unknown[]>;
  const ids = new Set<string>();
  for (const raw of graph.nodes) {
    if (!record(raw) || !identifier(raw.id) || !point(raw.position) || !('data' in raw)) fail('Each node requires a nonempty id, finite position and data.');
    const node = raw as Record<string, unknown>;
    const id = node.id as string;
    if (ids.has(id)) fail(`Duplicate node id: ${id}`);
    ids.add(id);
    for (const key of ['width', 'height']) {
      if (node[key] !== undefined && (!finite(node[key]) || (node[key] as number) <= 0)) fail(`Invalid ${key} on node ${id}.`);
    }
    for (const key of ['selected', 'draggable', 'deletable']) if (!optionalBoolean(node[key])) fail(`Invalid ${key} on node ${id}.`);
    for (const key of ['type', 'className']) if (node[key] !== undefined && typeof node[key] !== 'string') fail(`Invalid ${key} on node ${id}.`);
    if (node.ports !== undefined) {
      if (!Array.isArray(node.ports)) fail(`Ports must be an array on node ${id}.`);
      const portIds = new Set<string>();
      for (const port of node.ports as unknown[]) {
        if (!record(port) || !identifier(port.id) || (port.type !== 'source' && port.type !== 'target')) fail(`Invalid port on node ${id}.`);
        const p = port as Record<string, unknown>;
        if (portIds.has(p.id as string)) fail(`Duplicate port id on node ${id}.`);
        portIds.add(p.id as string);
        if (p.side !== undefined && (typeof p.side !== 'string' || !['left', 'right', 'top', 'bottom'].includes(p.side))) fail(`Invalid port side on node ${id}.`);
        if (p.offset !== undefined && (!finite(p.offset) || p.offset < 0 || p.offset > 1)) fail(`Invalid port offset on node ${id}.`);
        if (p.label !== undefined && typeof p.label !== 'string') fail(`Invalid port label on node ${id}.`);
      }
    }
  }
  const typed = value as Graph<unknown, unknown>;
  const nodeMap = new Map(typed.nodes.map(node => [node.id, node]));
  const edgeIds = new Set<string>();
  for (const raw of graph.edges) {
    if (!record(raw) || !identifier(raw.id) || !identifier(raw.source) || !identifier(raw.target)) fail('Each edge requires nonempty id, source and target.');
    const e = raw as Record<string, unknown>;
    if (edgeIds.has(e.id as string)) fail(`Duplicate edge id: ${e.id}`);
    edgeIds.add(e.id as string);
    const source = nodeMap.get(e.source as string), target = nodeMap.get(e.target as string);
    if (!source || !target) fail(`Missing endpoint for edge ${e.id}.`);
    for (const key of ['sourcePort', 'targetPort', 'label']) if (e[key] !== undefined && typeof e[key] !== 'string') fail(`Invalid ${key} on edge ${e.id}.`);
    if (!getPort(source!, 'source', e.sourcePort as string | undefined) || !getPort(target!, 'target', e.targetPort as string | undefined)) fail(`Missing or incompatible port for edge ${e.id}.`);
    if (e.type !== undefined && (typeof e.type !== 'string' || !['bezier', 'straight', 'step'].includes(e.type))) fail(`Invalid edge type: ${e.type}`);
    for (const key of ['selected', 'animated', 'deletable']) if (!optionalBoolean(e[key])) fail(`Invalid ${key} on edge ${e.id}.`);
    if (e.style !== undefined && !record(e.style)) fail(`Invalid style on edge ${e.id}.`);
    if (record(e.style) && Object.values(e.style).some(v => v !== undefined && typeof v !== 'string' && !finite(v))) fail(`Style values must be strings or finite numbers on edge ${e.id}.`);
  }
}
export function isValidConnection<N, E>(connection: Connection, graph: Graph<N, E>, options: { allowSelfConnections?: boolean; allowDuplicates?: boolean } = {}): boolean {
  const source = graph.nodes.find(n => n.id === connection.source), target = graph.nodes.find(n => n.id === connection.target);
  if (!source || !target || (!options.allowSelfConnections && source.id === target.id)) return false;
  const sp = getPort(source, 'source', connection.sourcePort), tp = getPort(target, 'target', connection.targetPort);
  if (!sp || !tp) return false;
  return options.allowDuplicates === true || !graph.edges.some(e =>
    e.source === source.id && e.target === target.id &&
    getPort(source, 'source', e.sourcePort)?.id === sp.id && getPort(target, 'target', e.targetPort)?.id === tp.id);
}
export function addEdge<N, E>(edge: FlowEdge<E>, graph: Graph<N, E>): Graph<N, E> {
  const next = { ...graph, edges: [...graph.edges, edge] };
  validateGraph(next);
  return next;
}
export function removeSelected<N, E>(graph: Graph<N, E>): Graph<N, E> {
  const removed = new Set(graph.nodes.filter(n => n.selected && n.deletable !== false).map(n => n.id));
  // A protected edge also protects its endpoints from deletion.
  for (const edge of graph.edges) if (edge.deletable === false) { removed.delete(edge.source); removed.delete(edge.target); }
  const nodes = graph.nodes.filter(n => !removed.has(n.id));
  const edges = graph.edges.filter(e => !removed.has(e.source) && !removed.has(e.target) && !(e.selected && e.deletable !== false));
  return nodes.length === graph.nodes.length && edges.length === graph.edges.length ? graph : { nodes, edges };
}
export function getConnectedEdges<N, E>(nodeIds: readonly string[], graph: Graph<N, E>): FlowEdge<E>[] {
  const ids = new Set(nodeIds);
  return graph.edges.filter(e => ids.has(e.source) || ids.has(e.target));
}
export function getIncomers<N, E>(id: string, graph: Graph<N, E>) {
  const ids = new Set(graph.edges.filter(e => e.target === id).map(e => e.source));
  return graph.nodes.filter(n => ids.has(n.id));
}
export function getOutgoers<N, E>(id: string, graph: Graph<N, E>) {
  const ids = new Set(graph.edges.filter(e => e.source === id).map(e => e.target));
  return graph.nodes.filter(n => ids.has(n.id));
}
export function hasCycle<N, E>(graph: Graph<N, E>): boolean {
  const degrees = new Map(graph.nodes.map(n => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const e of graph.edges) {
    degrees.set(e.target, (degrees.get(e.target) ?? 0) + 1);
    const list = outgoing.get(e.source) ?? []; list.push(e.target); outgoing.set(e.source, list);
  }
  const queue = [...degrees].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  for (let i = 0; i < queue.length; i++) {
    visited++;
    for (const target of outgoing.get(queue[i]) ?? []) {
      const degree = degrees.get(target)! - 1; degrees.set(target, degree);
      if (degree === 0) queue.push(target);
    }
  }
  return visited !== graph.nodes.length;
}
export function serialize<N, E>(graph: Graph<N, E>, viewport: Viewport = { x: 0, y: 0, zoom: 1 }): string {
  validateGraph(graph); validateViewport(viewport);
  const document: FlowDocument<N, E> = { version: 1, graph, viewport };
  return JSON.stringify(document);
}
export function parseDocument(text: string): FlowDocument<unknown, unknown> {
  const value: unknown = JSON.parse(text);
  if (!record(value) || value.version !== 1) fail('Unsupported flow document version.');
  const doc = value as Record<string, unknown>;
  validateGraph(doc.graph); validateViewport(doc.viewport);
  return { version: 1, graph: doc.graph as Graph<unknown, unknown>, viewport: doc.viewport as Viewport };
}
/** Snapshots use immutable references; do not mutate a graph after passing it in. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(readonly limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('History limit must be a positive integer.');
  }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  push(value: T): void { this.past.push(value); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  undo(current: T): T | undefined {
    if (!this.canUndo) return undefined;
    this.future.push(current); return this.past.pop();
  }
  redo(current: T): T | undefined {
    if (!this.canRedo) return undefined;
    this.past.push(current); return this.future.pop();
  }
  clear(): void { this.past = []; this.future = []; }
}
