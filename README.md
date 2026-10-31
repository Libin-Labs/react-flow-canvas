# @lp-labs/react-flow-canvas

A lightweight React library for building workflow editors, node-based interfaces,
dependency diagrams and interactive directed graphs.

**Zero runtime dependencies. React 18.2+ or 19 is the only peer dependency.**
React DOM is needed by your browser application, not by the library.

Built by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/).
[Support development with PayPal](https://www.paypal.me/LibinPrasanth).

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [JavaScript, CommonJS and Next.js](#javascript-commonjs-and-nextjs)
- [Data model](#data-model)
- [Controlled mode](#controlled-mode)
- [Custom nodes and ports](#custom-nodes-and-ports)
- [Edges and connection policies](#edges-and-connection-policies)
- [Imperative API and hooks](#imperative-api-and-hooks)
- [FlowCanvas props](#flowcanvas-props)
- [Overlay components](#overlay-components)
- [Interaction reference](#interaction-reference)
- [Serialization and validation](#serialization-and-validation)
- [Exported utilities](#exported-utilities)
- [Styling and customization](#styling-and-customization)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)
- [Independence and dependencies](#independence-and-dependencies)
- [Scope and limitations](#scope-and-limitations)
- [Author and support](#author-and-support)
- [License](#license)

## What is included

- Typed, controlled or uncontrolled graphs; custom React node renderers.
- Source/target ports on all four sides, with fractional offsets.
- Bezier, straight and orthogonal step edges; labels, arrows, styles, animation,
  custom SVG renderers, and larger invisible selection hit areas.
- Individual and multi-node dragging, grid snapping and optional movement bounds.
- Pan, cursor-anchored wheel/pinch-trackpad zoom, zoom limits and fit-to-content.
- Click, modifier-click and rubber-band selection of nodes; edge selection.
- Pointer-drag, click-to-click and keyboard port connections.
- Connection validation, duplicate/self-connection policy, optional cycle detection.
- Selection deletion with incident-edge cleanup, duplication, keyboard nudging.
- Bounded undo/redo with one history entry per drag.
- Interactive minimap, controls, overlay panels and an imperative/hook API.
- Versioned JSON import/export and explicit structural validation.
- CSS variables, dark-theme example, reduced-motion support and keyboard focus.
- Optional viewport culling, memoized nodes and animation-frame batched gestures.
- npm-ready ESM, CommonJS, TypeScript declarations and separately imported CSS.

This is an early **v0.1** release. See
[scope and limitations](#scope-and-limitations) before using it in production.

## Installation

```sh
npm install @lp-labs/react-flow-canvas
```

Or use your preferred package manager:

```sh
pnpm add @lp-labs/react-flow-canvas
# or
yarn add @lp-labs/react-flow-canvas
```

Use an existing React 18.2+ or React 19 application. If React is not already
installed, install `react` and a compatible `react-dom` version in your app.
TypeScript applications also need the matching `@types/react` and
`@types/react-dom` packages. Types for this library are included.

Import `@lp-labs/react-flow-canvas/style.css` once in your app entry point or
framework-approved global stylesheet location. No provider, API key, account,
external stylesheet URL or additional graph library is required.

## Quick start

```tsx
import { FlowCanvas } from '@lp-labs/react-flow-canvas';
import type { Graph } from '@lp-labs/react-flow-canvas';
import '@lp-labs/react-flow-canvas/style.css';

type Data = { label: string };
const initialGraph: Graph<Data> = {
  nodes: [
    { id: 'a', position: { x: 40, y: 80 }, data: { label: 'Start' } },
    { id: 'b', position: { x: 360, y: 80 }, data: { label: 'Finish' } },
  ],
  edges: [{ id: 'a-b', source: 'a', target: 'b', label: 'Next' }],
};

export default function Editor() {
  return (
    <div style={{ width: '100%', height: 600 }}>
      <FlowCanvas<Data> defaultValue={initialGraph} fitView showMiniMap />
    </div>
  );
}
```

**The parent must have nonzero width and height.** Import the CSS once.
The canvas is a browser UI; SSR can emit markup but interactions require mounting
in a browser.

Shorter snippets below reuse `Data`, `initialGraph` and the `FlowCanvas` import
from this quick start unless they declare their own. Examples that use `api`
assume an instance obtained through `onInit`. Import the base stylesheet once per
application, rather than repeating it in each component.

## JavaScript, CommonJS and Next.js

### JavaScript / JSX

All TypeScript annotations in the examples are optional. In a JavaScript React
application, omit `import type`, type declarations and generic JSX arguments:

```jsx
import { FlowCanvas } from '@lp-labs/react-flow-canvas';
import '@lp-labs/react-flow-canvas/style.css';

const graph = {
  nodes: [{ id: 'start', position: { x: 80, y: 80 }, data: { label: 'Start' } }],
  edges: [],
};

export default function Editor() {
  return <div style={{ height: 600 }}>
    <FlowCanvas defaultValue={graph} fitView />
  </div>;
}
```

### CommonJS

The package selects the CommonJS build for `require()` and the ESM build for
`import`. No internal distribution paths are needed:

```js
const { FlowCanvas, validateGraph } = require('@lp-labs/react-flow-canvas');
```

Your application's CSS loader must still import the exported stylesheet.
The package exposes only its root API, `style.css` and `package.json`; avoid
deep-importing implementation files. ESM and CommonJS TypeScript declarations
are included, including NodeNext resolution support.

### Next.js App Router

Put interactive canvas code behind a client boundary:

```tsx
'use client';

import { FlowCanvas } from '@lp-labs/react-flow-canvas';

export default function WorkflowEditor() {
  return <div style={{ height: 600 }}>
    <FlowCanvas
      defaultValue={{
        nodes: [{ id: 'start', position: { x: 80, y: 80 }, data: { label: 'Start' } }],
        edges: [],
      }}
      fitView
    />
  </div>;
}
```

Import `@lp-labs/react-flow-canvas/style.css` in your root layout alongside your
global styles. Pass serializable initial data across server/client boundaries;
define renderer functions and event handlers in client modules. Access the
instance only after mounting, through `onInit` or a child hook.

## Data model

```ts
interface Graph<N, E> {
  nodes: FlowNode<N>[];
  edges: FlowEdge<E>[];
}

interface FlowNode<D> {
  id: string;
  position: { x: number; y: number }; // flow coordinates, not screen pixels
  data: D;
  type?: string;                    // nodeTypes key; default: "default"
  width?: number;                   // default: 180
  height?: number;                  // default: 80
  ports?: Port[];                   // omitted: default "in" and "out"; []: none
  selected?: boolean;
  draggable?: boolean;
  deletable?: boolean;
  className?: string;
}

interface Port {
  id: string;                       // unique within the node
  type: 'source' | 'target';
  side?: 'left' | 'right' | 'top' | 'bottom';
  offset?: number;                  // fraction 0..1, default: 0.5
  label?: string;                   // accessible name / tooltip
}

interface FlowEdge<D> {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;              // first source port if omitted
  targetPort?: string;              // first target port if omitted
  type?: 'bezier' | 'straight' | 'step';
  data?: D;
  label?: string;
  selected?: boolean;
  animated?: boolean;
  deletable?: boolean;
  style?: React.CSSProperties;
}
```

IDs must be nonempty and unique within their respective node/edge collections.
Every edge must reference existing endpoints and compatible ports. Explicit sizes
must be finite and positive; positions must be finite. Node dimensions are
**explicit**, not measured from content. Set width/height to accommodate custom UI.

Treat all graph objects and nested data as **immutable**. History stores shared
references, not deep clones. Duplication shallow-copies node/edge data: replace
data immutably when editing. Application data should be JSON-safe if exporting.

## Controlled mode

```tsx
import { useState } from 'react';

function ControlledEditor() {
  const [graph, setGraph] = useState(initialGraph);
  return <FlowCanvas<Data>
    value={graph}
    onChange={(next, reason) => {
      setGraph(next); // apply synchronously, including selection and dragging
      console.log(reason);
    }}
  />;
}
```

Do not pass `value` without applying `onChange`: the supplied value is authoritative.
Do not switch between controlled and uncontrolled modes during a mount.
`defaultValue` and `defaultViewport` are read only at initialization. Use the
instance to replace graphs or viewports later. Viewport state is internal, with
`onViewportChange` notifications and `setViewport` for external synchronization.

`onChange` reasons: `add`, `remove`, `move`, `select`, `connect`, `update`,
`undo`, `redo`, `load`. No-op operations may omit notifications.

## Custom nodes and ports

```tsx
import { FlowCanvas } from '@lp-labs/react-flow-canvas';
import type { FlowNode, NodeRenderer } from '@lp-labs/react-flow-canvas';

type Data = { label: string };

const task: NodeRenderer<Data> = ({ node, selected }) => (
  <div>
    <strong>{node.data.label}</strong>
    <small>{selected ? 'Selected' : 'Task'}</small>
  </div>
);
const nodeTypes = { task }; // keep this stable, outside render or useMemo

const customNode = {
  id: 'choice',
  type: 'task',
  position: { x: 100, y: 100 },
  width: 240,
  height: 120,
  data: { label: 'Choose a route' },
  ports: [
    { id: 'input', type: 'target', side: 'left' },
    { id: 'yes', type: 'source', side: 'right', offset: 0.25, label: 'Yes output' },
    { id: 'no', type: 'source', side: 'right', offset: 0.75, label: 'No output' },
  ],
} satisfies FlowNode<Data>;

export function CustomNodeEditor() {
  return <div style={{ height: 600 }}>
    <FlowCanvas<Data>
      defaultValue={{ nodes: [customNode], edges: [] }}
      nodeTypes={nodeTypes}
      fitView
    />
  </div>;
}
```

The canvas renders ports around your content; do not add another port component.
An unknown node type falls
back to `String(data.label)` when present, otherwise the node ID.

Inputs, textareas, selects, buttons, anchors, editable content and elements inside
`data-flow-ignore` do not start dragging or trigger canvas keyboard shortcuts.
Use `data-flow-ignore` on sliders or other custom interactive regions.

### Editable node content

Custom renderers are React components and may use hooks. Keep renderer identities
stable so node-local state is not reset. To persist edits in the graph and history,
replace `data` immutably using the canvas hook:

```tsx
import { useFlowCanvas } from '@lp-labs/react-flow-canvas';
import type { NodeRenderer } from '@lp-labs/react-flow-canvas';

type TaskData = { label: string; description: string };

const EditableTask: NodeRenderer<TaskData> = ({ node }) => {
  const flow = useFlowCanvas<TaskData>();
  return <label>
    Task name
    <input
      aria-label={`Task name for ${node.id}`}
      value={node.data.label}
      onChange={event => flow.updateNode(node.id, {
        data: { ...node.data, label: event.target.value },
      })}
    />
  </label>;
};

const editableNodeTypes = { task: EditableTask };
```

Register `editableNodeTypes` as `nodeTypes` and set your node's `type` to `task`.
Import the base CSS once as in the quick start. Each `updateNode` call records a
history entry; for longer forms, keep a local draft and commit on an explicit Save.
Apply `readOnly` to custom form controls yourself: the canvas cannot prevent a
custom renderer from calling the imperative API.

## Edges and connection policies

Output ports connect to input ports only. Users can drag between ports, click each
port, or tab to the output and input buttons and activate each using Enter/Space.
Escape cancels an active connection. Rejected connections announce an error and
invoke `onConnectionRejected`.

By default the canvas automatically creates a uniquely identified edge and then
calls `onConnect`. To create your own edge IDs/types/data, use `autoConnect={false}`
and add the edge in `onConnect` via your state or the instance. Do not manually add
another edge in `onConnect` when `autoConnect` is enabled.

```tsx
import { hasCycle } from '@lp-labs/react-flow-canvas';

<FlowCanvas
  defaultValue={initialGraph}
  allowSelfConnections={false}
  allowDuplicateConnections={false}
  isValidConnection={(connection, graph) =>
    !hasCycle({
      ...graph,
      edges: [...graph.edges, { id: 'candidate', ...connection }],
    })
  }
  onConnectionRejected={connection => console.warn('Rejected', connection)}
/>;
```

These policies apply to **interactive** connections. The imperative `addEdges`,
`setGraph`, `updateEdge` and document loading enforce structure, but allow cycles,
self-edges and parallel edges. Apply domain policies yourself for imported and
programmatically edited graphs.

### Custom edge IDs, data and routing style

Use the second generic parameter for edge data and disable automatic insertion
when the application creates edges:

```tsx
import { useRef } from 'react';
import { FlowCanvas } from '@lp-labs/react-flow-canvas';
import type { FlowInstance, Graph } from '@lp-labs/react-flow-canvas';

type TaskData = { label: string };
type RouteData = { enabled: boolean };
const routes: Graph<TaskData, RouteData> = {
  nodes: [
    { id: 'a', position: { x: 40, y: 100 }, data: { label: 'Source' } },
    { id: 'b', position: { x: 360, y: 100 }, data: { label: 'Target' } },
  ],
  edges: [],
};

export function RouteEditor() {
  const api = useRef<FlowInstance<TaskData, RouteData> | null>(null);
  return <div style={{ height: 600 }}>
    <FlowCanvas<TaskData, RouteData>
      defaultValue={routes}
      onInit={instance => { api.current = instance; }}
      autoConnect={false}
      onConnect={connection => api.current?.addEdges([{
        ...connection,
        id: crypto.randomUUID(),
        type: 'step',
        label: 'Continue',
        animated: true,
        data: { enabled: true },
        style: { stroke: '#16a085', strokeWidth: 2 },
      }])}
      fitView
    />
  </div>;
}
```

### Custom SVG edges

`edgeTypes` overrides the renderer for `bezier`, `straight` or `step`. Geometry,
selection hit area and labels remain managed by the canvas.

```tsx
import type { EdgeRenderer } from '@lp-labs/react-flow-canvas';

const highlighted: EdgeRenderer = ({ path, markerId, edge }) => (
  <path
    className="rfc-edge-path"
    d={path}
    fill="none"
    style={{ stroke: edge.selected ? '#4f46e5' : '#16a085', strokeWidth: 3 }}
    markerEnd={`url(#${markerId})`}
  />
);
// <FlowCanvas edgeTypes={{ bezier: highlighted }} ... />
```

Renderer props include `edge`, `path`, `source`, `target`, `label` (the curve's
midpoint) and `markerId`. Return SVG elements, not HTML. Supply your own rendering
for complex self-loops or specialized routing.

## Imperative API and hooks

Get the instance through `onInit`, or call `useFlowCanvas<N, E>()` from a custom
node, edge, panel or other child of the canvas:

```tsx
import { useRef } from 'react';
import { FlowCanvas, Panel, useFlowCanvas } from '@lp-labs/react-flow-canvas';
import type { FlowInstance } from '@lp-labs/react-flow-canvas';

function AddButton() {
  const flow = useFlowCanvas<Data>();
  return <Panel position="top-right">
    <button onClick={() => flow.addNodes([{
      id: crypto.randomUUID(),
      position: { x: 150, y: 150 },
      data: { label: 'New node' },
    }])}>Add node</button>
  </Panel>;
}

function WithApi() {
  const api = useRef<FlowInstance<Data> | null>(null);
  return <div style={{ height: 600 }}>
    <FlowCanvas<Data> defaultValue={initialGraph}
      onInit={instance => { api.current = instance; }}>
      <AddButton />
    </FlowCanvas>
  </div>;
}
```

The hook subscribes to canvas updates; reading `getGraph()` or `getViewport()` in
render is reactive. Generic hook types must match your enclosing canvas. There is
no global graph state: multiple canvases have isolated instances and SVG IDs.

| Method | Behavior |
| --- | --- |
| `getGraph()` | Current immutable graph reference |
| `setGraph(graph)` | Validate and replace graph; undoable |
| `addNodes(nodes)` / `addEdges(edges)` | Validate and append elements |
| `updateNode(id, patch)` / `updateEdge(id, patch)` | Shallow immutable merge; nested `data` is replaced, not merged |
| `deleteSelected()` | Delete eligible selection and incident edges |
| `selectAll()` | Select all nodes and edges |
| `duplicateSelected()` | Copy selected nodes and internal edges, offset +30/+30, assign new IDs |
| `undo()` / `redo()` | Navigate graph history; no-op if unavailable |
| `canUndo()` / `canRedo()` | Current history availability |
| `getViewport()` / `setViewport(viewport)` | Read or set `{ x, y, zoom }`; zoom clamped to limits |
| `fitView(padding = 40)` | Fit all nodes with padding in screen pixels |
| `zoomIn()` / `zoomOut()` | Center-anchored 1.2x zoom step |
| `screenToFlowPosition({ x, y })` | Convert **client** coordinates, accounting for canvas offset and zoom |
| `toJSON()` | Return a version-1 document object, not a string |
| `load(document)` | Validate graph and viewport before applying |

Unknown IDs, invalid graphs and invalid viewports throw explicit errors before
applying changes. Catch these at application boundaries and notify users.

Read-only mode blocks **user mutations**, not API calls. Your application can still
update the graph. Deletion respects `deletable: false`. A protected edge also
protects its endpoints so deleting a node cannot silently remove that edge.

### History behavior

- Default limit is 100 snapshots; set `historyLimit` to a positive integer.
- Each drag records once; API mutations and each arrow-key nudge record separately.
- Selection and viewport changes do not create history entries.
- Graph snapshots include their selection state. Undo may restore earlier selection.
- Text inputs using `updateNode` record each call; debounce commits in the
  application if you want larger edit transactions.
- Undo/redo in controlled mode also requires applying `onChange`.
- Replacing controlled `value` externally does not automatically clear history.
  Remount with a new React `key` when switching to an unrelated document.
- Changing `historyLimit` creates a fresh history.

## FlowCanvas props

| Prop | Default | Description |
| --- | --- | --- |
| `value` / `defaultValue` | empty graph | Controlled graph / initial uncontrolled graph |
| `onChange(next, reason)` | - | Graph mutation notification |
| `defaultViewport` | `{ x: 0, y: 0, zoom: 1 }` | Initial viewport |
| `onViewportChange(viewport)` | - | Pan/zoom notification |
| `onInit(instance)` | - | Called on mount, and if history limit changes; may run twice in React Strict Mode |
| `nodeTypes` / `edgeTypes` | `{}` | Custom renderer maps |
| `onNodeClick(node)` / `onEdgeClick(edge)` | - | Element click notifications |
| `onPaneDoubleClick(point)` | - | Flow-space position on empty-pane double click |
| `onSelectionChange({ nodes, edges })` | - | Initial selection and subsequent selected-ID changes |
| `onConnect(connection)` | - | Successful interactive connection |
| `onConnectionRejected(connection)` | - | Rejected candidate notification |
| `isValidConnection(connection, graph)` | - | Additional synchronous domain validator |
| `autoConnect` | `true` | Insert a default edge on valid connection |
| `allowSelfConnections` | `false` | Allow interactive self-connections |
| `allowDuplicateConnections` | `false` | Allow identical source/target port pairs |
| `minZoom` / `maxZoom` | `0.1` / `4` | Positive zoom range |
| `snapGrid` | none | Positive `[x, y]` flow-space grid |
| `nodeExtent` | none | `{ x, y, width, height }` bounds for user movement |
| `fitView` | `false` | Fit once, after size and nodes are available |
| `readOnly` | `false` | Disable user graph mutations; retain selection and navigation |
| `nodesDraggable` / `nodesConnectable` | `true` | Interaction switches |
| `elementsSelectable` | `true` | Enable user selection |
| `panOnDrag` / `zoomOnScroll` | `true` | Navigation switches; Space/middle-drag still pan |
| `onlyRenderVisibleElements` | `false` | Cull with 200 screen-pixel overscan |
| `historyLimit` | `100` | Positive history capacity |
| `showControls` / `showMiniMap` | `true` / `false` | Built-in overlays |
| `background` | `'dots'` | `'dots'`, `'lines'` or `'none'` |
| `gridSize` | `20` | Positive flow-space background spacing |
| `ariaLabel` | `'Flow editor'` | Accessible region name |
| `className`, `style`, `children` | - | Styling and child overlays |

Movement bounds do not rewrite imported positions or constrain API edits/duplication.
For a selected group larger than the extent, movement aligns it to the extent's
top/left; full containment is mathematically impossible. Bounds take precedence
over snapping at extent boundaries. Background grid and snap grid are independent.

## Overlay components

`<Controls readOnly />` and `<MiniMap width={180} height={120} />` can be placed as
children when their automatic versions are disabled. The minimap shows all nodes,
the visible viewport and selection; pointer activation centers the canvas.

`<Panel position="top-left">` positions arbitrary React content. Other positions
are `top-right`, `bottom-left`, `bottom-right`. Panels may overlap controls/minimap;
choose positions and margins to suit your layout.

### Replace the built-in controls

```tsx
import { FlowCanvas, MiniMap, Panel, useFlowCanvas } from '@lp-labs/react-flow-canvas';

function Toolbar() {
  const flow = useFlowCanvas();
  return <Panel position="top-right">
    <div role="toolbar" aria-label="Diagram actions">
      <button type="button" onClick={flow.zoomIn}>Zoom in</button>
      <button type="button" onClick={flow.zoomOut}>Zoom out</button>
      <button type="button" onClick={() => flow.fitView(60)}>Fit all</button>
      <button type="button" onClick={flow.undo} disabled={!flow.canUndo()}>Undo</button>
      <button type="button" onClick={flow.redo} disabled={!flow.canRedo()}>Redo</button>
    </div>
  </Panel>;
}

export function CustomControlsEditor() {
  return <div style={{ height: 600 }}>
    <FlowCanvas showControls={false} showMiniMap={false}>
      <Toolbar />
      <MiniMap width={220} height={140} className="overview" />
    </FlowCanvas>
  </div>;
}
```

`MiniMap` accepts `width`, `height` (positive numbers) and `className`.
`Controls` accepts `readOnly` (default `false`, hiding undo/redo when `true`).
`Panel` accepts `position`, `className` and `children`. These components must be
inside a `FlowCanvas`; the hook throws if used outside that context.
Custom controls must respect your application's read-only policy.

## Interaction reference

| Gesture | Result |
| --- | --- |
| Left-drag node | Move node / selected group |
| Left-drag empty pane | Pan; clear selection at gesture start |
| Middle-drag or Space + pane drag | Pan |
| Wheel / trackpad pinch wheel | Zoom around cursor |
| Shift + pane drag | Select nodes intersecting the rubber band |
| Ctrl/Cmd + Shift + pane drag | Add intersecting nodes to selection |
| Shift/Ctrl/Cmd + node/edge click | Toggle element in selection |
| Source-to-target drag or source then target click | Connect ports |
| Tab, Enter/Space | Focus and select nodes/edges or activate ports/buttons |
| Ctrl/Cmd + A | Select all |
| Ctrl/Cmd + D | Duplicate selected nodes and edges between them |
| Delete / Backspace | Delete eligible selection |
| Arrow keys / Shift + arrows | Move selection by 1 / 10 units, or snap-grid spacing |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z / Ctrl/Cmd + Y | Redo |
| Escape | Cancel connection or gesture; applied movement is retained and undoable |

Touch supports single-pointer dragging, panning and port connections. Two-finger
touch pinch is not implemented. Trackpad pinch events delivered as wheel are
supported. Keyboard shortcuts are scoped to a focused canvas, not the document.

## Serialization and validation

```ts
import { serialize, parseDocument } from '@lp-labs/react-flow-canvas';

// Save this string to your backend or file.
const text = serialize(api.getGraph(), api.getViewport());

try {
  const document = parseDocument(text); // FlowDocument<unknown, unknown>
  // Validate application-specific node/edge data before narrowing types.
  console.log(document.graph.nodes.length);
} catch (error) {
  console.error('Cannot load workflow', error);
}
```

Document shape:

```json
{
  "version": 1,
  "graph": { "nodes": [], "edges": [] },
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

`validateGraph(unknown)` and `validateViewport(unknown)` are assertion functions.
Structural failures throw `FlowValidationError`; malformed JSON throws
`SyntaxError`. Unknown versions are rejected. No schema is inferred for generic
application `data`. JSON export does not preserve functions, dates, undefined
values or circular objects; use plain JSON-compatible data.

### Safely load typed application data

`parseDocument` returns unknown application data intentionally. Do not cast an
imported document directly to your application type. This example validates a
label-only node schema and discards unused edge data before loading:

```ts
import { parseDocument } from '@lp-labs/react-flow-canvas';
import type { FlowInstance } from '@lp-labs/react-flow-canvas';

type LabelData = { label: string };

export function loadLabels(text: string, api: FlowInstance<LabelData>) {
  const document = parseDocument(text);
  const nodes = document.graph.nodes.map(node => {
    const data = node.data;
    if (
      typeof data !== 'object' || data === null ||
      !('label' in data) || typeof data.label !== 'string'
    ) {
      throw new Error(`Node ${node.id} must have a string label.`);
    }
    return { ...node, data: { label: data.label } };
  });
  const edges = document.graph.edges.map(edge => ({
    ...edge,
    data: undefined,
  }));
  api.load({ ...document, graph: { nodes, edges } });
}
```

Catch errors around `loadLabels` and show an application notification. Validate
your own edge data instead of discarding it when your app uses that data.
Also apply domain constraints such as acyclicity before calling `load`.
The library does not automatically write to localStorage or send graphs over the
network. Use `serialize` and `load` with the storage service of your choice.
Debounce storage writes rather than the controlled `onChange` state update.

## Exported utilities

All graph helpers are immutable. They can be used without mounting React.

| Helper | Purpose |
| --- | --- |
| `isValidConnection(connection, graph, options?)` | Structural port, duplicate and self-loop checks |
| `addEdge(edge, graph)` | Validate and append an edge |
| `removeSelected(graph)` | Protected deletion and cascade cleanup |
| `getConnectedEdges(nodeIds, graph)` | Edges incident to any listed node |
| `getIncomers(id, graph)` / `getOutgoers(id, graph)` | Unique incoming/outgoing neighbor nodes |
| `hasCycle(graph)` | Iterative directed-cycle detection, O(V+E), assumes valid endpoints |
| `serialize(graph, viewport?)` / `parseDocument(text)` | Validated versioned JSON |
| `History<T>(limit?)` | Generic bounded `push/undo/redo/clear` utility; availability getters |
| `nodeRect(node)` / `getBounds(nodes)` | Default dimensions and graph bounds |
| `intersects(rectA, rectB)` | Inclusive rectangle intersection |
| `screenToFlow(point, viewport)` / `flowToScreen(point, viewport)` | Coordinates relative to the canvas |
| `zoomAt(viewport, point, zoom)` | Anchor-preserving viewport |
| `fitBounds(bounds, size, padding?, minZoom?, maxZoom?)` | Fit rectangle into pixel dimensions |
| `getPort(node, type, id?)` / `portSide(port)` / `portPosition(node, port)` | Port resolution and geometry |
| `getEdgePath(source, target, type?, sourceSide?, targetSide?)` | SVG path and label point |
| `clamp(value, min, max)` | Numeric clamp |

`DEFAULT_NODE_WIDTH`, `DEFAULT_NODE_HEIGHT`, `DEFAULT_PORTS`, and all public
interfaces are exported. Treat `DEFAULT_PORTS` as read-only.

## Styling and customization

Load your overrides **after** the library stylesheet. Scope overrides to your
canvas class so multiple differently themed editors can coexist.

### Theme variables

```css
.my-canvas {
  --rfc-bg: #111827;
  --rfc-grid: #27324a;
  --rfc-node-bg: #1c2436;
  --rfc-text: #e2e8f0;
  --rfc-border: #37445d;
  --rfc-accent: #818cf8;
  --rfc-edge: #7d8ba8;
}
```

Set `className="my-canvas"` on the canvas. Built-in classes are namespaced `rfc-`.
Your custom node receives `rfc-node`, your `className`, and `rfc-selected` when
selected. Edge animation respects `prefers-reduced-motion`.

| Variable | Default | Used for |
| --- | --- | --- |
| `--rfc-bg` | `#f8fafc` | Canvas and control hover background |
| `--rfc-grid` | `#cbd5e1` | Dots / grid lines |
| `--rfc-node-bg` | `#fff` | Nodes, controls, labels, minimap |
| `--rfc-text` | `#0f172a` | Text |
| `--rfc-border` | `#cbd5e1` | Node borders, overlays, minimap nodes |
| `--rfc-accent` | `#4f46e5` | Selection, focus, active ports and viewport outline |
| `--rfc-edge` | `#64748b` | Edge strokes and inactive ports |

Switch between light and dark themes by changing the canvas class and overriding
these variables. The library does not read or store a global theme preference.

### Node, port, edge and overlay overrides

```css
.my-canvas .rfc-node {
  border-radius: 16px;
  box-shadow: 0 4px 16px #00000014;
}

.my-canvas .rfc-node.approval {
  border-color: #16a085;
}

.my-canvas .rfc-node.rfc-selected {
  border-color: var(--rfc-accent);
}

.my-canvas .rfc-node-content {
  padding: 18px;
  justify-content: flex-start;
}

.my-canvas .rfc-port {
  width: 14px;
  height: 14px;
}

.my-canvas .rfc-port-source {
  background: #16a085;
}

.my-canvas .rfc-edge-path {
  stroke-width: 2.5;
}

.my-canvas .rfc-edge.rfc-selected .rfc-edge-path {
  stroke: var(--rfc-accent);
  stroke-width: 3.5;
}

.my-canvas .rfc-controls {
  left: 20px;
  bottom: 20px;
}

.my-canvas .rfc-minimap {
  right: 20px;
  bottom: 20px;
}
```

Set `className: 'approval'` on a node to apply its variant. Use the node's
`width` and `height` fields to change its layout size; CSS-only dimensions will
not update edge endpoints, bounds or hit-test geometry. To style a single edge,
set its `style` property or provide a custom edge renderer. Inline edge styles
take precedence over stylesheet rules, including selection styles.

Keep the canvas positioning, viewport transform, node transform, SVG coordinate
system and port transforms intact. Removing these breaks rendering and interaction.
Use `background`, `gridSize`, `snapGrid` and `nodeExtent` rather than overriding
their geometric behavior through CSS. Inline canvas background properties are
managed by the library; use `background="none"` before supplying a CSS background.

### Interaction presets

For a navigable viewer, use `readOnly`. Selection, pan/zoom and minimap navigation
remain available. To disable ordinary pane dragging, wheel zoom, selection and
the automatic overlays as well:

```tsx
<FlowCanvas
  readOnly
  elementsSelectable={false}
  panOnDrag={false}
  zoomOnScroll={false}
  showControls={false}
  showMiniMap={false}
  background="none"
/>
```

Space/middle-button pane dragging still pans even when `panOnDrag={false}`.
These settings are interaction preferences, not an access-control boundary.
Custom callbacks/renderers and instance methods can still mutate the graph.
Use application authorization for any protected operation.

For a grid-aligned editor, configure both visual spacing and movement snapping:

```tsx
<FlowCanvas
  background="lines"
  gridSize={24}
  snapGrid={[24, 24]}
  nodeExtent={{ x: 0, y: 0, width: 3000, height: 2000 }}
  minZoom={0.25}
  maxZoom={2}
/>
```

## Performance

The library has no layout engine or external graph/state/rendering dependencies.
It uses a single transformed HTML/SVG scene, stable node callbacks, memoized node
views, a node lookup map and requestAnimationFrame batching for pointer gestures.
Graph processing/render filtering is O(V+E); viewport culling is not a spatial
index and does not make filtering sublinear. Enabling the minimap still renders
one small rectangle per node.

Practical recommendations:

1. Enable `onlyRenderVisibleElements` for larger diagrams.
2. Keep renderer maps stable; avoid recreating every node object on each update.
3. Use simple node DOM. Avoid heavy charts or many animated edges.
4. Disable the minimap if the node count makes it expensive.
5. Keep `onChange` synchronous and cheap; debounce persistence, not graph updates.
6. Measure your own browser workloads; graph utility timings are not FPS claims.

A reference measurement using Node 24 produced the following utility timings and
minified/gzip bundle sizes:

| Measurement | Result |
| --- | --- |
| Structural validation: 10,000 nodes, 9,999 edges | ~5.3 ms median |
| Cycle detection: same graph | ~3.9 ms median |
| Minified JavaScript, React excluded | ~28 KB |
| Gzipped JavaScript / CSS | ~10 KB / ~1.3 KB |

Sizes/timings vary with builds and hardware. This benchmark **does not** establish
browser rendering capacity or guarantee smooth interaction at 10,000 nodes.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Empty or collapsed canvas | Give the parent an explicit height and nonzero width; import the library CSS |
| Missing styles | Import `@lp-labs/react-flow-canvas/style.css` in a location supported by your app's CSS bundler |
| Controlled graph appears to revert | Apply every `onChange` graph synchronously; debounce persistence only |
| Node content is clipped | Set node `width`/`height`; content is not auto-measured |
| Edges do not follow a CSS-resized node | Update graph dimensions rather than overriding geometry with CSS |
| Connection rejected | Check port directions/IDs, duplicate/self-connection policy and your validator |
| Two edges appear after one connection | Use `autoConnect={false}` when manually adding an edge in `onConnect` |
| Import fails | Check version `1`, finite positions/viewport, unique IDs, endpoint/port references and application-data schema |
| Hook throws outside provider | Move the hook call into a canvas child or renderer; use `onInit` in a parent |
| Custom node resets local state | Keep renderer component identities and `nodeTypes` stable |
| Read-only custom input is still editable | Disable it yourself; imperative methods intentionally remain available |
| New document uses old undo history | Remount the canvas with a document-specific React `key` |
| Creating or duplicating elements fails on an insecure origin | Serve your application over HTTPS; `crypto.randomUUID()` requires a secure context |
| Interaction is slow on a large graph | Enable culling, simplify nodes and animations, disable minimap, profile your application callbacks |

## Independence and dependencies

The graph operations, geometry, SVG paths, interaction handling, history, minimap
and styles are implemented within this package. The library does not wrap or
import React Flow/xyflow, D3, a graph-layout engine, or an external state store.
It is not a fork, drop-in replacement, or affiliated with React Flow/xyflow.

The implementation was created for this project without using React Flow source
or assets. It uses standard React/browser APIs and general graph and geometry
techniques. Similar concepts or public terminology do not imply API compatibility.
This statement describes the project's implementation provenance; it is not an
exhaustive code-similarity audit or legal certification against every library.

The library has no runtime `dependencies`. React and its JSX runtime are peer
imports, not bundled copies. Your application supplies React DOM and
handles its own storage, networking and domain behavior. The library itself does
not fetch scripts, fonts or remote assets and contains no telemetry.

## Scope and limitations

This first release covers the core node-editor interactions. It intentionally does
not claim “all possible functionality.” In particular, it does not yet include:

- React Flow API compatibility or its complete accessibility/extension ecosystem.
- Automatic layout (DAG/force), obstacle routing or rich self-loop geometry.
- Nested/group nodes, parent-relative coordinates or node resizing/rotation UI.
- Edge reconnection handles, edge splitting or edge-label HTML portals.
- Native cross-canvas drag-and-drop, system clipboard integration or copy/paste.
- Real-time collaboration, persistence backend, execution engine or validation UI.
- Multi-pointer touch pinch, keyboard minimap navigation or spatial indexing.
- Auto-pan while dragging near canvas boundaries.

`duplicateSelected` provides local duplication rather than system clipboard access.
Custom renderers and graph updates can support domain-specific extensions, but
they are not substitutes for these missing built-in features.

Modern browsers with Pointer Events, ResizeObserver, requestAnimationFrame,
CSS variables, `color-mix()` and `crypto.randomUUID()` are expected. Serve over
HTTPS for the secure-context UUID API. Evaluate accessibility and performance
against your own application requirements.

## Author and support

Created by **Libin Prasanth**.

- [Connect on LinkedIn](https://www.linkedin.com/in/libinprasanth/)
- [Donate via PayPal](https://www.paypal.me/LibinPrasanth)
- [View the package on npm](https://www.npmjs.com/package/@lp-labs/react-flow-canvas)

If this library helps your project, a donation helps support continued maintenance
and development. Donations are optional; usage rights are governed by the MIT license.

## License

MIT. The full license text is included in the npm package.
