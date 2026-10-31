import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';

await mkdir('.test-build', { recursive: true });
try {
  await build({
    entryPoints: ['tests/core.test.ts', 'tests/canvas.test.tsx'],
    outdir: '.test-build',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    packages: 'external',
    jsx: 'automatic',
  });
  execFileSync(process.execPath, ['--test', '.test-build/core.test.js', '.test-build/canvas.test.js'], { stdio: 'inherit' });
} finally {
  await rm('.test-build', { recursive: true, force: true });
}
