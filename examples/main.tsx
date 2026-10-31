import { StrictMode, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  FlowCanvas, Panel, hasCycle, parseDocument, serialize,
} from '../src';
import type { FlowInstance, FlowNode, Graph, NodeRenderer, Point } from '../src';
import '../src/style.css';
import './style.css';

interface TaskData { label: string; category: string; detail: string; color: string }
type TaskGraph = Graph<TaskData>;
const seed: TaskGraph = {
  nodes: [
    { id: 'trigger', type: 'task', position: { x: 40, y: 190 }, width: 220, height: 110, data: { label: 'New customer', category: 'TRIGGER', detail: 'Webhook received', color: '#16a085' }, ports: [{ id: 'out', type: 'source', side: 'right' }] },
    { id: 'enrich', type: 'task', position: { x: 350, y: 190 }, width: 220, height: 110, data: { label: 'Enrich profile', category: 'ACTION', detail: 'Look up company data', color: '#6366f1' } },
    { id: 'condition', type: 'task', position: { x: 660, y: 190 }, width: 220, height: 110, data: { label: 'Check company size', category: 'CONDITION', detail: 'Employees greater than 50', color: '#d97706' }, ports: [{ id: 'in', type: 'target', side: 'left' }, { id: 'yes', type: 'source', side: 'right', offset: 0.3, label: 'Yes branch' }, { id: 'no', type: 'source', side: 'right', offset: 0.75, label: 'No branch' }] },
    { id: 'sales', type: 'task', position: { x: 990, y: 75 }, width: 220, height: 110, data: { label: 'Notify sales team', category: 'ACTION', detail: 'Send a Slack message', color: '#6366f1' } },
    { id: 'email', type: 'task', position: { x: 990, y: 310 }, width: 220, height: 110, data: { label: 'Welcome email', category: 'ACTION', detail: 'Start onboarding sequence', color: '#6366f1' } },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'enrich', animated: true },
    { id: 'e2', source: 'enrich', target: 'condition' },
    { id: 'e3', source: 'condition', sourcePort: 'yes', target: 'sales', label: 'Yes' },
    { id: 'e4', source: 'condition', sourcePort: 'no', target: 'email', label: 'No', type: 'step' },
  ],
};
const taskRenderer: NodeRenderer<TaskData> = ({ node }) => <div className="task-node">
  <div className="task-category" style={{ color: node.data.color }}><span style={{ background: node.data.color }} />{node.data.category}</div>
  <strong>{node.data.label}</strong><small>{node.data.detail}</small>
