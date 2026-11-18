import { gunzipSync } from 'node:zlib'

import {
  DEFAULT_SIZE,
  dHashFromPixels,
  findMatchesByHash,
  hammingDistanceAt,
  parseIndex,
  type HashMatchOptions,
  type IconIndex,
  type IconMatch
} from './hash.js'
import { COMPARED_SIZE, SIBLINGS_COMPARED, coverageSimilarity } from './match.js'

import type { Sharp, SharpOptions } from 'sharp'

export {
  DEFAULT_SIZE,
  HASH_SCHEME,
  dHashFromPixels,
  findMatchesByHash,
  isCompatibleIndex,
  parseIndex,
  type HashMatchOptions,
  type IconIndex,
  type IconMatch
} from './hash.js'

export {
  COMPARED_SIZE,
  NAMED_AT,
  SHORTLIST,
  SIBLINGS_COMPARED,
  coverageFromRGBA,
  coverageSimilarity,
  createMatcher,
  fetchIndex,
  type Matcher,
  type MatcherServices,
  type RGBAImage
} from './match.js'

/** Indexes hold hashes of `DEFAULT_SIZE`, so a query is always hashed at that size. */
export type MatchOptions = HashMatchOptions

type SharpFactory = (input: Buffer, options?: SharpOptions) => Sharp

let sharpModule: Promise<SharpFactory> | undefined

/**
 * sharp, which renders SVG here. It is an optional peer dependency, so hosts that rasterize
 * themselves and use only `whaticon/hash` do not install it.
 */
function loadSharp(): Promise<SharpFactory> {
  sharpModule ??= import('sharp').then(
    (module) => module.default,
    (error: unknown) => {
      sharpModule = undefined
      throw new Error('whaticon renders SVG with sharp; install it: npm install sharp', {
        cause: error
      })
    }
  )
  return sharpModule
}

/**
 * An icon drawn in a `width` by `height` box as darkness on white: how much of each pixel its
 * shapes cover, whatever their color, so an icon drawn in white or in a brand color hashes as the
 * same icon drawn in black. The SVG is rasterized at the size it is fitted to, not resampled from
 * its own size, and centered as `HASH_SCHEME` describes.
 */
async function coverage(svg: string | Buffer, width: number, height: number): Promise<Buffer> {
  const sharp = await loadSharp()
  const input = typeof svg === 'string' ? Buffer.from(svg) : svg
  const own = await sharp(input).metadata()
  const scale = Math.min(width / (own.width || width), height / (own.height || height))
  // sharp takes 1 to 100000 dpi; an SVG too large to draw that small is drawn at 1 and resized.
  return sharp(input, { density: Math.min(Math.max(72 * scale, 1), 100_000) })
    .ensureAlpha()
    .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extractChannel('alpha')
    .negate()
    .raw()
    .toBuffer()
}

/** An SVG's coverage as a `size` by `size` grayscale image, one byte per pixel. */
export function svgToPixels(svg: string | Buffer, size = DEFAULT_SIZE): Promise<Buffer> {
  return coverage(svg, size, size)
}

/**
 * Calculate similarity between two pixel buffers (0-1, higher = more similar)
 */
export function pixelSimilarity(px1: Buffer, px2: Buffer): number {
  if (px1.length !== px2.length) {
    throw new Error(`Buffer length mismatch: ${px1.length} vs ${px2.length}`)
  }

  let diff = 0
  for (let i = 0; i < px1.length; i++) {
    diff += Math.abs((px1[i] ?? 0) - (px2[i] ?? 0))
  }

  return 1 - diff / (px1.length * 255)
}

/**
 * Compute dHash (difference hash) for an image
 * Returns a Buffer of 128 bytes (1024 bits)
 */
export async function computeDHash(svg: string | Buffer, size = DEFAULT_SIZE): Promise<Buffer> {
  return Buffer.from(dHashFromPixels(await coverage(svg, size + 1, size), size))
}

/**
 * Calculate Hamming distance between two hash buffers using 32-bit popcount
 */
export function hammingDistance(h1: Buffer, h2: Buffer): number {
  if (h1.length !== h2.length) {
    throw new Error(`Hash length mismatch: ${h1.length} vs ${h2.length}`)
  }
  return hammingDistanceAt(h1, h2)
}

/**
 * Convert Hamming distance to similarity score (0-1)
 */
export function hashSimilarity(h1: Buffer, h2: Buffer): number {
  const distance = hammingDistance(h1, h2)
  const totalBits = h1.length * 8
  return 1 - distance / totalBits
}

