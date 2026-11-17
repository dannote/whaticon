import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  HASH_BYTES,
  HASH_SCHEME,
  dHashFromPixels,
  findMatchesByHash,
  isCompatibleIndex,
  parseIndex
} from '../src/hash.ts'
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
    expect(best).toMatchObject({ name: 'lucide:square', similarity: 1 })
    // Tabler's square hashes the same, so it folds into Lucide's, which is preferred.
    expect(best?.siblings).toContain('tabler:square')
  })

  test('rejects pixels too few for the grid', () => {
    expect(() => dHashFromPixels(new Uint8Array(10))).toThrow()
  })

  test('the hash module imports nothing from Node', () => {
    const source = readFileSync(resolve(import.meta.dir, '../src/hash.ts'), 'utf8')
    expect(source).not.toMatch(/^import /m)
  })

  test('folds icons with identical hashes into one match, led by a preferred set', () => {
    const hash = (fill: number) => new Uint8Array(HASH_BYTES).fill(fill)
    const hashes = new Uint8Array(HASH_BYTES * 4)
    hashes.set(hash(0xff), 0)
    hashes.set(hash(0xff), HASH_BYTES)
    hashes.set(hash(0xff), HASH_BYTES * 2)
    hashes.set(hash(0xfe), HASH_BYTES * 3)
    const index = parseIndex('mdi:a\nmaterial:a\ntabler:a\nlucide:b', hashes)

    const matches = findMatchesByHash(hash(0xff), index, { prefer: ['material'], limit: 2 })
    expect(matches).toEqual([
      { name: 'material:a', similarity: 1, siblings: ['mdi:a', 'tabler:a'] },
      { name: 'lucide:b', similarity: 1 - 128 / 1024 }
    ])
  })

  test('refuses an index whose hashes do not fit its names, or hashed another way', () => {
    expect(() => parseIndex('a:b\nc:d', new Uint8Array(HASH_BYTES))).toThrow()
    expect(isCompatibleIndex({})).toBe(false)
    expect(isCompatibleIndex({ scheme: 'dhash-32' })).toBe(false)
    expect(isCompatibleIndex({ scheme: HASH_SCHEME })).toBe(true)
    expect(isCompatibleIndex({ scheme: 'phash-64' })).toBe(false)
  })
})
