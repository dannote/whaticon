import sharp from 'sharp'
import { gunzipSync } from 'zlib'

export interface IconMatch {
  name: string
  similarity: number
}

export interface MatchOptions {
  /** Image size for comparison (default: 32) */
  size?: number
  /** Maximum results to return (default: 10) */
  limit?: number
  /** Minimum similarity threshold 0-1 (default: 0.8) */
  threshold?: number
  /** Icon sets to search (default: all indexed) */
  prefixes?: string[]
  /** Preferred icon sets, sorted first at equal similarity */
  prefer?: string[]
}

const DEFAULT_SIZE = 32
const HASH_BYTES = 128 // 1024 bits = 128 bytes

/**
 * Convert SVG to grayscale pixel buffer for comparison
 */
export async function svgToPixels(svg: string | Buffer, size = DEFAULT_SIZE): Promise<Buffer> {
  const input = typeof svg === 'string' ? Buffer.from(svg) : svg

  const { data } = await sharp(input)
    .flatten({ background: '#ffffff' })
    .resize(size, size, { fit: 'contain', background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return data
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
 * Compute dHash from grayscale pixel data (width must be size+1, height must be size)
 */
function computeHashFromPixels(data: Buffer, size: number, rowWidth: number): Buffer {
  const hash = Buffer.alloc(HASH_BYTES)
  let byteIndex = 0
  let byte = 0
  let bitInByte = 0

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowWidth
    for (let x = 0; x < size; x++) {
      if (data[rowOffset + x]! < data[rowOffset + x + 1]!) {
        byte |= 128 >> bitInByte
      }
      if (++bitInByte === 8) {
        hash[byteIndex++] = byte
        byte = 0
        bitInByte = 0
      }
    }
  }

  return hash
}

/**
 * Compute dHash (difference hash) for an image
 * Returns a Buffer of 128 bytes (1024 bits)
 */
export async function computeDHash(svg: string | Buffer, size = DEFAULT_SIZE): Promise<Buffer> {
  const input = typeof svg === 'string' ? Buffer.from(svg) : svg

  const data = await sharp(input)
    .flatten({ background: '#ffffff' })
    .resize(size + 1, size, { fit: 'contain', background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer()

  return computeHashFromPixels(data, size, size + 1)
}

/**
 * Calculate Hamming distance between two hash buffers using 32-bit popcount
 */
export function hammingDistance(h1: Buffer, h2: Buffer): number {
  if (h1.length !== h2.length) {
    throw new Error(`Hash length mismatch: ${h1.length} vs ${h2.length}`)
  }

  let distance = 0
  for (let i = 0; i < h1.length; i += 4) {
    let xor =
      ((h1[i]! ^ h2[i]!) |
        ((h1[i + 1]! ^ h2[i + 1]!) << 8) |
        ((h1[i + 2]! ^ h2[i + 2]!) << 16) |
        ((h1[i + 3]! ^ h2[i + 3]!) << 24)) >>>
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
 * Convert Hamming distance to similarity score (0-1)
 */
export function hashSimilarity(h1: Buffer, h2: Buffer): number {
  const distance = hammingDistance(h1, h2)
  const totalBits = h1.length * 8
  return 1 - distance / totalBits
}

/**
 * Fast Hamming distance against indexed hash (avoids Buffer allocation)
 */
function hammingDistanceAtOffset(h1: Buffer, indexHashes: Buffer, offset: number): number {
  let distance = 0
  for (let i = 0; i < HASH_BYTES; i += 4) {
    let xor =
      ((h1[i]! ^ indexHashes[offset + i]!) |
        ((h1[i + 1]! ^ indexHashes[offset + i + 1]!) << 8) |
        ((h1[i + 2]! ^ indexHashes[offset + i + 2]!) << 16) |
        ((h1[i + 3]! ^ indexHashes[offset + i + 3]!) << 24)) >>>
      0
    xor = xor - ((xor >>> 1) & 0x55555555)
    xor = (xor & 0x33333333) + ((xor >>> 2) & 0x33333333)
    xor = (xor + (xor >>> 4)) & 0x0f0f0f0f
    distance += Math.imul(xor, 0x01010101) >>> 24
  }
  return distance
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
 * Icon index with precomputed hashes (binary format)
 */
export interface IconIndex {
  names: string[]
  hashes: Buffer
}

/**
 * Load index from binary files (gzipped)
 */
export function loadIndex(namesGz: Buffer, hashesGz: Buffer): IconIndex {
  const namesStr = gunzipSync(namesGz).toString('utf-8')
  const names = namesStr.split('\n').filter(Boolean)
  const hashes = gunzipSync(hashesGz)
  return { names, hashes }
}

/**
 * Find matching icons from Iconify by visual similarity
 */
export async function findMatches(
  svg: string | Buffer,
  index: IconIndex,
  options: MatchOptions = {}
): Promise<IconMatch[]> {
  const { size = DEFAULT_SIZE, limit = 10, threshold = 0.8, prefixes, prefer } = options

  const inputHash = await computeDHash(svg, size)

  const prefixSet = prefixes?.length ? new Set(prefixes) : null
  const matches: IconMatch[] = []

  const thresholdDist = Math.floor((1 - threshold) * HASH_BYTES * 8)

  for (let i = 0; i < index.names.length; i++) {
    const name = index.names[i]!

    if (prefixSet) {
      const prefix = name.split(':')[0]
      if (!prefix || !prefixSet.has(prefix)) continue
    }

    const dist = hammingDistanceAtOffset(inputHash, index.hashes, i * HASH_BYTES)
    if (dist > thresholdDist) continue

    const similarity = 1 - dist / (HASH_BYTES * 8)

    if (similarity >= threshold) {
      matches.push({ name, similarity })
    }
  }

  const preferSet = prefer?.length ? new Set(prefer) : null
  return matches
    .sort((a, b) => {
      const simDiff = b.similarity - a.similarity
      if (Math.abs(simDiff) > 0.001) return simDiff

      if (preferSet) {
        const aPrefix = a.name.split(':')[0] ?? ''
        const bPrefix = b.name.split(':')[0] ?? ''
        const aPreferred = preferSet.has(aPrefix)
        const bPreferred = preferSet.has(bPrefix)
        if (aPreferred && !bPreferred) return -1
        if (bPreferred && !aPreferred) return 1
      }

      return 0
    })
    .slice(0, limit)
}

interface IconInput {
  name: string
  svg: string
}

const SPRITE_COLS = 50

/**
 * Create a sprite sheet SVG from multiple icons
 */
function createSpriteSheet(icons: IconInput[], cols: number, iconSize: number): string {
  const rows = Math.ceil(icons.length / cols)
  let inner = ''

  for (let i = 0; i < icons.length; i++) {
    const x = (i % cols) * iconSize
    const y = Math.floor(i / cols) * (iconSize - 1) // height is size-1 = 32

    // Extract viewBox and content from SVG
    const svg = icons[i]!.svg
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/)
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24'
    const [, , vbW, vbH] = viewBox!.split(/\s+/).map(Number)

    // Extract inner content (everything between <svg> and </svg>)
    const content = svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '')

    // Scale to fit icon cell
    const scale = Math.min(iconSize / (vbW || 24), (iconSize - 1) / (vbH || 24))
    inner += `<g transform="translate(${x},${y}) scale(${scale})">${content}</g>`
  }

  const width = cols * iconSize
  const height = rows * (iconSize - 1)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#fff">${inner}</svg>`
}

/**
 * Extract dHash for each icon from a rendered sprite sheet
 */
function extractHashesFromSprite(
  data: Buffer,
  spriteWidth: number,
  count: number,
  cols: number,
  iconWidth: number,
  iconHeight: number
): Buffer[] {
  const hashes: Buffer[] = []

  for (let i = 0; i < count; i++) {
    const startX = (i % cols) * iconWidth
    const startY = Math.floor(i / cols) * iconHeight

    const hash = Buffer.alloc(HASH_BYTES)
    let byteIndex = 0
    let byte = 0
    let bitInByte = 0

    for (let y = 0; y < iconHeight; y++) {
      const rowStart = (startY + y) * spriteWidth + startX
      for (let x = 0; x < iconHeight; x++) {
        // Compare adjacent pixels (iconHeight because we need 32 comparisons)
        if (data[rowStart + x]! < data[rowStart + x + 1]!) {
          byte |= 128 >> bitInByte
        }
        if (++bitInByte === 8) {
          hash[byteIndex++] = byte
          byte = 0
          bitInByte = 0
        }
      }
    }

    hashes.push(hash)
  }

  return hashes
}

/**
 * Build index for a set of icons using sprite sheet batching (fast)
 * Returns buffers ready to be gzipped and saved
 */
export async function buildIndex(
  icons: IconInput[],
  size = DEFAULT_SIZE,
  onProgress?: (current: number, total: number) => void
): Promise<{ names: string; hashes: Buffer }> {
  const names: string[] = []
  const hashBuffers: Buffer[] = []

  const batchSize = SPRITE_COLS * 20 // 1000 icons per sprite
  const iconWidth = size + 1
  const iconHeight = size

  for (let i = 0; i < icons.length; i += batchSize) {
    const batch = icons.slice(i, i + batchSize)

    try {
      // Create sprite sheet
      const sprite = createSpriteSheet(batch, SPRITE_COLS, iconWidth)

      // Render sprite sheet
      const spriteWidth = SPRITE_COLS * iconWidth
      const rows = Math.ceil(batch.length / SPRITE_COLS)
      const spriteHeight = rows * iconHeight

      const data = await sharp(Buffer.from(sprite))
        .flatten({ background: '#ffffff' })
        .resize(spriteWidth, spriteHeight, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer()

      // Extract hashes
      const batchHashes = extractHashesFromSprite(
        data,
        spriteWidth,
        batch.length,
        SPRITE_COLS,
        iconWidth,
        iconHeight
      )

      for (let j = 0; j < batch.length; j++) {
        names.push(batch[j]!.name)
        hashBuffers.push(batchHashes[j]!)
      }
    } catch {
      // Fallback to one-by-one for failed batches
      for (const icon of batch) {
        try {
          const hash = await computeDHash(icon.svg, size)
          names.push(icon.name)
          hashBuffers.push(hash)
        } catch {
          // Skip failed icons
        }
      }
    }

    onProgress?.(Math.min(i + batchSize, icons.length), icons.length)
  }

  return {
    names: names.join('\n'),
    hashes: Buffer.concat(hashBuffers)
  }
}
