/**
 * Naming icons by how they draw, without Node or native dependencies, for hosts that draw SVG
 * themselves. A hash only shortlists: its similarity cannot tell an icon from a shape that merely
 * resembles one. The host draws the SVG and the shortlisted icons, and the icon that draws most
 * alike names it when it is alike enough.
 */
import {
  DEFAULT_SIZE,
  dHashFromPixels,
  findMatchesByHash,
  parseIndex,
  type IconIndex
} from './hash.js'
import { VERSION } from './version.js'

/** Unpremultiplied RGBA pixels, row by row, four bytes each. */
export interface RGBAImage {
  width: number
  height: number
  data: Uint8Array
}

/** The icons the hash shortlists for drawing. */
export const SHORTLIST = { limit: 10, threshold: 0.6 }

/** How many of a shortlisted icon's same-hash siblings are drawn and compared beside it. */
export const SIBLINGS_COMPARED = 3

/** The side of the square an SVG and the icons it is compared with are drawn in. */
export const COMPARED_SIZE = 64

/**
 * How alike, by `coverageSimilarity`, an SVG and an icon must draw to name it. Measured with
 * OpenPencil's renderer on 600 icons from six sets as pages carry them (20 px, coordinates
 * rounded), 300 random shapes, and 200 icons with one part swapped for a square: 507 icons are
 * named, 495 by their own name and the rest by a lookalike's, such as a set's solid arrow for
 * its outline one; no shape is; and the 4 changed icons named are duotone icons whose tinted part
 * was swapped, named as their outline.
 */
export const NAMED_AT = 0.9

/**
 * How much an image's shapes cover each pixel of a `width` by `height` box, as darkness on white
 * (255 minus alpha), the image centered in the box, as `HASH_SCHEME` draws: what is hashed and
 * compared, whatever the shapes' color. An image larger than the box is cut to its middle.
 */
export function coverageFromRGBA(image: RGBAImage, width: number, height: number): Uint8Array {
  const grid = new Uint8Array(width * height).fill(255)
  const left = Math.floor((width - image.width) / 2)
  const top = Math.floor((height - image.height) / 2)
  for (let y = Math.max(0, -top); y < Math.min(image.height, height - top); y++) {
    for (let x = Math.max(0, -left); x < Math.min(image.width, width - left); x++) {
      grid[(top + y) * width + left + x] = 255 - (image.data[(y * image.width + x) * 4 + 3] ?? 0)
    }
  }
  return grid
}

/**
 * How alike two coverage grids of one size draw, from 0 to 1: their difference against the ink
 * either has, so the white around two icons does not make them alike, and a shape that differs
 * in one part counts as much in a small icon as in a large one.
 */
export function coverageSimilarity(a: Uint8Array, b: Uint8Array): number {
  let difference = 0
  let ink = 0
  for (let i = 0; i < a.length; i++) {
    const [left, right] = [a[i] ?? 255, b[i] ?? 255]
    difference += Math.abs(left - right)
    ink += 255 - Math.min(left, right)
  }
  return ink === 0 ? 1 : 1 - difference / ink
}

/**
 * Where this version's index of the popular Iconify sets is served: the npm package's own `data/`
 * on jsDelivr, which answers any page, so the index is always hashed as this version hashes.
 */
export const INDEX_URL = `https://cdn.jsdelivr.net/npm/whaticon@${VERSION}/data`

async function fetchGunzipped(fetcher: typeof globalThis.fetch, file: string): Promise<Uint8Array> {
  const response = await fetcher(`${INDEX_URL}/${file}`)
  if (!response.ok || !response.body) {
    throw new Error(`whaticon's index answered ${response.status} for ${file}`)
  }
  const unzipped = response.body.pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(unzipped).arrayBuffer())
}

/** This version's index of the popular Iconify sets, about 60,000 icons and 1.9 MB to download. */
export async function fetchIndex(
  fetcher: typeof globalThis.fetch = globalThis.fetch
): Promise<IconIndex> {
  const [names, hashes] = await Promise.all([
    fetchGunzipped(fetcher, 'names.txt.gz'),
    fetchGunzipped(fetcher, 'hashes.bin.gz')
  ])
  return parseIndex(new TextDecoder().decode(names), hashes)
}

/** What a matcher draws and loads with. */
export interface MatcherServices {
  /**
   * The index of icons to name, loaded on first use, such as `fetchIndex`. Calls made while it
   * loads share the load, so it must not wait on the matcher it serves.
   */
  index: () => Promise<IconIndex>
  /**
   * The SVG drawn at the largest size that fits `width` by `height`, on transparency; its alpha
   * is what counts. Null when it has nothing to draw. Throws when drawing fails, which the next
   * call tries again.
   */
  draw: (svg: string, width: number, height: number) => Promise<RGBAImage | null>
  /** Each named icon's SVG; names left out have none. Throws when they cannot be loaded. */
  icons: (names: readonly string[]) => Promise<ReadonlyMap<string, string>>
  /** Told, once, why icons went unnamed, such as an index that did not load. */
  onError?: (reason: string, error: unknown) => void
}

/**
 * The icon each SVG draws, as `prefix:name`, or null where it draws none closely enough. SVGs
 * passed together are compared with the icons they shortlist after loading those icons at once.
 */
export type Matcher = (svgs: readonly string[]) => Promise<(string | null)[]>

