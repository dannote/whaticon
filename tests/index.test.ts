import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  computeDHash,
  fetchIconSvg,
  findMatches,
  hammingDistance,
  hashSimilarity,
  loadIndex,
  svgToPixels
} from '../src/index.ts'

const SIMPLE_RECT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="4" y="4" width="16" height="16" fill="black"/>
</svg>`

const SIMPLE_CIRCLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="8" fill="black"/>
</svg>`

const SIMPLE_LINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path stroke="black" stroke-width="2" d="M4 12h16"/>
</svg>`

describe('svgToPixels', () => {
  test('returns buffer of correct size', async () => {
    const pixels = await svgToPixels(SIMPLE_RECT, 32)
    expect(pixels.length).toBe(32 * 32) // grayscale = 1 byte per pixel
  })

  test('accepts Buffer input', async () => {
    const pixels = await svgToPixels(Buffer.from(SIMPLE_RECT), 32)
    expect(pixels.length).toBe(32 * 32)
  })

  test('different sizes work', async () => {
    const p16 = await svgToPixels(SIMPLE_RECT, 16)
    const p64 = await svgToPixels(SIMPLE_RECT, 64)
    expect(p16.length).toBe(16 * 16)
    expect(p64.length).toBe(64 * 64)
  })
})

describe('computeDHash', () => {
  test('returns 128-byte buffer', async () => {
    const hash = await computeDHash(SIMPLE_RECT)
    expect(hash.length).toBe(128) // 1024 bits = 128 bytes
  })

  test('same image produces same hash', async () => {
    const h1 = await computeDHash(SIMPLE_RECT)
    const h2 = await computeDHash(SIMPLE_RECT)
    expect(h1.equals(h2)).toBe(true)
  })

  test('different images produce different hashes', async () => {
    const hRect = await computeDHash(SIMPLE_RECT)
    const hCircle = await computeDHash(SIMPLE_CIRCLE)
    expect(hRect.equals(hCircle)).toBe(false)
  })

  test('scaled SVG produces same hash', async () => {
    const svg24 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="16" fill="black"/>
    </svg>`
    const svg48 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect x="8" y="8" width="32" height="32" fill="black"/>
    </svg>`

    const h24 = await computeDHash(svg24)
    const h48 = await computeDHash(svg48)

    // Should be very similar (allowing small differences from scaling)
    const dist = hammingDistance(h24, h48)
    expect(dist).toBeLessThan(50) // Less than 5% difference
  })
})

describe('hammingDistance', () => {
  test('identical hashes have distance 0', async () => {
    const hash = await computeDHash(SIMPLE_RECT)
    expect(hammingDistance(hash, hash)).toBe(0)
  })

  test('completely different hashes have high distance', () => {
    const h1 = Buffer.alloc(128, 0x00)
    const h2 = Buffer.alloc(128, 0xff)
    expect(hammingDistance(h1, h2)).toBe(1024) // All bits different
  })

  test('single bit difference', () => {
    const h1 = Buffer.alloc(128, 0x00)
    const h2 = Buffer.alloc(128, 0x00)
    h2[0] = 0x01
    expect(hammingDistance(h1, h2)).toBe(1)
  })

  test('throws on length mismatch', () => {
    const h1 = Buffer.alloc(128)
    const h2 = Buffer.alloc(64)
    expect(() => hammingDistance(h1, h2)).toThrow('Hash length mismatch')
  })
})

describe('hashSimilarity', () => {
  test('identical hashes have similarity 1.0', async () => {
    const hash = await computeDHash(SIMPLE_RECT)
    expect(hashSimilarity(hash, hash)).toBe(1.0)
  })

  test('completely different hashes have similarity 0.0', () => {
    const h1 = Buffer.alloc(128, 0x00)
    const h2 = Buffer.alloc(128, 0xff)
    expect(hashSimilarity(h1, h2)).toBe(0.0)
  })

  test('similar images have high similarity', async () => {
    const hRect = await computeDHash(SIMPLE_RECT)
    const hCircle = await computeDHash(SIMPLE_CIRCLE)
    const sim = hashSimilarity(hRect, hCircle)

    // Both are centered shapes, should have some similarity
    expect(sim).toBeGreaterThan(0.5)
    expect(sim).toBeLessThan(1.0)
  })
})

describe('fetchIconSvg', () => {
  test('fetches valid SVG from Iconify', async () => {
    const svg = await fetchIconSvg('lucide:home')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })

  test('throws on invalid icon name', async () => {
    await expect(fetchIconSvg('invalid')).rejects.toThrow('Invalid icon name')
  })

  test('throws on non-existent icon', async () => {
    await expect(fetchIconSvg('lucide:nonexistent-icon-xyz')).rejects.toThrow('Failed to fetch')
  })
})

describe('loadIndex', () => {
  const dataDir = resolve(import.meta.dirname, '../data')

  test('loads index from gzipped files', () => {
    const namesGz = readFileSync(resolve(dataDir, 'names.txt.gz'))
    const hashesGz = readFileSync(resolve(dataDir, 'hashes.bin.gz'))

    const index = loadIndex(namesGz, hashesGz)

    expect(index.names.length).toBeGreaterThan(0)
    expect(index.hashes.length).toBe(index.names.length * 128)
  })

  test('names are in prefix:name format', () => {
    const namesGz = readFileSync(resolve(dataDir, 'names.txt.gz'))
    const hashesGz = readFileSync(resolve(dataDir, 'hashes.bin.gz'))

    const index = loadIndex(namesGz, hashesGz)

    for (const name of index.names.slice(0, 100)) {
      expect(name).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/i)
    }
  })
})

describe('findMatches', () => {
  const dataDir = resolve(import.meta.dirname, '../data')
  const namesGz = readFileSync(resolve(dataDir, 'names.txt.gz'))
  const hashesGz = readFileSync(resolve(dataDir, 'hashes.bin.gz'))
  const index = loadIndex(namesGz, hashesGz)

  test('finds exact match for known icon', async () => {
    const svg = await fetchIconSvg('lucide:home')
    const matches = await findMatches(svg, index, { limit: 1 })

    expect(matches.length).toBe(1)
    expect(matches[0]!.similarity).toBeGreaterThan(0.95)
  })

  test('respects limit parameter', async () => {
    const svg = await fetchIconSvg('lucide:home')

    const m5 = await findMatches(svg, index, { limit: 5 })
    const m10 = await findMatches(svg, index, { limit: 10 })

    expect(m5.length).toBeLessThanOrEqual(5)
    expect(m10.length).toBeLessThanOrEqual(10)
  })

  test('respects threshold parameter', async () => {
    const svg = await fetchIconSvg('lucide:home')

    const m90 = await findMatches(svg, index, { threshold: 0.9, limit: 100 })
    const m80 = await findMatches(svg, index, { threshold: 0.8, limit: 100 })

    expect(m90.length).toBeLessThanOrEqual(m80.length)

    for (const m of m90) {
      expect(m.similarity).toBeGreaterThanOrEqual(0.9)
    }
  })

  test('filters by prefix', async () => {
    const svg = await fetchIconSvg('lucide:home')
    const matches = await findMatches(svg, index, {
      prefixes: ['lucide'],
      limit: 20
    })

    for (const m of matches) {
      expect(m.name.startsWith('lucide:')).toBe(true)
    }
  })

  test('prefer option sorts preferred sets first at equal similarity', async () => {
    const svg = await fetchIconSvg('mdi:check')
    const matches = await findMatches(svg, index, {
      prefer: ['lucide'],
      threshold: 0.85,
      limit: 50
    })

    // Find adjacent pairs with same similarity
    for (let i = 0; i < matches.length - 1; i++) {
      const curr = matches[i]!
      const next = matches[i + 1]!

      if (Math.abs(curr.similarity - next.similarity) < 0.001) {
        const currIsLucide = curr.name.startsWith('lucide:')
        const nextIsLucide = next.name.startsWith('lucide:')

        // If next is lucide but curr is not, that's wrong order
        if (nextIsLucide && !currIsLucide) {
          throw new Error(`Preferred lucide icon ${next.name} should come before ${curr.name}`)
        }
      }
    }
  })

  test('results are sorted by similarity descending (with tolerance for prefer)', async () => {
    const svg = await fetchIconSvg('lucide:home')
    const matches = await findMatches(svg, index, { limit: 20 })

    for (let i = 0; i < matches.length - 1; i++) {
      // Allow small tolerance (0.001) for prefer-based reordering
      expect(matches[i]!.similarity + 0.002).toBeGreaterThanOrEqual(matches[i + 1]!.similarity)
    }
  })
})

describe('visual similarity', () => {
  const dataDir = resolve(import.meta.dirname, '../data')
  const namesGz = readFileSync(resolve(dataDir, 'names.txt.gz'))
  const hashesGz = readFileSync(resolve(dataDir, 'hashes.bin.gz'))
  const index = loadIndex(namesGz, hashesGz)

  test('similar icons from different sets match', async () => {
    // Home icons should be visually similar across sets
    const lucideHome = await fetchIconSvg('lucide:home')
    const matches = await findMatches(lucideHome, index, { threshold: 0.85, limit: 30 })

    const names = matches.map((m) => m.name)

    // Should find home-related icons
    const hasHomeRelated = names.some(
      (n) => n.includes('home') || n.includes('house') || n.includes('building')
    )
    expect(hasHomeRelated).toBe(true)
  })

  test('different icons have low similarity', async () => {
    const home = await fetchIconSvg('lucide:home')
    const search = await fetchIconSvg('lucide:search')

    const hHome = await computeDHash(home)
    const hSearch = await computeDHash(search)

    const sim = hashSimilarity(hHome, hSearch)
    expect(sim).toBeLessThan(0.9) // Should be noticeably different
  })
})
