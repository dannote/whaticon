/**
 * Hashing and matching without Node or native dependencies, for hosts that rasterize SVG
 * themselves, such as a browser with a canvas or an app with its own renderer. The Node API in
 * `whaticon` rasterizes with sharp and calls into this module.
 */

export interface IconMatch {
  name: string
  similarity: number
}

export interface HashMatchOptions {
  /** Maximum results to return (default: 10) */
  limit?: number
  /** Minimum similarity threshold 0-1 (default: 0.8) */
  threshold?: number
  /** Icon sets to search (default: all indexed) */
  prefixes?: string[]
  /** Preferred icon sets, sorted first at equal similarity */
  prefer?: string[]
}

/** Icon index with precomputed hashes: one name per hash, `HASH_BYTES` each, in order. */
export interface IconIndex {
  names: string[]
  hashes: Uint8Array
}

/** The side of the square grid an icon is hashed on. */
export const DEFAULT_SIZE = 32

/** Bytes in one hash: one bit for each of the 32 by 32 comparisons. */
export const HASH_BYTES = 128

/** How much a preferred icon set's similarity counts up when results are sorted. */
const PREFERENCE_BONUS = 0.02

/**
 * The difference hash (dHash) of a grayscale image `size + 1` pixels wide and `size` tall, row by
 * row, one byte per pixel: a bit for each pixel darker than the one to its right. Rasterize the
 * SVG as the index was built: its shapes in black on white, fitted and centered in that box,
 * then converted to grayscale.
 */
export function dHashFromPixels(pixels: Uint8Array, size = DEFAULT_SIZE): Uint8Array {
  const rowWidth = size + 1
  if (pixels.length < rowWidth * size) {
    throw new Error(`Expected ${rowWidth * size} pixels, got ${pixels.length}`)
  }
  const hash = new Uint8Array((size * size) / 8)
  let byteIndex = 0
  let byte = 0
  let bitInByte = 0
  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowWidth
    for (let x = 0; x < size; x++) {
      if (pixels[rowOffset + x]! < pixels[rowOffset + x + 1]!) byte |= 128 >> bitInByte
      if (++bitInByte === 8) {
        hash[byteIndex++] = byte
        byte = 0
        bitInByte = 0
      }
    }
  }
  return hash
}

/** Bits that differ between `hash` and the hash at `offset` in `hashes`. */
export function hammingDistanceAt(hash: Uint8Array, hashes: Uint8Array, offset = 0): number {
  let distance = 0
  for (let i = 0; i < hash.length; i += 4) {
    let xor =
      ((hash[i]! ^ hashes[offset + i]!) |
        ((hash[i + 1]! ^ hashes[offset + i + 1]!) << 8) |
        ((hash[i + 2]! ^ hashes[offset + i + 2]!) << 16) |
        ((hash[i + 3]! ^ hashes[offset + i + 3]!) << 24)) >>>
      0
    // 32-bit popcount
    xor = xor - ((xor >>> 1) & 0x55555555)
    xor = (xor & 0x33333333) + ((xor >>> 2) & 0x33333333)
    xor = (xor + (xor >>> 4)) & 0x0f0f0f0f
    distance += Math.imul(xor, 0x01010101) >>> 24
  }
  return distance
}

/** An index from its two files once ungzipped: names one per line, and the hashes in order. */
export function parseIndex(names: string, hashes: Uint8Array): IconIndex {
  return { names: names.split('\n').filter(Boolean), hashes }
}

/** The indexed icons whose hashes are closest to `hash`, most similar first. */
export function findMatchesByHash(
  hash: Uint8Array,
  index: IconIndex,
  options: HashMatchOptions = {}
): IconMatch[] {
  const { limit = 10, threshold = 0.8, prefixes, prefer } = options
  const bits = hash.length * 8
  const prefixSet = prefixes?.length ? new Set(prefixes) : null
  const thresholdDist = Math.floor((1 - threshold) * bits)
  const matches: IconMatch[] = []
  for (let i = 0; i < index.names.length; i++) {
    const name = index.names[i]!
    if (prefixSet && !prefixSet.has(name.split(':')[0] ?? '')) continue
    const distance = hammingDistanceAt(hash, index.hashes, i * hash.length)
    if (distance > thresholdDist) continue
    const similarity = 1 - distance / bits
    if (similarity >= threshold) matches.push({ name, similarity })
  }
  const preferSet = prefer?.length ? new Set(prefer) : null
  const bonus = (match: IconMatch) =>
    preferSet?.has(match.name.split(':')[0] ?? '') ? PREFERENCE_BONUS : 0
  return matches
    .sort((a, b) => b.similarity + bonus(b) - (a.similarity + bonus(a)))
    .slice(0, limit)
}