/** An SVG drawn to be compared, and the icons its hash shortlists. */
interface Shortlisted {
  drawing: Uint8Array
  names: string[]
}

/** An SVG's answer, and whether every shortlisted icon was compared to reach it. */
interface Answer {
  name: string | null
  complete: boolean
}

/**
 * Names the icons SVG draws: the hash of the SVG as the host draws it shortlists icons, and the
 * one that draws most alike, if alike enough, names it. Answers, drawings, and the index are kept,
 * so SVG repeated across calls is compared once. What could not be loaded or drawn leaves its SVG
 * unnamed and is tried again by the next call, and an answer from comparing with only some of its
 * icons is used for that call but not kept.
 */
export function createMatcher(services: MatcherServices): Matcher {
  let index: Promise<IconIndex> | undefined
  let reported = false
  const answers = new Map<string, string | null>()
  const drawn = new Map<string, Promise<Uint8Array | null | undefined>>()

  function report(reason: string, error: unknown): void {
    if (reported) return
    reported = true
    services.onError?.(reason, error)
  }

  async function loadIndex(): Promise<IconIndex | null> {
    // Stored before the loader runs, so a call it starts shares this load, and a loader that
    // throws rejects it like one that rejects.
    const loading = (index ??= Promise.resolve().then(() => services.index()))
    try {
      return await loading
    } catch (error) {
      // Only this load is forgotten; a retry already started stays.
      if (index === loading) index = undefined
      report('the index did not load', error)
      return null
    }
  }

  /** An SVG as coverage: null when it draws nothing, undefined when drawing it failed. */
  async function coverage(
    svg: string,
    width: number,
    height: number
  ): Promise<Uint8Array | null | undefined> {
    try {
      const image = await services.draw(svg, width, height)
      return image && coverageFromRGBA(image, width, height)
    } catch (error) {
      report('an SVG could not be drawn to compare', error)
      return undefined
    }
  }

  /** The SVG's shortlist: null when no icon comes close, undefined when it could not be drawn. */
  async function shortlist(svg: string, icons: IconIndex): Promise<Shortlisted | null | undefined> {
    const grid = await coverage(svg, DEFAULT_SIZE + 1, DEFAULT_SIZE)
    if (!grid) return grid
    // Icons with identical hashes can still draw apart: a difference hash records only the edges
    // that darken to the right, so each is compared, up to SIBLINGS_COMPARED.
    const names = findMatchesByHash(dHashFromPixels(grid), icons, SHORTLIST).flatMap((match) => [
      match.name,
      ...(match.siblings ?? []).slice(0, SIBLINGS_COMPARED)
    ])
    if (names.length === 0) return null
    const drawing = await coverage(svg, COMPARED_SIZE, COMPARED_SIZE)
    return drawing && { drawing, names }
  }

  function drawnIcon(name: string, svg: string): Promise<Uint8Array | null | undefined> {
    const known = drawn.get(name)
    if (known) return known
    // A drawing that failed is forgotten, so the next call draws it again.
    const drawing = coverage(svg, COMPARED_SIZE, COMPARED_SIZE).then((result) => {
      if (result === undefined) drawn.delete(name)
      return result
    })
    drawn.set(name, drawing)
    return drawing
  }

  async function closest(
    { drawing, names }: Shortlisted,
    svgs: ReadonlyMap<string, string>
  ): Promise<Answer> {
    let best: { name: string; similarity: number } | null = null
    let complete = true
    for (const name of names) {
      const svg = svgs.get(name)
      const candidate = svg ? await drawnIcon(name, svg) : undefined
      if (candidate === undefined) complete = false
      if (!candidate) continue
      const similarity = coverageSimilarity(drawing, candidate)
      if (!best || similarity > best.similarity) best = { name, similarity }
    }
    return { name: best && best.similarity >= NAMED_AT ? best.name : null, complete }
  }

  async function iconsOf(names: readonly string[]): Promise<ReadonlyMap<string, string> | null> {
    if (names.length === 0) return new Map()
    try {
      return await services.icons(names)
    } catch (error) {
      report('the icons to compare with did not load', error)
      return null
    }
  }

  async function answer(
    listed: Shortlisted | null | undefined,
    svgs: ReadonlyMap<string, string>
  ): Promise<Answer> {
    if (listed === undefined) return { name: null, complete: false }
    return listed ? closest(listed, svgs) : { name: null, complete: true }
  }

  return async (svgs) => {
    const unknown = [...new Set(svgs.filter((svg) => !answers.has(svg)))]
    const icons = unknown.length > 0 ? await loadIndex() : null
    if (icons) {
      const shortlists = await Promise.all(unknown.map((svg) => shortlist(svg, icons)))
      const candidates = await iconsOf([
        ...new Set(shortlists.flatMap((listed) => listed?.names ?? []))
      ])
      if (candidates) {
        const results = await Promise.all(shortlists.map((listed) => answer(listed, candidates)))
        // Only a comparison with every icon is kept; a partial one names its SVG for this call
        // and is compared again by the next, when a better icon may have loaded.
        const partial = new Map<string, string | null>()
        unknown.forEach((svg, i) => {
          const { name, complete } = results[i] ?? { name: null, complete: false }
          if (complete) answers.set(svg, name)
          else partial.set(svg, name)
        })
        return svgs.map((svg) => answers.get(svg) ?? partial.get(svg) ?? null)
      }
    }
    return svgs.map((svg) => answers.get(svg) ?? null)
  }
}
