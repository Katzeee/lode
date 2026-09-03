import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(appRoot, '..', '..');
const source = join(appRoot, 'src');
const output = join(appRoot, 'dist');
const designAssets = join(
  repositoryRoot,
  'packages',
  'design-tokens',
  'assets',
);
const require = createRequire(import.meta.url);
const tailwindCli = join(
  dirname(require.resolve('@tailwindcss/cli/package.json')),
  'dist/index.mjs',
);

await rm(output, { force: true, recursive: true });
await mkdir(join(output, 'engine-worker'), { recursive: true });

const tailwind = spawnSync(
  process.execPath,
  [
    tailwindCli,
    '-i',
    join(source, 'app.css'),
    '-o',
    join(output, 'app.css'),
    '--minify',
  ],
  { cwd: appRoot, stdio: 'inherit' },
);
if (tailwind.status !== 0) {
  throw new Error('Mobile Tailwind CSS build failed');
}

const browserBundle = {
  bundle: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  loader: { '.tsx': 'tsx' },
  logLevel: 'info',
  minify: true,
  platform: 'browser',
  sourcemap: false,
  target: ['chrome120'],
};

await Promise.all([
  build({
    ...browserBundle,
    entryPoints: [join(source, 'index.tsx')],
    outfile: join(output, 'index.js'),
  }),
  build({
    ...browserBundle,
    entryPoints: [join(source, 'engine-worker', 'index.ts')],
    format: 'iife',
    outfile: join(output, 'engine-worker', 'index.js'),
  }),
]);

await Promise.all([
  cp(join(appRoot, 'index.html'), join(output, 'index.html')),
  cp(designAssets, join(output, 'assets'), { recursive: true }),
]);
