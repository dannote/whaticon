/**
 * Hashing and matching without Node or native dependencies, for hosts that rasterize SVG
 * themselves, such as a browser with a canvas or an app with its own renderer. The Node API in
 * `whaticon` rasterizes with sharp and calls into this module.
 */

export interface IconMatch {
  name: string
  similarity: number
  /** Other indexed icons whose hashes equal this one's, such as a set's copy of another's. */
  siblings?: string[]
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

/**
 * How the hashes in an index were made: a difference hash on a 32 by 32 grid, from an image 33
 * pixels wide and 32 tall of how much the icon's shapes cover each pixel, whatever their color.
 * The icon is drawn at the largest size that fits that box, centered. An index records the
 * scheme in its metadata, and one made another way does not match hashes made this way.
 */
export const HASH_SCHEME = 'dhash-32-coverage'

/** Whether an index's metadata says it was hashed as this version hashes. */
export function isCompatibleIndex(metadata: { scheme?: string }): boolean {
  return metadata.scheme === HASH_SCHEME
}

/** How much a preferred icon set's similarity counts up when results are sorted. */
const PREFERENCE_BONUS = 0.02

/**
 * The difference hash (dHash) of a grayscale image `size + 1` pixels wide and `size` tall, row by
 * row, one byte per pixel: a bit for each pixel darker than the one to its right. Rasterize the
 * SVG as `HASH_SCHEME` describes, each pixel `255 - alpha` of the icon drawn on transparency.
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
      if ((pixels[rowOffset + x] ?? 0) < (pixels[rowOffset + x + 1] ?? 0)) byte |= 128 >> bitInByte
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
      (((hash[i] ?? 0) ^ (hashes[offset + i] ?? 0)) |
        (((hash[i + 1] ?? 0) ^ (hashes[offset + i + 1] ?? 0)) << 8) |
        (((hash[i + 2] ?? 0) ^ (hashes[offset + i + 2] ?? 0)) << 16) |
        (((hash[i + 3] ?? 0) ^ (hashes[offset + i + 3] ?? 0)) << 24)) >>>
      0
    // 32-bit popcount
    xor = xor - ((xor >>> 1) & 0x55555555)
    xor = (xor & 0x33333333) + ((xor >>> 2) & 0x33333333)
    xor = (xor + (xor >>> 4)) & 0x0f0f0f0f
    distance += Math.imul(xor, 0x01010101) >>> 24
  }
  return distance
}

/**
 * An index from its two files once ungzipped: names one per line, and the hashes in order, one
 * for each name.
 */
export function parseIndex(names: string, hashes: Uint8Array): IconIndex {
  const index = { names: names.split('\n').filter(Boolean), hashes }
  if (hashes.length !== index.names.length * HASH_BYTES) {
    throw new Error(
      `Index holds ${hashes.length} hash bytes for ${index.names.length} names, expected ${index.names.length * HASH_BYTES}`
    )
  }
  return index
}

/** Whether the hashes at two positions in an index are the same. */
function sameHash(hashes: Uint8Array, a: number, b: number): boolean {
  for (let i = 0; i < HASH_BYTES; i++) {
    if (hashes[a * HASH_BYTES + i] !== hashes[b * HASH_BYTES + i]) return false
  }
  return true
}

/**
 * The indexed icons whose hashes are closest to `hash`, most similar first. Icons with identical
 * hashes, as icon sets that copy another's are, fold into one match with the rest as its
 * `siblings`, led by a preferred set's icon, so `limit` counts different icons.
 */
export function findMatchesByHash(
  hash: Uint8Array,
  index: IconIndex,
  options: HashMatchOptions = {}
): IconMatch[] {
  if (hash.length !== HASH_BYTES) {
    throw new Error(`Expected a ${HASH_BYTES}-byte hash, as indexes hold, got ${hash.length} bytes`)
  }
  const { limit = 10, threshold = 0.8, prefixes, prefer } = options
  const bits = HASH_BYTES * 8
  const prefixSet = prefixes?.length ? new Set(prefixes) : null
  const preferSet = prefer?.length ? new Set(prefer) : null
  const thresholdDist = Math.floor((1 - threshold) * bits)
  const prefixOf = (name: string) => name.split(':')[0] ?? ''
  const found: { position: number; similarity: number }[] = []
  for (let i = 0; i < index.names.length; i++) {
    if (prefixSet && !prefixSet.has(prefixOf(index.names[i] ?? ''))) continue
    const distance = hammingDistanceAt(hash, index.hashes, i * HASH_BYTES)
    if (distance > thresholdDist) continue
    const similarity = 1 - distance / bits
    if (similarity >= threshold) found.push({ position: i, similarity })
  }
  const bonus = (position: number) =>
    preferSet?.has(prefixOf(index.names[position] ?? '')) ? PREFERENCE_BONUS : 0
  found.sort((a, b) => b.similarity + bonus(b.position) - (a.similarity + bonus(a.position)))

  const matches: (IconMatch & { position: number })[] = []
  for (const { position, similarity } of found) {
    const same = matches.find((match) => sameHash(index.hashes, match.position, position))
    const name = index.names[position] ?? ''
    if (same) (same.siblings ??= []).push(name)
    else if (matches.length < limit) matches.push({ name, similarity, position })
  }
  return matches.map(({ position: _position, ...match }) => match)
}
