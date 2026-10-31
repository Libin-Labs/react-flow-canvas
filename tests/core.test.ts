import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  History, FlowValidationError, addEdge, getConnectedEdges, getIncomers, getOutgoers,
  hasCycle, isValidConnection, parseDocument, removeSelected, serialize, validateGraph, validateViewport,
} from '../src/graph';
import {
  fitBounds, flowToScreen, getBounds, getEdgePath, getPort, intersects,
  nodeRect, portPosition, screenToFlow, zoomAt,
} from '../src/geometry';
import type { Graph } from '../src/types';

const graph = (): Graph => ({
  nodes: [
    { id: 'a', position: { x: 10, y: 20 }, data: { label: 'A' } },
    { id: 'b', position: { x: 300, y: 150 }, data: { label: 'B' }, width: 100, height: 50 },
    { id: 'c', position: { x: -100, y: -50 }, data: {} },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b' }],
});

test('validates default ports and explicit nodes', () => assert.doesNotThrow(() => validateGraph(graph())));
test('rejects malformed, duplicate and nonfinite graph fields', () => {
  const invalid: unknown[] = [
    null, {}, { nodes: [], edges: null },
    { nodes: [{ id: '', position: { x: 0, y: 0 }, data: {} }], edges: [] },
    { nodes: [{ id: 'a', position: { x: Infinity, y: 0 }, data: {} }], edges: [] },
    { nodes: [{ id: 'a', position: { x: 0, y: 0 } }], edges: [] },
    { ...graph(), nodes: [...graph().nodes, graph().nodes[0]] },
    { ...graph(), nodes: [{ ...graph().nodes[0], width: -1 }] },
    { ...graph(), nodes: [{ ...graph().nodes[0], selected: 'yes' }] },
    { ...graph(), edges: [{ id: 'x', source: 'a', target: 'missing' }] },
    { ...graph(), edges: [...graph().edges, ...graph().edges] },
    { ...graph(), edges: [{ id: 'x', source: 'a', target: 'b', type: 'invalid' }] },
    { ...graph(), edges: [{ id: 'x', source: 'a', target: 'b', type: ['bezier'] }] },
    { ...graph(), edges: [{ id: 'x', source: 'a', target: 'b', style: { stroke: {} } }] },
    { ...graph(), edges: [{ id: 'x', source: 'a', target: 'b', style: { strokeWidth: NaN } }] },
    { ...graph(), edges: [{ id: 'x', source: 'a', target: 'b', sourcePort: 'missing' }] },
    { ...graph(), nodes: [{ ...graph().nodes[0], ports: [{ id: 'p', type: 'source', offset: 2 }] }], edges: [] },
    { ...graph(), nodes: [{ ...graph().nodes[0], ports: [{ id: 'p', type: 'source', side: ['left'] }] }], edges: [] },
    { ...graph(), nodes: [{ ...graph().nodes[0], ports: [{ id: 'p', type: 'source' }, { id: 'p', type: 'target' }] }], edges: [] },
  ];
  for (const value of invalid) assert.throws(() => validateGraph(value), FlowValidationError);
});
test('validates viewports', () => {
  validateViewport({ x: -10, y: 20, zoom: 0.1 });
  for (const value of [{ x: 0, y: 0, zoom: 0 }, { x: NaN, y: 0, zoom: 1 }, null]) assert.throws(() => validateViewport(value), FlowValidationError);
});
test('connection validation resolves default port aliases and duplicate rules', () => {
  const g = graph();
  assert.equal(isValidConnection({ source: 'a', target: 'b', sourcePort: 'out', targetPort: 'in' }, g), false);
  assert.equal(isValidConnection({ source: 'a', target: 'b' }, g, { allowDuplicates: true }), true);
  assert.equal(isValidConnection({ source: 'a', target: 'a' }, g), false);
  assert.equal(isValidConnection({ source: 'a', target: 'a' }, g, { allowSelfConnections: true }), true);
  assert.equal(isValidConnection({ source: 'a', target: 'c' }, g), true);
  assert.equal(isValidConnection({ source: 'a', target: 'missing' }, g), false);
  assert.equal(isValidConnection({ source: 'a', target: 'c', sourcePort: 'in' }, g), false);
});
test('explicit empty ports make nodes nonconnectable', () => {
  const g = graph(); g.nodes[2].ports = [];
  assert.equal(isValidConnection({ source: 'a', target: 'c' }, g), false);
});
test('addEdge is immutable and rejects dangling endpoints', () => {
  const g = graph(), next = addEdge({ id: 'bc', source: 'b', target: 'c' }, g);
  assert.equal(g.edges.length, 1); assert.equal(next.edges.length, 2); assert.equal(next.nodes, g.nodes);
  assert.throws(() => addEdge({ id: 'bad', source: 'bad', target: 'c' }, g), FlowValidationError);
});
test('deleting selected nodes removes incident edges, without mutating input', () => {
  const g = graph(); g.nodes[0].selected = true;
  const next = removeSelected(g);
  assert.equal(next.nodes.length, 2); assert.equal(next.edges.length, 0); assert.equal(g.nodes.length, 3);
});
test('protected edges protect endpoints and protected nodes survive deletion', () => {
  const g = graph(); g.nodes[0].selected = true; g.edges[0].deletable = false;
  assert.equal(removeSelected(g), g);
  g.edges[0].deletable = true; g.nodes[0].deletable = false;
  assert.equal(removeSelected(g), g);
  g.edges[0].selected = true; assert.equal(removeSelected(g).edges.length, 0);
});
test('queries incoming, outgoing and connected elements', () => {
  const g = graph();
  assert.deepEqual(getIncomers('b', g).map(n => n.id), ['a']);
  assert.deepEqual(getOutgoers('a', g).map(n => n.id), ['b']);
  assert.deepEqual(getConnectedEdges(['a', 'b'], g).map(e => e.id), ['ab']);
});
test('cycle detection handles disconnected graphs, loops and large chains iteratively', () => {
  const g = graph(); assert.equal(hasCycle(g), false);
  g.edges.push({ id: 'ba', source: 'b', target: 'a' }); assert.equal(hasCycle(g), true);
  g.edges = [{ id: 'cc', source: 'c', target: 'c' }]; assert.equal(hasCycle(g), true);
  const nodes = Array.from({ length: 20_000 }, (_, i) => ({ id: String(i), position: { x: i, y: 0 }, data: {} }));
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: String(i), target: n.id }));
  assert.equal(hasCycle({ nodes, edges }), false);
});
test('serialization round-trips data, ports, edge styles and viewport', () => {
  const g = graph(); g.edges[0].style = { stroke: 'red' };
  const v = { x: -70, y: 15, zoom: 1.7 };
  assert.deepEqual(parseDocument(serialize(g, v)), { version: 1, graph: g, viewport: v });
});
test('parsing rejects invalid JSON, versions, graph and viewport', () => {
  for (const text of ['{', '{}', '{"version":2}', JSON.stringify({ version: 1, graph: graph(), viewport: { x: 0, y: 0, zoom: -1 } })]) assert.throws(() => parseDocument(text));
});
test('history bounds memory and invalidates redo when branching', () => {
  const h = new History<number>(2);
  h.push(1); h.push(2); h.push(3);
  assert.equal(h.undo(4), 3); assert.equal(h.undo(3), 2); assert.equal(h.undo(2), undefined);
  assert.equal(h.redo(2), 3);
  h.push(3); assert.equal(h.canRedo, false);
  h.clear(); assert.equal(h.canUndo, false);
  assert.throws(() => new History(0), RangeError);
});
test('geometry uses explicit dimensions and handles negative bounds', () => {
  assert.deepEqual(nodeRect(graph().nodes[0]), { x: 10, y: 20, width: 180, height: 80 });
  assert.deepEqual(getBounds(graph().nodes), { x: -100, y: -50, width: 500, height: 250 });
  assert.deepEqual(getBounds([]), { x: 0, y: 0, width: 0, height: 0 });
  assert.equal(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 5, width: 5, height: 5 }), true);
});
test('screen conversions round-trip and cursor zoom keeps anchor fixed', () => {
  const v = { x: -30, y: 90, zoom: 2 }, p = { x: 24, y: -8 };
  assert.deepEqual(screenToFlow(flowToScreen(p, v), v), p);
  const cursor = { x: 100, y: 200 }, next = zoomAt(v, cursor, 0.5);
  assert.deepEqual(screenToFlow(cursor, next), screenToFlow(cursor, v));
});
test('fit bounds respects zoom limits and centers content', () => {
  const bounds = { x: -100, y: 0, width: 400, height: 200 };
  const v = fitBounds(bounds, { width: 800, height: 600 }, 40, 0.1, 1);
  assert.equal(v.zoom, 1);
  assert.deepEqual(flowToScreen({ x: 100, y: 100 }, v), { x: 400, y: 300 });
});
test('ports support every side and offsets', () => {
  const n = graph().nodes[1];
  assert.deepEqual(portPosition(n, { id: 'a', type: 'source', side: 'top', offset: 0.25 }), { x: 325, y: 150 });
  assert.deepEqual(portPosition(n, { id: 'a', type: 'source', side: 'bottom' }), { x: 350, y: 200 });
  assert.deepEqual(portPosition(n, { id: 'a', type: 'target' }), { x: 300, y: 175 });
  assert.equal(getPort(n, 'source')?.id, 'out');
});
test('all edge paths are finite, start/end correctly, and bezier labels sit on curve', () => {
  for (const type of ['bezier', 'straight', 'step'] as const) {
    const { path, label } = getEdgePath({ x: 0, y: 20 }, { x: 300, y: 100 }, type);
    assert.ok(path.startsWith('M 0 20')); assert.ok(path.endsWith('300 100'));
    assert.ok(Number.isFinite(label.x) && Number.isFinite(label.y)); assert.ok(!path.includes('NaN'));
  }
  const edge = getEdgePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 'bezier', 'top', 'left');
  assert.notEqual(edge.label.y, 0);
});
