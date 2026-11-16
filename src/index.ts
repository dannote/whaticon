import sharp from 'sharp'
import { gunzipSync } from 'zlib'

import {
  DEFAULT_SIZE,
  HASH_BYTES,
  dHashFromPixels,
  findMatchesByHash,
  hammingDistanceAt,
  parseIndex,
  type HashMatchOptions,
  type IconIndex,
  type IconMatch
} from './hash.js'

export {
  HASH_SCHEME,
  dHashFromPixels,
  findMatchesByHash,
  isCompatibleIndex,
  parseIndex,
  type HashMatchOptions,
  type IconIndex,
  type IconMatch
} from './hash.js'

export interface MatchOptions extends HashMatchOptions {
  /** Image size for comparison (default: 32) */
  size?: number
}

/**
 * Convert SVG to grayscale pixel buffer for comparison
 */
import { parse, type ElementNode, type Node } from 'svg-parser'

const WHITE_COLORS = new Set(['white', '#fff', '#ffffff', 'rgb(255, 255, 255)', 'rgb(255,255,255)'])

type SvgNode = string | Node

function serializeNode(node: SvgNode): string {
  if (typeof node === 'string') return node
  if (node.type === 'text') return String(node.value ?? '')
  if (node.type !== 'element') return ''

  const el = node as ElementNode
  const attrs = Object.entries(el.properties ?? {})
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
  const children = (el.children ?? []).map(serializeNode).join('')
  const tag = el.tagName ?? 'g'

  return children
    ? `<${tag}${attrs ? ' ' + attrs : ''}>${children}</${tag}>`
    : `<${tag}${attrs ? ' ' + attrs : ''}/>`
}

function normalizeSvgColors(svg: string): string {
  const ast = parse(svg)

  function walk(node: SvgNode): void {
    if (typeof node === 'string' || node.type !== 'element') return
    const el = node as ElementNode
    const props = el.properties as Record<string, string> | undefined
    if (props) {
      if (props.fill && WHITE_COLORS.has(props.fill.toLowerCase())) props.fill = 'black'
      if (props.stroke && WHITE_COLORS.has(props.stroke.toLowerCase())) props.stroke = 'black'
    }
    el.children?.forEach(walk)
  }

  ast.children.forEach(walk)
  return ast.children.map(serializeNode).join('')
}

export async function svgToPixels(svg: string | Buffer, size = DEFAULT_SIZE): Promise<Buffer> {
  const svgStr = normalizeSvgColors(typeof svg === 'string' ? svg : svg.toString('utf-8'))
  const input = Buffer.from(svgStr)

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
 * Compute dHash (difference hash) for an image
 * Returns a Buffer of 128 bytes (1024 bits)
 */
export async function computeDHash(svg: string | Buffer, size = DEFAULT_SIZE): Promise<Buffer> {
  const svgStr = normalizeSvgColors(typeof svg === 'string' ? svg : svg.toString('utf-8'))
  const input = Buffer.from(svgStr)

  const data = await sharp(input)
    .flatten({ background: '#ffffff' })
    .resize(size + 1, size, { fit: 'contain', background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer()

  return Buffer.from(dHashFromPixels(data, size))
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
  const { size = DEFAULT_SIZE, ...matching } = options
  return findMatchesByHash(await computeDHash(svg, size), index, matching)
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
