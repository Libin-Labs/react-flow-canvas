import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import { FlowCanvas, Panel, useFlowCanvas } from '../src/FlowCanvas';
import type { FlowCanvasProps } from '../src/FlowCanvas';
import type { FlowInstance, Graph } from '../src/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(Date.now()), 1),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});
const { createRoot } = await import('react-dom/client');
const browserErrors: unknown[] = [];
dom.window.addEventListener('error', event => { browserErrors.push(event.error); });
const captures = new Set<number>();
dom.window.HTMLElement.prototype.setPointerCapture = id => { captures.add(id); };
dom.window.HTMLElement.prototype.hasPointerCapture = id => captures.has(id);
dom.window.HTMLElement.prototype.releasePointerCapture = id => { captures.delete(id); };
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => 1000 });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get: () => 700 });
dom.window.document.elementFromPoint = () => null;
type Data = { label: string };
const seed = (): Graph<Data> => ({
  nodes: [
    { id: 'a', position: { x: 40, y: 40 }, data: { label: 'Alpha' } },
    { id: 'b', position: { x: 400, y: 80 }, data: { label: 'Beta' } },
  ],
  edges: [],
});
let root: Root | undefined;
let host: HTMLDivElement;
let flow: FlowInstance<Data>;
async function mount(props: FlowCanvasProps<Data> = {}) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<FlowCanvas<Data> defaultValue={seed()} {...props} onInit={instance => { flow = instance; props.onInit?.(instance); }} />); });
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; host?.remove(); captures.clear();
  dom.window.document.elementFromPoint = () => null;
  assert.deepEqual(browserErrors.splice(0), [], 'No uncaught browser errors');
});
const pane = () => host.querySelector<HTMLElement>('.rfc-canvas')!;
const node = (id: string) => host.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
async function pointer(target: Element, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  await act(async () => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}
async function key(key: string, extra: KeyboardEventInit = {}, target: Element = pane()) {
  await act(async () => { target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...extra })); });
}
async function click(target: Element) {
  await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
}

