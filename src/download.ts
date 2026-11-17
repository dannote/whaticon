import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as v from 'valibot'

import { HASH_SCHEME, isCompatibleIndex } from './hash.js'

const GITHUB_REPO = 'open-pencil/whaticon'

export type IndexVariant = 'core' | 'popular' | 'full'

const MetadataSchema = v.object({
  scheme: v.optional(v.string()),
  icons: v.number(),
  prefixes: v.array(v.string())
})

const ReleasesSchema = v.array(v.object({ tag_name: v.string() }))

/** Where downloaded indexes are kept: `$XDG_CACHE_HOME/whaticon`, or `~/.cache/whaticon`. */
export function getCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'whaticon')
}

function getIndexPaths(variant: IndexVariant): { names: string; hashes: string; metadata: string } {
  const dir = join(getCacheDir(), variant)
  return {
    names: join(dir, 'names.txt.gz'),
    hashes: join(dir, 'hashes.bin.gz'),
    metadata: join(dir, 'metadata.json')
  }
}

function readMetadata(path: string): v.InferOutput<typeof MetadataSchema> | undefined {
  if (!existsSync(path)) return undefined
  const result = v.safeParse(
    v.pipe(v.string(), v.parseJson(), MetadataSchema),
    readFileSync(path, 'utf-8')
  )
  return result.success ? result.output : undefined
}

/** Whether the variant is cached, hashed as this version hashes. */
export function isIndexDownloaded(variant: IndexVariant): boolean {
  const paths = getIndexPaths(variant)
  const metadata = readMetadata(paths.metadata)
  return (
    metadata !== undefined &&
    isCompatibleIndex(metadata) &&
    existsSync(paths.names) &&
    existsSync(paths.hashes)
  )
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`)
  return res
}

async function getLatestIndexTag(): Promise<string> {
  const res = await fetchOk(`https://api.github.com/repos/${GITHUB_REPO}/releases`)
  const releases = v.parse(ReleasesSchema, await res.json())
  const indexRelease = releases.find((r) => r.tag_name.startsWith('index-v'))
  if (!indexRelease) throw new Error('No index release found')
  return indexRelease.tag_name
}

export async function downloadIndex(
  variant: IndexVariant,
  onProgress: (message: string) => void = () => {}
): Promise<void> {
  onProgress('Finding latest index release...')
  const tag = await getLatestIndexTag()
  onProgress(`Latest: ${tag}`)

  const baseUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}`
  const paths = getIndexPaths(variant)

  const metadataText = await (await fetchOk(`${baseUrl}/${variant}-metadata.json`)).text()
  const metadata = v.parse(v.pipe(v.string(), v.parseJson(), MetadataSchema), metadataText)
  if (!isCompatibleIndex(metadata)) {
    throw new Error(
      `The ${variant} index in ${tag} was hashed as ${metadata.scheme ?? 'an older scheme'}, not ${HASH_SCHEME}; update whaticon`
    )
  }

  await mkdir(join(paths.metadata, '..'), { recursive: true })
  for (const [file, path] of [
    ['names.txt.gz', paths.names],
    ['hashes.bin.gz', paths.hashes]
  ] as const) {
    onProgress(`  ${variant}-${file}`)
    const res = await fetchOk(`${baseUrl}/${variant}-${file}`)
    await writeFile(path, new Uint8Array(await res.arrayBuffer()))
  }
  // Written last, so an interrupted download is not taken for a complete one.
  await writeFile(paths.metadata, metadataText)
  onProgress(`Downloaded ${metadata.icons} icons from ${metadata.prefixes.length} sets`)
}

export function loadCachedIndex(
  variant: IndexVariant
): { namesGz: Buffer; hashesGz: Buffer } | null {
  if (!isIndexDownloaded(variant)) return null
  const paths = getIndexPaths(variant)
  return { namesGz: readFileSync(paths.names), hashesGz: readFileSync(paths.hashes) }
}

export async function ensureIndex(
  variant: IndexVariant,
  onProgress?: (message: string) => void
): Promise<{ namesGz: Buffer; hashesGz: Buffer }> {
  const cached = loadCachedIndex(variant)
  if (cached) return cached

  await downloadIndex(variant, onProgress)

  const result = loadCachedIndex(variant)
  if (!result) throw new Error('Failed to load index after download')
  return result
}

export function clearCache(): void {
  rmSync(getCacheDir(), { recursive: true, force: true })
}
