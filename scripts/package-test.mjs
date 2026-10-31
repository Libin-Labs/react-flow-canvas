import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check using npm run test:package.');
const directory = await mkdtemp(join(tmpdir(), 'flow-canvas-package-'));
const require = createRequire(import.meta.url);
const reactVersion = require('react/package.json').version;
const reactTypesVersion = require('@types/react/package.json').version;
const runNpm = (args, cwd = process.cwd()) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8' });
try {
  const [packed] = JSON.parse(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', directory]));
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(Object.keys(manifest.peerDependencies), ['react']);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  console.log(runNpm([
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--package-lock=false', join(directory, packed.filename),
    `react@${reactVersion}`, `@types/react@${reactTypesVersion}`,
  ], directory).trim());
  const consumerRequire = createRequire(join(directory, 'consumer.cjs'));
  const cjs = consumerRequire(manifest.name);
  assert.equal(typeof cjs.FlowCanvas, 'function');
  assert.equal(cjs.hasCycle({ nodes: [], edges: [] }), false);
  assert.ok(consumerRequire.resolve(`${manifest.name}/style.css`).endsWith('style.css'));
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { FlowCanvas, serialize, parseDocument } from '${manifest.name}';
    assert.equal(typeof FlowCanvas, 'function');
    assert.equal(parseDocument(serialize({ nodes: [], edges: [] })).version, 1);
  `], { cwd: directory, stdio: 'inherit' });
  const typeSource = `
    import { FlowCanvas, type Graph, type FlowInstance } from '${manifest.name}';
    const graph: Graph<{ label: string }> = { nodes: [], edges: [] };
    const check = (api: FlowInstance<{ label: string }>) => api.setGraph(graph);
    const canvas: typeof FlowCanvas<{ label: string }> = FlowCanvas;
    void canvas; void check;
  `;
  const esmTypes = join(directory, 'consumer.mts'), cjsTypes = join(directory, 'consumer.cts');
  await Promise.all([writeFile(esmTypes, typeSource), writeFile(cjsTypes, typeSource)]);
  execFileSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'), esmTypes, cjsTypes, '--noEmit', '--strict',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2020',
    '--jsx', 'react-jsx', '--skipLibCheck', 'false',
  ], { cwd: directory, stdio: 'inherit' });
  console.log('Tarball install, ESM, CommonJS, CSS export, declarations and zero-dependency manifest verified.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
