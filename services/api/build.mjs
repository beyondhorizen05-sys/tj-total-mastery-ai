import { build } from 'esbuild';
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts', 'src/cli/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['node:*'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

// Ship the built web UI alongside the API so `pnpm start` serves the full app.
if (existsSync('../../apps/web/dist')) {
  cpSync('../../apps/web/dist', 'dist/public', { recursive: true });
  console.log('Copied web UI into dist/public');
}
