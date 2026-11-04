import { build } from 'esbuild';
await build({ entryPoints: ['src/main/index.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/main/index.cjs', external: ['electron'], sourcemap: true });
await build({ entryPoints: ['src/preload/index.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/preload/index.cjs', external: ['electron'] });
