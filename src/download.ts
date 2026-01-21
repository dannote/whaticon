import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { finished } from 'stream/promises'

const GITHUB_REPO = 'dannote/whaticon'
const INDEX_VERSION = '1' // Bump when index format changes
const CACHE_DIR = join(homedir(), '.cache', 'whaticon', `v${INDEX_VERSION}`)

export type IndexVariant = 'core' | 'popular' | 'full'

interface IndexManifest {
  version: string
  variants: Record<string, { icons: number; sizeBytes: number }>
}

function getVariantDir(variant: IndexVariant): string {
  return join(CACHE_DIR, variant)
}

function getIndexPaths(variant: IndexVariant): { names: string; hashes: string; metadata: string } {
  const dir = getVariantDir(variant)
  return {
    names: join(dir, 'names.txt.gz'),
    hashes: join(dir, 'hashes.bin.gz'),
    metadata: join(dir, 'metadata.json')
  }
}

export function isIndexDownloaded(variant: IndexVariant): boolean {
  const paths = getIndexPaths(variant)
  return existsSync(paths.names) && existsSync(paths.hashes)
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`)
  }

  const dir = join(destPath, '..')
  mkdirSync(dir, { recursive: true })

  const fileStream = createWriteStream(destPath)
  await finished(Readable.fromWeb(res.body as any).pipe(fileStream))
}

async function getLatestIndexTag(): Promise<string> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch releases: ${res.status}`)
  }

  const releases = (await res.json()) as Array<{ tag_name: string }>
  const indexRelease = releases.find((r) => r.tag_name.startsWith('index-v'))
  if (!indexRelease) {
    throw new Error('No index release found')
  }

  return indexRelease.tag_name
}

export async function downloadIndex(
  variant: IndexVariant,
  onProgress?: (message: string) => void
): Promise<void> {
  const log = onProgress || console.log

  log(`Finding latest index release...`)
  const tag = await getLatestIndexTag()
  log(`Latest: ${tag}`)

  const baseUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}`
  const paths = getIndexPaths(variant)

  log(`Downloading ${variant} index...`)

  log(`  ${variant}-names.txt.gz`)
  await downloadFile(`${baseUrl}/${variant}-names.txt.gz`, paths.names)

  log(`  ${variant}-hashes.bin.gz`)
  await downloadFile(`${baseUrl}/${variant}-hashes.bin.gz`, paths.hashes)

  log(`  ${variant}-metadata.json`)
  await downloadFile(`${baseUrl}/${variant}-metadata.json`, paths.metadata)

  // Verify
  const metadata = JSON.parse(readFileSync(paths.metadata, 'utf-8'))
  log(`Downloaded ${metadata.icons} icons from ${metadata.prefixes.length} sets`)
}

export function loadCachedIndex(
  variant: IndexVariant
): { namesGz: Buffer; hashesGz: Buffer } | null {
  if (!isIndexDownloaded(variant)) {
    return null
  }

  const paths = getIndexPaths(variant)
  return {
    namesGz: readFileSync(paths.names),
    hashesGz: readFileSync(paths.hashes)
  }
}

export async function ensureIndex(
  variant: IndexVariant,
  onProgress?: (message: string) => void
): Promise<{ namesGz: Buffer; hashesGz: Buffer }> {
  const cached = loadCachedIndex(variant)
  if (cached) {
    return cached
  }

  await downloadIndex(variant, onProgress)

  const result = loadCachedIndex(variant)
  if (!result) {
    throw new Error('Failed to load index after download')
  }

  return result
}

export function getCacheDir(): string {
  return CACHE_DIR
}

export function clearCache(): void {
  const { rmSync } = require('fs')
  if (existsSync(CACHE_DIR)) {
    rmSync(CACHE_DIR, { recursive: true })
  }
}
