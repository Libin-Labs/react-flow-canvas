import { context } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('examples/dist', { recursive: true });
await copyFile('examples/index.html', 'examples/dist/index.html');
const ctx = await context({
  entryPoints: ['examples/main.tsx'],
  bundle: true,
  outfile: 'examples/dist/app.js',
  sourcemap: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
});
await ctx.watch();
const { port } = await ctx.serve({ servedir: 'examples/dist', host: '127.0.0.1', port: 5173 });
console.log(`Example ready at http://127.0.0.1:${port}`);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { await ctx.dispose(); process.exit(0); });
}