/**
 * Fetch icon SVG from Iconify API
 */
export async function fetchIconSvg(name: string): Promise<string> {
  const [prefix, icon] = name.split(':')
  if (!prefix || !icon) {
    throw new Error(`Invalid icon name: ${name}. Expected format: prefix:icon`)
  }

  const res = await fetch(`https://api.iconify.design/${prefix}/${icon}.svg`)
  if (!res.ok) {
    throw new Error(`Failed to fetch icon ${name}: ${res.status}`)
  }

  return res.text()
}

/**
 * `matches` scored by how alike each icon draws to `svg`, most alike first, as `whaticon/match`
 * names icons: both drawn with sharp in a `COMPARED_SIZE` square and compared by
 * `coverageSimilarity`, whose `NAMED_AT` tells an icon from a lookalike. A match whose same-hash
 * siblings draw differently takes the name of whichever of them draws most alike. `iconSvg` gives
 * each icon's SVG, by default from the Iconify API; icons it fails for, or that do not draw, are
 * left out.
 */
export async function compareMatches(
  svg: string | Buffer,
  matches: readonly IconMatch[],
  iconSvg: (name: string) => Promise<string> = fetchIconSvg
): Promise<IconMatch[]> {
  const own = await svgToPixels(svg, COMPARED_SIZE)
  const similarity = async (name: string): Promise<number | null> => {
    try {
      return coverageSimilarity(own, await svgToPixels(await iconSvg(name), COMPARED_SIZE))
    } catch {
      return null
    }
  }
  const scored = await Promise.all(
    matches.map(async (match) => {
      const names = [match.name, ...(match.siblings ?? []).slice(0, SIBLINGS_COMPARED)]
      const scores = await Promise.all(names.map(similarity))
      let best: IconMatch | null = null
      for (const [i, name] of names.entries()) {
        const score = scores[i]
        if (score == null || (best && best.similarity >= score)) continue
        const siblings = names.filter((other) => other !== name)
        best =
          siblings.length > 0 ? { name, similarity: score, siblings } : { name, similarity: score }
      }
      return best
    })
  )
  return scored
    .filter((match): match is IconMatch => match !== null)
    .sort((a, b) => b.similarity - a.similarity)
}

/**
 * Load index from binary files (gzipped)
 */
export function loadIndex(namesGz: Buffer, hashesGz: Buffer): IconIndex {
  return parseIndex(gunzipSync(namesGz).toString('utf-8'), gunzipSync(hashesGz))
}

/**
 * Find matching icons from Iconify by visual similarity
 */
export async function findMatches(
  svg: string | Buffer,
  index: IconIndex,
  options: MatchOptions = {}
): Promise<IconMatch[]> {
  return findMatchesByHash(await computeDHash(svg), index, options)
}

/** An icon to index: its SVG body and the viewBox it is drawn in, as Iconify's `iconToSVG` gives them. */
export interface IconInput {
  name: string
  body: string
  viewBox: readonly [left: number, top: number, width: number, height: number]
}

/** Icons hashed at once while an index builds. */
const CONCURRENCY = 32

/**
 * Hash a set of icons for an index, each as `computeDHash` hashes a query. Icons that do not
 * render are left out and listed in `skipped`. Returns names and hashes ready to be gzipped and
 * saved.
 */
export async function buildIndex(
  icons: IconInput[],
  onProgress?: (current: number, total: number) => void
): Promise<{ names: string; hashes: Buffer; skipped: string[] }> {
  // Without sharp no icon renders; that fails the build rather than skipping every icon.
  if (icons.length > 0) await loadSharp()
  const names: string[] = []
  const hashes: Buffer[] = []
  const skipped: string[] = []
  for (let i = 0; i < icons.length; i += CONCURRENCY) {
    const batch = icons.slice(i, i + CONCURRENCY)
    const batchHashes = await Promise.all(
      batch.map(({ body, viewBox }) =>
        computeDHash(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}">${body}</svg>`
        ).catch(() => undefined)
      )
    )
    batch.forEach((icon, j) => {
      const hash = batchHashes[j]
      if (hash) {
        names.push(icon.name)
        hashes.push(hash)
      } else {
        skipped.push(icon.name)
      }
    })
    onProgress?.(Math.min(i + CONCURRENCY, icons.length), icons.length)
  }
  return { names: names.join('\n'), hashes: Buffer.concat(hashes), skipped }
}