</div>;
const nodeTypes = { task: taskRenderer };
const templates: TaskData[] = [
  { label: 'Webhook', category: 'TRIGGER', detail: 'Start from an external event', color: '#16a085' },
  { label: 'HTTP request', category: 'ACTION', detail: 'Connect to any REST API', color: '#6366f1' },
  { label: 'Condition', category: 'CONDITION', detail: 'Branch with a business rule', color: '#d97706' },
  { label: 'Send message', category: 'ACTION', detail: 'Keep your team in the loop', color: '#6366f1' },
];
function App() {
  const [graph, setGraph] = useState<TaskGraph>(seed);
  const [selected, setSelected] = useState<FlowNode<TaskData> | undefined>();
  const [status, setStatus] = useState('All changes are kept in this tab');
  const [dark, setDark] = useState(false);
  const [snap, setSnap] = useState(true);
  const flow = useRef<FlowInstance<TaskData> | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const add = (data: TaskData, position?: Point) => {
    const point = position ?? flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 100, y: 100 };
    flow.current?.addNodes([{ id: `node-${crypto.randomUUID()}`, type: 'task', position: point, width: 220, height: 110, data: { ...data } }]);
  };
  const save = () => {
    const current = flow.current;
    if (!current) return;
    const url = URL.createObjectURL(new Blob([serialize(current.getGraph(), current.getViewport())], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'workflow.json'; a.click(); URL.revokeObjectURL(url);
    setStatus('Workflow exported');
  };
  const importFile = async (input: File | undefined) => {
    if (!input) return;
    try {
      const document = parseDocument(await input.text());
      const nodes = document.graph.nodes.map(node => {
        const data = node.data;
        if (typeof data !== 'object' || data === null || !('label' in data) || typeof data.label !== 'string' ||
          !('category' in data) || typeof data.category !== 'string' || !('detail' in data) || typeof data.detail !== 'string' ||
          !('color' in data) || typeof data.color !== 'string') throw new Error(`Node ${node.id} does not have valid task data.`);
        return { ...node, data: { label: data.label, category: data.category, detail: data.detail, color: data.color } };
      });
      // The example accepts structural edge data but does not use it.
      flow.current?.load({ ...document, graph: { nodes, edges: document.graph.edges.map(({ data: _data, ...edge }) => edge) } });
      setStatus('Workflow imported');
    } catch (error) {
      setStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (file.current) file.current.value = ''; }
  };
  const onChange = useCallback((next: TaskGraph) => {
    setGraph(next); setSelected(next.nodes.find(n => n.selected)); setStatus('All changes are kept in this tab');
  }, []);
  return <main className={dark ? 'studio dark' : 'studio'}>
    <header>
      <a className="brand" href="#" aria-label="Flow Canvas home"><span className="brand-mark">f</span>flow<span className="brand-light">canvas</span><em>PLAYGROUND</em></a>
      <div className="workflow-name"><span className="status-dot" />Customer onboarding <span className="draft">Draft</span></div>
      <div className="header-actions"><button onClick={() => setDark(!dark)}>{dark ? 'Light mode' : 'Dark mode'}</button><button onClick={() => file.current?.click()}>Import</button><button className="primary" onClick={save}>Export JSON <span aria-hidden="true">&rarr;</span></button></div>
      <input hidden ref={file} type="file" accept=".json,application/json" onChange={event => { void importFile(event.target.files?.[0]); }} />
    </header>
    <aside className="library">
      <div className="section-heading">BUILD YOUR WORKFLOW</div><h1>Node library</h1><p>Click a block to add it to your canvas.</p>
      <div className="template-list">{templates.map((data, i) => <button key={data.label} className="template" onClick={() => add(data)}>
        <span className="template-icon" style={{ color: data.color, background: `${data.color}14` }}>{['~', '{}', '?', '@'][i]}</span><span><strong>{data.label}</strong><small>{data.detail}</small></span><b>+</b>
      </button>)}</div>
      <div className="library-tip"><strong>A little room to explore.</strong><p>Drag from an output to an input, or click each port. Double-click empty space to add a node.</p></div>
      <div className="shortcuts"><strong>KEYBOARD SHORTCUTS</strong><span>Select all <kbd>Ctrl / Cmd A</kbd></span><span>Duplicate <kbd>Ctrl / Cmd D</kbd></span><span>Undo <kbd>Ctrl / Cmd Z</kbd></span><span>Multi-select <kbd>Shift + drag</kbd></span><span>Delete selection <kbd>Delete</kbd></span></div>
      <a className="docs-link" href="https://www.npmjs.com/package/@lp-labs/react-flow-canvas" target="_blank" rel="noreferrer">npm package (after publishing) &nearr;</a>
    </aside>
    <section className="editor" aria-label="Workflow workspace">
      <FlowCanvas<TaskData>
        value={graph} onChange={onChange} onInit={instance => { flow.current = instance; }}
        nodeTypes={nodeTypes} fitView showMiniMap snapGrid={snap ? [20, 20] : undefined}
        onlyRenderVisibleElements onPaneDoubleClick={position => add(templates[1], position)}
        isValidConnection={(connection, current) => !hasCycle({ ...current, edges: [...current.edges, { id: 'candidate', ...connection }] })}
        onConnectionRejected={() => setStatus('Connection rejected: duplicate, incompatible ports, or cycle')}
      >
        <Panel><div className="canvas-badge"><span />WORKFLOW EDITOR <b>v0.1</b></div></Panel>
        <Panel position="top-right"><label className="snap-toggle"><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} />Snap to grid</label></Panel>
      </FlowCanvas>
      <div className="canvas-footer"><span><span className="status-dot" />{status}</span><span>{graph.nodes.length} nodes <i />{graph.edges.length} connections <i />Zero runtime dependencies*</span></div>
    </section>
    <aside className="inspector">
      <div className="section-heading">MAKE IT YOURS</div><h2>Inspector</h2>
      {selected ? <div className="inspector-body"><span className="type-pill" style={{ color: selected.data.color }}>{selected.data.category}</span><h3>{selected.data.label}</h3>
        <label>Node label<input value={selected.data.label} onChange={event => flow.current?.updateNode(selected.id, { data: { ...selected.data, label: event.target.value } })} /></label>
        <label>Description<input value={selected.data.detail} onChange={event => flow.current?.updateNode(selected.id, { data: { ...selected.data, detail: event.target.value } })} /></label>
        <div className="coordinate-row"><span>X <b>{Math.round(selected.position.x)}</b></span><span>Y <b>{Math.round(selected.position.y)}</b></span></div>
        <button onClick={() => flow.current?.duplicateSelected()}>Duplicate selection</button><button className="danger" onClick={() => flow.current?.deleteSelected()}>Delete selection</button>
      </div> : <div className="inspector-empty"><div className="empty-icon">+</div><h3>Every detail, in focus.</h3><p>Select a node to edit its properties and make this workflow your own.</p></div>}
      <div className="package-note"><span className="package-icon">{'{ }'}</span><strong>Small by design.</strong><p>Typed API. Custom nodes. Your data.<br />No runtime dependencies beyond React.</p><code>@lp-labs/react-flow-canvas</code><small>* React is a peer dependency.</small></div>
    </aside>
  </main>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing root element.');
createRoot(root).render(<StrictMode><App /></StrictMode>);
