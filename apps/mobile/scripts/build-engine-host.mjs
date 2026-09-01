import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const outputDirectory = path.join(
  appRoot,
  'android',
  'app',
  'src',
  'main',
  'assets',
  'lode-engine',
);

await build({
  entryPoints: [path.join(appRoot, 'src', 'engine-host', 'index.ts')],
  outfile: path.join(outputDirectory, 'host.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: false,
  logLevel: 'info',
});
