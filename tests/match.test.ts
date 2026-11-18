import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import sharp from 'sharp'
import * as v from 'valibot'

import { DEFAULT_SIZE, dHashFromPixels, parseIndex } from '../src/hash.ts'
import {
  INDEX_URL,
  coverageFromRGBA,
  coverageSimilarity,
  createMatcher,
  fetchIndex,
  type MatcherServices
} from '../src/match.ts'
import { VERSION } from '../src/version.ts'
import { iconSvg } from './icons.ts'

/** A host drawing SVG fitted in its box on transparency, as `MatcherServices.draw` asks. */
const draw: MatcherServices['draw'] = async (svg, width, height) => {
  const { data, info } = await sharp(Buffer.from(svg), { density: 300 })
    .ensureAlpha()
    .resize(width, height, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

const NAMES = ['lucide:house', 'lucide:search']

const box = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`

/** Icons the tests draw beyond installed ones. */
const DRAWN: Record<string, string> = {
  // The same right edge, so the same difference hash: it records only edges darkening rightward.
  'test:wide': box('<rect x="2" y="6" width="20" height="12"/>'),
  'test:narrow': box('<rect x="14" y="6" width="8" height="12"/>'),
  'test:house-dot': iconSvg('lucide:house').replace(
    '</svg>',
    '<circle cx="12" cy="3" r="1"/></svg>'
  )
}

const svgOf = (name: string) => DRAWN[name] ?? iconSvg(name)

/** An index of `names`, hashed as the matcher hashes what it is given. */
async function indexOf(names: readonly string[]) {
  const hashes = await Promise.all(
    names.map(async (name) => {
      const image = await draw(svgOf(name), DEFAULT_SIZE + 1, DEFAULT_SIZE)
      if (!image) throw new Error(`${name} did not draw`)
      return dHashFromPixels(coverageFromRGBA(image, DEFAULT_SIZE + 1, DEFAULT_SIZE))
    })
  )
  const bytes = new Uint8Array(hashes.length * 128)
  hashes.forEach((hash, i) => bytes.set(hash, i * 128))
  return parseIndex(names.join('\n'), bytes)
}

const testIndex = () => indexOf(NAMES)

function testIcons() {
  return mock(async (names: readonly string[]) => new Map(names.map((name) => [name, svgOf(name)])))
}

afterEach(() => {
  mock.restore()
})

describe('coverage', () => {
  test('centers an image in its box, as darkness on white', () => {
    // One opaque pixel and one half covered, in a 2 by 1 image.
    const image = { width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 128]) }
    const grid = coverageFromRGBA(image, 4, 3)

    // The middle row of three, the image one pixel in from the left; the rest is white.
    expect([...grid.subarray(4, 8)]).toEqual([255, 0, 127, 255])
    expect(grid.filter((value) => value !== 255)).toHaveLength(2)
  })

  test('compares the ink two drawings have, not the white around them', () => {
    const blank = new Uint8Array(100).fill(255)
    const dot = blank.slice()
    dot[0] = 0
    const otherDot = blank.slice()
    otherDot[99] = 0

    expect(coverageSimilarity(dot, dot)).toBe(1)
    expect(coverageSimilarity(dot, otherDot)).toBe(0)
    expect(coverageSimilarity(blank, blank)).toBe(1)
  })
})

describe('naming icons by how they draw', () => {
  test('names an icon drawn at another size and color', async () => {
    const match = createMatcher({ index: testIndex, icons: testIcons(), draw })
    const pageCopy = iconSvg('lucide:house').replace('<svg ', '<svg color="#ffffff" ')

    expect(await match([pageCopy])).toEqual(['lucide:house'])
  })

  test('names nothing for artwork that only resembles an icon', async () => {
    const match = createMatcher({ index: testIndex, icons: testIcons(), draw })
    const lens = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" fill="none" stroke="black" stroke-width="2"/><rect x="16" y="16" width="5" height="5"/></svg>`

    expect(await match([lens])).toEqual([null])
  })

  test('loads the icons SVGs passed together compare with at once, and compares each once', async () => {
    const icons = testIcons()
    const match = createMatcher({ index: testIndex, icons, draw })
    const [house, search] = [iconSvg('lucide:house'), iconSvg('lucide:search')]

    expect(await match([house, search, house])).toEqual(NAMES.concat('lucide:house'))
    expect(await match([search])).toEqual(['lucide:search'])
    expect(icons).toHaveBeenCalledTimes(1)
  })

  test('tries the index again after it fails, and reports once', async () => {
    const onError = mock()
    const index = mock(testIndex)
    index.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    const match = createMatcher({ index, icons: testIcons(), draw, onError })
    const house = iconSvg('lucide:house')

    expect(await match([house])).toEqual([null])
    expect(await match([house])).toEqual(['lucide:house'])
    expect(onError).toHaveBeenCalledTimes(1)
  })

  test('draws again after drawing failed', async () => {
    let failing = true
    const flaky: MatcherServices['draw'] = (...args) =>
      failing ? Promise.reject(new Error('context lost')) : draw(...args)
    const match = createMatcher({ index: testIndex, icons: testIcons(), draw: flaky })
    const house = iconSvg('lucide:house')

    expect(await match([house])).toEqual([null])
    failing = false
    expect(await match([house])).toEqual(['lucide:house'])
  })

  test('compares icons whose hashes are identical but which draw apart', async () => {
    const match = createMatcher({
      index: () => indexOf(['test:wide', 'test:narrow']),
      icons: testIcons(),
      draw
    })

    expect(await match([svgOf('test:narrow')])).toEqual(['test:narrow'])
  })

  test('answers from some of its icons for one call, and compares again on the next', async () => {
    const icons = testIcons()
    icons.mockImplementationOnce(async () => new Map([['lucide:house', iconSvg('lucide:house')]]))
    const match = createMatcher({
      index: () => indexOf(['lucide:house', 'test:house-dot']),
      icons,
      draw
    })
    const houseDot = svgOf('test:house-dot')

    expect(await match([houseDot])).toEqual(['lucide:house'])
    expect(await match([houseDot])).toEqual(['test:house-dot'])
  })

  test('reports an index loader that throws, and loads again', async () => {
    const onError = mock()
    let throwing = true
    const index = () => {
      if (throwing) throw new Error('no fetch')
      return testIndex()
    }
    const match = createMatcher({ index, icons: testIcons(), draw, onError })
    const house = iconSvg('lucide:house')

    expect(await match([house])).toEqual([null])
    throwing = false
    expect(await match([house])).toEqual(['lucide:house'])
    expect(onError).toHaveBeenCalledTimes(1)
  })

  test('does not keep a miss from comparing with only some of its icons', async () => {
    const icons = testIcons()
    icons.mockImplementationOnce(async () => new Map())
    const match = createMatcher({ index: testIndex, icons, draw })
    const house = iconSvg('lucide:house')

    expect(await match([house])).toEqual([null])
    expect(await match([house])).toEqual(['lucide:house'])
  })
})

describe('the index', () => {
  test('is served from the version published', async () => {
    const manifest = v.parse(
      v.pipe(v.string(), v.parseJson(), v.object({ version: v.string() })),
      await readFile(resolve(import.meta.dirname, '../package.json'), 'utf-8')
    )
    expect(VERSION).toBe(manifest.version)
    expect(INDEX_URL).toBe(`https://cdn.jsdelivr.net/npm/whaticon@${VERSION}/data`)
  })

  test('loads and ungzips both files', async () => {
    const files: Record<string, Uint8Array> = {
      'names.txt.gz': gzipSync('lucide:a\nlucide:b'),
      'hashes.bin.gz': gzipSync(Buffer.alloc(256))
    }
    const fetcher = mock(async (url: string | URL | Request) => {
      const file = (url instanceof Request ? url.url : url.toString()).slice(INDEX_URL.length + 1)
      const bytes = files[file]
      return bytes ? new Response(new Uint8Array(bytes)) : new Response('', { status: 404 })
    })
    const index = await fetchIndex(Object.assign(fetcher, { preconnect: fetch.preconnect }))

    expect(index.names).toEqual(['lucide:a', 'lucide:b'])
    expect(index.hashes).toHaveLength(256)
  })
})
