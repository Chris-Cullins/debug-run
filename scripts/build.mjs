import * as esbuild from 'esbuild';
import { chmodSync, writeFileSync, readFileSync } from 'fs';

await esbuild.build({
  entryPoints: ['./src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: './dist/index.cjs',
  banner: {
    js: `const __importMetaUrl = require("url").pathToFileURL(__filename).href;`,
  },
  define: {
    'import.meta.url': '__importMetaUrl',
  },
});

// Add shebang if not present
const content = readFileSync('./dist/index.cjs', 'utf-8');
const withShebang = content.startsWith('#!') ? content : '#!/usr/bin/env node\n' + content;
writeFileSync('./dist/index.cjs', withShebang);
chmodSync('./dist/index.cjs', 0o755);

console.log('Build complete');
