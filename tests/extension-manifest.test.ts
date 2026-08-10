import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const EXT_DIR = path.resolve(process.cwd(), 'apps/extension')

describe('extension manifest', () => {
  it('is valid MV3 and every referenced file exists', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'))
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.side_panel?.default_path).toBeTruthy()
    expect(fs.existsSync(path.join(EXT_DIR, manifest.side_panel.default_path))).toBe(true)
    expect(fs.existsSync(path.join(EXT_DIR, manifest.background.service_worker))).toBe(true)
    expect(manifest.permissions).toContain('sidePanel')
  })
})
