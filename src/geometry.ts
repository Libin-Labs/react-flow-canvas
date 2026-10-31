import type { EdgeType, FlowNode, Point, Port, Rect, Side, Size, Viewport } from './types.js';

export const DEFAULT_NODE_WIDTH = 180;
export const DEFAULT_NODE_HEIGHT = 80;
export const DEFAULT_PORTS: Port[] = [
  { id: 'in', type: 'target', side: 'left' },
  { id: 'out', type: 'source', side: 'right' },
];
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export function nodeRect(node: FlowNode<unknown>): Rect {
  return { ...node.position, width: node.width ?? DEFAULT_NODE_WIDTH, height: node.height ?? DEFAULT_NODE_HEIGHT };
}
export function getBounds(nodes: readonly FlowNode<unknown>[]): Rect {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of nodes) {
    const r = nodeRect(node);
    left = Math.min(left, r.x); top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width); bottom = Math.max(bottom, r.y + r.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}
export function screenToFlow(point: Point, viewport: Viewport): Point {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}
export function flowToScreen(point: Point, viewport: Viewport): Point {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y };
}
export function zoomAt(viewport: Viewport, point: Point, zoom: number): Viewport {
  const anchor = screenToFlow(point, viewport);
  return { x: point.x - anchor.x * zoom, y: point.y - anchor.y * zoom, zoom };
}
export function fitBounds(bounds: Rect, size: Size, padding = 40, minZoom = 0.1, maxZoom = 2): Viewport {
  const zoom = clamp(Math.min(
    Math.max(1, size.width - padding * 2) / Math.max(1, bounds.width),
    Math.max(1, size.height - padding * 2) / Math.max(1, bounds.height),
  ), minZoom, maxZoom);
  return { x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom };
}
export function getPort(node: FlowNode<unknown>, type: Port['type'], id?: string): Port | undefined {
  return (node.ports ?? DEFAULT_PORTS).find(port => port.type === type && (id === undefined || port.id === id));
}
export function portSide(port: Port): Side { return port.side ?? (port.type === 'source' ? 'right' : 'left'); }
export function portPosition(node: FlowNode<unknown>, port: Port): Point {
  const r = nodeRect(node), offset = port.offset ?? 0.5, side = portSide(port);
  return {
    x: r.x + (side === 'left' ? 0 : side === 'right' ? r.width : r.width * offset),
    y: r.y + (side === 'top' ? 0 : side === 'bottom' ? r.height : r.height * offset),
  };
}
function direction(side: Side): Point {
  return { x: side === 'left' ? -1 : side === 'right' ? 1 : 0, y: side === 'top' ? -1 : side === 'bottom' ? 1 : 0 };
}
export function getEdgePath(source: Point, target: Point, type: EdgeType = 'bezier', sourceSide: Side = 'right', targetSide: Side = 'left'): { path: string; label: Point } {
  const label = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
  if (type === 'straight') return { path: `M ${source.x} ${source.y} L ${target.x} ${target.y}`, label };
  const sd = direction(sourceSide), td = direction(targetSide);
  if (type === 'step') {
    const a = { x: source.x + sd.x * 24, y: source.y + sd.y * 24 };
    const b = { x: target.x + td.x * 24, y: target.y + td.y * 24 };
    const middle = sd.x ? `L ${label.x} ${a.y} L ${label.x} ${b.y}` : `L ${a.x} ${label.y} L ${b.x} ${label.y}`;
    return { path: `M ${source.x} ${source.y} L ${a.x} ${a.y} ${middle} L ${b.x} ${b.y} L ${target.x} ${target.y}`, label };
  }
  const distance = Math.max(48, Math.hypot(target.x - source.x, target.y - source.y) * 0.4);
  const c1 = { x: source.x + sd.x * distance, y: source.y + sd.y * distance };
  const c2 = { x: target.x + td.x * distance, y: target.y + td.y * distance };
  return {
    path: `M ${source.x} ${source.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${target.x} ${target.y}`,
    label: { x: (source.x + 3 * c1.x + 3 * c2.x + target.x) / 8, y: (source.y + 3 * c1.y + 3 * c2.y + target.y) / 8 },
  };
}
