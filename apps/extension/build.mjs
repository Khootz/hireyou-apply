// Builds the MV3 extension into dist/ (the directory to load unpacked).
// Content scripts and the service worker must be classic scripts, so
// everything is bundled as IIFE.
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, 'dist')

fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [
    path.join(root, 'src/content-hkust.ts'),
    path.join(root, 'src/content-hints.ts'),
    path.join(root, 'src/sw.ts'),
    path.join(root, 'src/panel.ts'),
  ],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir: dist,
  minify: false,
})

for (const file of fs.readdirSync(path.join(root, 'public'))) {
  fs.copyFileSync(path.join(root, 'public', file), path.join(dist, file))
}

console.log('extension built into', dist)
