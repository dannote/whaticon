import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { dHashFromPixels, findMatchesByHash, parseIndex } from '../src/hash.ts'
import { computeDHash, loadIndex } from '../src/index.ts'

const SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>`

describe('hash without Node', () => {
  test('hashes pixels as the Node API hashes an SVG it rasterizes', async () => {
    const sharp = (await import('sharp')).default
    const pixels = await sharp(Buffer.from(SQUARE))
      .flatten({ background: '#ffffff' })
      .resize(33, 32, { fit: 'contain', background: '#ffffff' })
      .grayscale()
      .raw()
      .toBuffer()

    expect([...dHashFromPixels(new Uint8Array(pixels))]).toEqual([...(await computeDHash(SQUARE))])
  })

  test('finds an indexed icon by its hash, from an index read from bytes', async () => {
    const namesGz = readFileSync(resolve(import.meta.dir, '../data/names.txt.gz'))
    const hashesGz = readFileSync(resolve(import.meta.dir, '../data/hashes.bin.gz'))
    const loaded = loadIndex(namesGz, hashesGz)
    const index = parseIndex(loaded.names.join('\n'), new Uint8Array(loaded.hashes))
    const at = index.names.indexOf('lucide:square')
    const hash = index.hashes.slice(at * 128, (at + 1) * 128)

    const [best] = findMatchesByHash(hash, index, { limit: 1, threshold: 0.99, prefer: ['lucide'] })
    expect(best).toEqual({ name: 'lucide:square', similarity: 1 })
  })

  test('rejects pixels too few for the grid', () => {
    expect(() => dHashFromPixels(new Uint8Array(10))).toThrow()
  })

  test('the hash module imports nothing from Node', () => {
    const source = readFileSync(resolve(import.meta.dir, '../src/hash.ts'), 'utf8')
    expect(source).not.toMatch(/^import /m)
  })
})
