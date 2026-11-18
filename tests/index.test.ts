import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  NAMED_AT,
  buildIndex,
  compareMatches,
  computeDHash,
  fetchIconSvg,
  findMatches,
  hammingDistance,
  hashSimilarity,
  loadIndex,
  svgToPixels
} from '../src/index.ts'
import { iconSvg } from './icons.ts'

const SIMPLE_RECT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="4" y="4" width="16" height="16" fill="black"/>
</svg>`

const SIMPLE_CIRCLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="8" fill="black"/>
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
  test('hashes an SVG far larger than the hash as it hashes a small one', async () => {
    const large = SIMPLE_RECT.replace('<svg ', '<svg width="4000" height="4000" ')
    expect(hammingDistance(await computeDHash(large), await computeDHash(SIMPLE_RECT))).toBe(0)
  })

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

describe('hashing as the index hashes', () => {
  const dataDir = resolve(import.meta.dirname, '../data')
  const index = loadIndex(
    readFileSync(resolve(dataDir, 'names.txt.gz')),
    readFileSync(resolve(dataDir, 'hashes.bin.gz'))
  )

  test('an icon narrower than it is tall hashes as its own index entry', async () => {
    const [match] = await findMatches(iconSvg('fa6-solid:0'), index, { limit: 1 })
    expect(match).toMatchObject({ name: 'fa6-solid:0', similarity: 1 })
  })

  test('an icon hashes the same in any color', async () => {
    const black = iconSvg('lucide:home')
    const white = black.replace('<svg ', '<svg color="white" ')
    const brand = black.replace('<svg ', '<svg color="#3b82f6" ')
    expect(white).not.toBe(black)
    expect(hammingDistance(await computeDHash(white), await computeDHash(black))).toBe(0)
    expect(hammingDistance(await computeDHash(brand), await computeDHash(black))).toBe(0)
  })
})

describe('buildIndex', () => {
  test('leaves out and reports the icons that do not render', async () => {
    const viewBox = [0, 0, 24, 24] as const
    const { names, hashes, skipped } = await buildIndex([
      { name: 'my:square', body: '<rect x="4" y="4" width="16" height="16"/>', viewBox },
      { name: 'my:broken', body: '<rect', viewBox }
    ])
    expect(names).toBe('my:square')
    expect(hashes).toHaveLength(128)
    expect(skipped).toEqual(['my:broken'])
  })
})

describe('compareMatches', () => {
  test('scores matches by how alike they draw, so a lookalike falls below NAMED_AT', async () => {
    const house = iconSvg('lucide:house')
    const compared = await compareMatches(
      house,
      [
        { name: 'lucide:search', similarity: 0.9 },
        { name: 'lucide:house', similarity: 0.8 },
        { name: 'lucide:missing', similarity: 0.7 }
      ],
      async (name) => iconSvg(name)
    )

    expect(compared.map((match) => match.name)).toEqual(['lucide:house', 'lucide:search'])
    expect(compared[0]?.similarity).toBeGreaterThanOrEqual(NAMED_AT)
    expect(compared[1]?.similarity).toBeLessThan(NAMED_AT)
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
  afterEach(() => {
    mock.restore()
  })

  test('fetches the SVG the Iconify API serves for the icon', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<svg></svg>'))
    expect(await fetchIconSvg('lucide:home')).toBe('<svg></svg>')
    expect(fetch).toHaveBeenCalledWith('https://api.iconify.design/lucide/home.svg')
  })

  test('throws on invalid icon name', async () => {
    expect(await fetchIconSvg('invalid').catch(String)).toContain('Invalid icon name')
  })

  test('throws on non-existent icon', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response('404', { status: 404 }))
    expect(await fetchIconSvg('lucide:nonexistent-icon-xyz').catch(String)).toContain(
      'Failed to fetch'
    )
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
    const svg = iconSvg('lucide:home')
    const matches = await findMatches(svg, index, { limit: 1 })

    expect(matches.length).toBe(1)
    expect(matches[0]?.similarity).toBeGreaterThan(0.95)
  })

  test('respects limit parameter', async () => {
    const svg = iconSvg('lucide:home')

    const m5 = await findMatches(svg, index, { limit: 5 })
    const m10 = await findMatches(svg, index, { limit: 10 })

    expect(m5.length).toBeLessThanOrEqual(5)
    expect(m10.length).toBeLessThanOrEqual(10)
  })

  test('respects threshold parameter', async () => {
    const svg = iconSvg('lucide:home')

    const m90 = await findMatches(svg, index, { threshold: 0.9, limit: 100 })
    const m80 = await findMatches(svg, index, { threshold: 0.8, limit: 100 })

    expect(m90.length).toBeLessThanOrEqual(m80.length)

    for (const m of m90) {
      expect(m.similarity).toBeGreaterThanOrEqual(0.9)
    }
  })

  test('filters by prefix', async () => {
    const svg = iconSvg('lucide:home')
    const matches = await findMatches(svg, index, {
      prefixes: ['lucide'],
      limit: 20
    })

    for (const m of matches) {
      expect(m.name.startsWith('lucide:')).toBe(true)
    }
  })

  test('prefer option sorts preferred sets first at equal similarity', async () => {
    const svg = iconSvg('mdi:check')
    const matches = await findMatches(svg, index, {
      prefer: ['lucide'],
      threshold: 0.85,
      limit: 50
    })

    // Find adjacent pairs with same similarity
    for (const [i, next] of matches.slice(1).entries()) {
      const curr = matches[i]
      if (!curr) continue

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
    const svg = iconSvg('lucide:home')
    const matches = await findMatches(svg, index, { limit: 20 })

    for (const [i, next] of matches.slice(1).entries()) {
      // Allow small tolerance (0.001) for prefer-based reordering
      expect((matches[i]?.similarity ?? 0) + 0.002).toBeGreaterThanOrEqual(next.similarity)
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
    const lucideHome = iconSvg('lucide:home')
    const matches = await findMatches(lucideHome, index, { threshold: 0.85, limit: 30 })

    const names = matches.map((m) => m.name)

    // Should find home-related icons
    const hasHomeRelated = names.some(
      (n) => n.includes('home') || n.includes('house') || n.includes('building')
    )
    expect(hasHomeRelated).toBe(true)
  })

  test('different icons have low similarity', async () => {
    const home = iconSvg('lucide:home')
    const search = iconSvg('lucide:search')

    const hHome = await computeDHash(home)
    const hSearch = await computeDHash(search)

    const sim = hashSimilarity(hHome, hSearch)
    expect(sim).toBeLessThan(0.9) // Should be noticeably different
  })
})
