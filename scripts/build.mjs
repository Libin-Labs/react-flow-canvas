import { build } from 'esbuild';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

await mkdir('dist', { recursive: true });
const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  sourcemap: true,
  minify: false,
};
await Promise.all([
  build({ ...shared, format: 'esm', outfile: 'dist/index.js' }),
  build({ ...shared, format: 'cjs', outfile: 'dist/index.cjs' }),
  copyFile('src/style.css', 'dist/style.css'),
]);
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' });
await mkdir('dist/cjs', { recursive: true });
await Promise.all((await readdir('dist')).filter(name => name.endsWith('.d.ts')).map(name => copyFile(`dist/${name}`, `dist/cjs/${name}`)));
await writeFile('dist/cjs/package.json', '{"type":"commonjs"}\n');
console.log('Built ESM, CommonJS, declarations, source maps and CSS.');
