import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Runs against the BUILT extension: verify:m6 builds dist/ before vitest.
const DIST = path.resolve(process.cwd(), 'apps/extension/dist')

describe('built extension (dist/)', () => {
  it('is valid MV3 and every referenced file exists', () => {
    expect(fs.existsSync(path.join(DIST, 'manifest.json')), 'run: npm run build -w @app/extension').toBe(true)
    const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'))
    expect(manifest.manifest_version).toBe(3)
    expect(fs.existsSync(path.join(DIST, manifest.side_panel.default_path))).toBe(true)
    expect(fs.existsSync(path.join(DIST, manifest.background.service_worker))).toBe(true)
    for (const cs of manifest.content_scripts) {
      for (const js of cs.js) expect(fs.existsSync(path.join(DIST, js)), js).toBe(true)
    }
    // autofill is generalized: the hints content script must reach any
    // http(s) page, and the panel needs scripting for on-demand injection
    expect(manifest.host_permissions).toContain('<all_urls>')
    expect(manifest.permissions).toContain('scripting')
    const hints = manifest.content_scripts.find((cs: { js: string[] }) => cs.js.includes('content-hints.js'))
    expect(hints.matches).toEqual(['https://*/*', 'http://*/*'])
  })

  it('bundles are classic scripts with the shared extractor inlined', () => {
    const content = fs.readFileSync(path.join(DIST, 'content-hkust.js'), 'utf8')
    expect(content).not.toContain('import ')
    expect(content).toContain('career-content')
    const panel = fs.readFileSync(path.join(DIST, 'panel.js'), 'utf8')
    expect(panel).toContain('api/jobs/match')
  })
})