test('renders nodes, default ports, controls and minimap', async () => {
  await mount({ showMiniMap: true });
  assert.equal(host.querySelectorAll('.rfc-node').length, 2);
  assert.equal(host.querySelectorAll('.rfc-port').length, 4);
  assert.ok(host.querySelector('[aria-label="Zoom in"]'));
  assert.ok(host.querySelector('.rfc-minimap'));
});
test('programmatic operations preserve data, validate and support undo/redo', async () => {
  await mount();
  await act(async () => flow.addEdges([{ id: 'ab', source: 'a', target: 'b' }]));
  assert.equal(flow.getGraph().edges.length, 1);
  await act(async () => flow.undo()); assert.equal(flow.getGraph().edges.length, 0);
  await act(async () => flow.redo()); assert.equal(flow.getGraph().edges.length, 1);
  assert.throws(() => flow.updateNode('missing', {}), /Unknown node/);
  assert.throws(() => flow.addEdges([{ id: 'bad', source: 'missing', target: 'b' }]), /Missing endpoint/);
  assert.equal(flow.getGraph().edges.length, 1);
});
test('drag snaps to grid, flushes final movement and is one undo transaction', async () => {
  await mount({ snapGrid: [20, 20] });
  await pointer(node('a'), 'pointerdown', 40, 40);
  await pointer(pane(), 'pointermove', 65, 75);
  await pointer(pane(), 'pointermove', 85, 95);
  await pointer(pane(), 'pointerup', 85, 95);
  assert.deepEqual(flow.getGraph().nodes[0].position, { x: 80, y: 100 });
  await act(async () => flow.undo());
  assert.deepEqual(flow.getGraph().nodes[0].position, { x: 40, y: 40 });
  assert.equal(flow.canUndo(), false);
});
test('multi-node dragging maintains spacing and respects group extent', async () => {
  await mount({ nodeExtent: { x: 0, y: 0, width: 650, height: 500 } });
  await act(async () => flow.selectAll());
  await pointer(node('a'), 'pointerdown', 40, 40);
  await pointer(pane(), 'pointermove', 1040, 40);
  await pointer(pane(), 'pointerup', 1040, 40);
  assert.equal(flow.getGraph().nodes[1].position.x, 470);
  assert.equal(flow.getGraph().nodes[1].position.x - flow.getGraph().nodes[0].position.x, 360);
});
test('drag displacement accounts for viewport zoom', async () => {
  await mount({ defaultViewport: { x: 0, y: 0, zoom: 2 } });
  await pointer(node('a'), 'pointerdown', 80, 80);
  await pointer(pane(), 'pointermove', 120, 100);
  await pointer(pane(), 'pointerup', 120, 100);
  assert.deepEqual(flow.getGraph().nodes[0].position, { x: 60, y: 50 });
});
test('pan, wheel anchor zoom and zoom constraints', async () => {
  await mount({ minZoom: 0.5, maxZoom: 2 });
  await pointer(pane(), 'pointerdown', 100, 100);
  await pointer(pane(), 'pointermove', 150, 170);
  await pointer(pane(), 'pointerup', 150, 170);
  assert.deepEqual(flow.getViewport(), { x: 50, y: 70, zoom: 1 });
  const before = flow.screenToFlowPosition({ x: 200, y: 200 });
  await act(async () => { pane().dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 200, clientY: 200, deltaY: -10_000 })); });
  assert.equal(flow.getViewport().zoom, 2);
  assert.deepEqual(flow.screenToFlowPosition({ x: 200, y: 200 }), before);
});
test('keyboard selection, nudge, duplication, deletion and undo', async () => {
  await mount();
  await key('a', { ctrlKey: true }); assert.ok(flow.getGraph().nodes.every(n => n.selected));
  await key('ArrowRight'); assert.equal(flow.getGraph().nodes[0].position.x, 41);
  await key('d', { ctrlKey: true }); assert.equal(flow.getGraph().nodes.length, 4);
  await key('Delete'); assert.equal(flow.getGraph().nodes.length, 2);
  await key('z', { ctrlKey: true }); assert.equal(flow.getGraph().nodes.length, 4);
});
test('node Enter selection and port keyboard clicks are accessible', async () => {
  await mount();
  await key('Enter', {}, node('a')); assert.equal(flow.getGraph().nodes[0].selected, true);
  await click(node('a').querySelector('[data-port-type="source"]')!);
  await click(node('b').querySelector('[data-port-type="target"]')!);
  assert.equal(flow.getGraph().edges.length, 1);
});
test('click-to-connect validates duplicates, invokes callbacks and cancels on Escape', async () => {
  let connected = 0, rejected = 0;
  await mount({ onConnect: () => connected++, onConnectionRejected: () => rejected++ });
  const output = () => node('a').querySelector('[data-port-type="source"]')!;
  const input = () => node('b').querySelector('[data-port-type="target"]')!;
  await click(output()); await click(input());
  assert.equal(flow.getGraph().edges.length, 1); assert.equal(connected, 1);
  await click(output()); await click(input()); assert.equal(rejected, 1);
  await click(output()); await key('Escape');
  assert.equal(host.querySelector('.rfc-connection-preview'), null);
});
test('drag-to-connect uses hit testing at release, even with pointer capture', async () => {
  await mount();
  const output = node('a').querySelector('[data-port-type="source"]')!;
  const input = node('b').querySelector('[data-port-type="target"]')!;
  await pointer(output, 'pointerdown', 220, 80);
  assert.ok(captures.has(1));
  dom.window.document.elementFromPoint = () => input;
  await pointer(pane(), 'pointermove', 400, 120);
  await pointer(pane(), 'pointerup', 400, 120);
  assert.equal(flow.getGraph().edges.length, 1);
  assert.equal(captures.has(1), false);
});
test('custom connection validation and autoConnect false do not insert an edge', async () => {
  let notified = 0;
  await mount({ autoConnect: false, onConnect: () => notified++ });
  await click(node('a').querySelector('[data-port-type="source"]')!);
  await click(node('b').querySelector('[data-port-type="target"]')!);
  assert.equal(flow.getGraph().edges.length, 0); assert.equal(notified, 1);
  await act(async () => root!.render(<FlowCanvas<Data> defaultValue={seed()} isValidConnection={() => false} />));
  await click(node('a').querySelector('[data-port-type="source"]')!);
  await click(node('b').querySelector('[data-port-type="target"]')!);
  assert.equal(host.querySelectorAll('.rfc-edge').length, 0);
});
test('shift-drag rubber band selects intersecting nodes', async () => {
  await mount();
  await pointer(pane(), 'pointerdown', 20, 20, { shiftKey: true });
  await pointer(pane(), 'pointermove', 250, 140, { shiftKey: true });
  await pointer(pane(), 'pointerup', 250, 140, { shiftKey: true });
  assert.deepEqual(flow.getGraph().nodes.filter(n => n.selected).map(n => n.id), ['a']);
  assert.equal(host.querySelector('.rfc-selection'), null);
});
test('readOnly blocks user mutations but permits selection, pan and imperative changes', async () => {
  await mount({ readOnly: true });
  await pointer(node('a'), 'pointerdown', 40, 40);
  await pointer(pane(), 'pointermove', 100, 100);
  await pointer(pane(), 'pointerup', 100, 100);
  await key('Delete');
  assert.equal(flow.getGraph().nodes.length, 2);
  assert.deepEqual(flow.getGraph().nodes[0].position, { x: 40, y: 40 });
  assert.ok(flow.getGraph().nodes[0].selected);
  assert.ok(node('a').querySelector<HTMLButtonElement>('.rfc-port')!.disabled);
  await act(async () => flow.updateNode('a', { data: { label: 'Changed' } }));
  assert.ok(host.textContent?.includes('Changed'));
});
test('nested inputs do not trigger canvas deletion or dragging', async () => {
  await mount({ nodeTypes: { default: () => <input aria-label="Node input" defaultValue="Text" /> } });
  const input = node('a').querySelector('input')!;
  await pointer(input, 'pointerdown', 40, 40);
  await pointer(pane(), 'pointermove', 200, 200);
  await key('Delete', {}, input);
  assert.equal(flow.getGraph().nodes.length, 2);
  assert.deepEqual(flow.getGraph().nodes[0].position, { x: 40, y: 40 });
});
test('controlled mode and stable child hooks receive reactive snapshots', async () => {
  const child = <Count />;
  function Count() {
    const current = useFlowCanvas<Data>();
    return <Panel><output>{current.getGraph().nodes.length}/{current.getViewport().zoom}</output></Panel>;
  }
  function Controlled() {
    const [value, setValue] = useState(seed());
    return <FlowCanvas value={value} onChange={setValue} onInit={instance => { flow = instance; }}>{child}</FlowCanvas>;
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Controlled />));
  await act(async () => flow.addNodes([{ id: 'c', position: { x: 0, y: 0 }, data: { label: 'Gamma' } }]));
  assert.equal(host.querySelector('output')!.textContent, '3/1');
  await act(async () => flow.zoomIn());
  assert.equal(host.querySelector('output')!.textContent, '3/1.2');
});
test('serialization load is validated before state changes', async () => {
  await mount();
  const doc = flow.toJSON();
  await act(async () => flow.updateNode('a', { position: { x: 600, y: 600 } }));
  await act(async () => flow.load(doc));
  assert.deepEqual(flow.getGraph().nodes[0].position, { x: 40, y: 40 });
  assert.throws(() => flow.load({ ...doc, viewport: { x: 0, y: 0, zoom: 0 } }), /Viewport/);
});
test('visibility culling removes distant nodes, but fitView still includes them', async () => {
  const g = seed(); g.nodes.push({ id: 'far', position: { x: 10_000, y: 0 }, data: { label: 'Far' } });
  await mount({ defaultValue: g, onlyRenderVisibleElements: true });
  assert.equal(node('far'), null);
  await act(async () => flow.fitView());
  assert.ok(node('far'));
});
test('edge selection and cascading deletion', async () => {
  const g = seed(); g.edges.push({ id: 'ab', source: 'a', target: 'b', label: 'Test' });
  await mount({ defaultValue: g });
  await click(host.querySelector('[data-edge-id="ab"]')!);
  assert.equal(flow.getGraph().edges[0].selected, true);
  await key('Delete'); assert.equal(flow.getGraph().edges.length, 0);
});
test('pointer cancellation clears connection and releases capture', async () => {
  await mount();
  await pointer(node('a').querySelector('[data-port-type="source"]')!, 'pointerdown', 220, 80);
  await pointer(pane(), 'pointercancel', 220, 80);
  assert.equal(host.querySelector('.rfc-connection-preview'), null);
  assert.equal(captures.size, 0);
});
test('custom node and edge renderers support hooks as independent React components', async () => {
  function HookNode() {
    const [label] = useState('Hook node');
    const current = useFlowCanvas();
    return <span>{label}: {current.getGraph().nodes.length}</span>;
  }
  function HookEdge({ path }: { path: string }) {
    const [color] = useState('red');
    useFlowCanvas();
    return <path className="rfc-edge-path" d={path} stroke={color} />;
  }
  await mount({ nodeTypes: { default: HookNode }, edgeTypes: { bezier: HookEdge } });
  await act(async () => flow.addEdges([{ id: 'ab', source: 'a', target: 'b' }]));
  await act(async () => flow.addEdges([{ id: 'ba', source: 'b', target: 'a' }]));
  assert.equal(host.querySelectorAll('.rfc-edge-path').length, 2);
  await act(async () => flow.undo());
  assert.equal(host.querySelectorAll('.rfc-edge-path').length, 1);
});
test('node click callbacks survive pointer capture but are not emitted for drags', async () => {
  const clicked: string[] = [];
  await mount({ onNodeClick: current => clicked.push(current.id) });
  await pointer(node('a'), 'pointerdown', 40, 40);
  await pointer(pane(), 'pointerup', 40, 40);
  assert.deepEqual(clicked, ['a']);
  await pointer(node('a'), 'pointerdown', 40, 40);
  await pointer(pane(), 'pointermove', 60, 60);
  await pointer(pane(), 'pointerup', 80, 80);
  assert.deepEqual(clicked, ['a']);
  assert.deepEqual(flow.getGraph().nodes[0].position, { x: 80, y: 80 }, 'release coordinates must be applied');
});
