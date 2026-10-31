import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

const result = await build({ entryPoints: ['src/graph.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { validateGraph, hasCycle } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const nodes = Array.from({ length: 10_000 }, (_, i) => ({ id: String(i), position: { x: i * 200, y: 0 }, data: {} }));
const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: String(i), target: n.id }));
const graph = { nodes, edges };
for (const [name, run] of [['validateGraph', () => validateGraph(graph)], ['hasCycle', () => hasCycle(graph)]]) {
  for (let i = 0; i < 5; i++) run();
  const samples = [];
  for (let i = 0; i < 20; i++) { const start = performance.now(); run(); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  console.log(`${name}: median ${samples[10].toFixed(2)}ms, p95 ${samples[19].toFixed(2)}ms (10,000 nodes, 9,999 edges)`);
}
const library = await build({ entryPoints: ['src/index.ts'], bundle: true, minify: true, write: false, format: 'esm', external: ['react', 'react/jsx-runtime'], jsx: 'automatic' });
const js = library.outputFiles[0].contents, css = await readFile('src/style.css');
console.log(`Minified JS: ${js.length} bytes; gzip JS: ${gzipSync(js).length} bytes; gzip CSS: ${gzipSync(css).length} bytes. React excluded.`);
console.log('These are local core-utility timings, not browser rendering or interaction guarantees.');
