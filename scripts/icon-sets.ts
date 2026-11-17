import { getIconData, iconToSVG, quicklyValidateIconSet } from '@iconify/utils'
/**
 * Icon sets to index, read from the `@iconify-json/*` packages installed.
 */
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { DEFAULT_SIZE, buildIndex, type IconInput } from '../src/index.ts'

export const CORE_SETS = ['lucide', 'heroicons', 'tabler']

export const POPULAR_SETS = [
  'lucide',
  'mdi',
  'heroicons',
  'tabler',
  'ph',
  'ri',
  'bi',
  'fa6-solid',
  'fa6-regular',
  'ion',
  'carbon',
  'fluent'
]

const require = createRequire(import.meta.url)

/** The icons of a set, or none when its package is not installed. */
export async function loadIconSet(prefix: string): Promise<IconInput[]> {
  let path: string
  try {
    path = require.resolve(`@iconify-json/${prefix}/icons.json`)
  } catch {
    return []
  }
  const set = quicklyValidateIconSet(JSON.parse(await readFile(path, 'utf-8')) as unknown)
  if (!set) throw new Error(`@iconify-json/${prefix} holds no valid icon set`)
  return Object.keys(set.icons).flatMap((name) => {
    const icon = getIconData(set, name)
    if (!icon) return []
    const { body, viewBox } = iconToSVG(icon)
    return [{ name: `${prefix}:${name}`, body, viewBox }]
  })
}

/** Every set whose package is installed, such as after `install-icon-sets.ts`. */
export async function installedSets(): Promise<string[]> {
  const scope = join(dirname(require.resolve('@iconify-json/lucide/package.json')), '..')
  return (await readdir(scope)).sort()
}

export interface BuiltIndex {
  namesGz: Buffer
  hashesGz: Buffer
  /** The sets that held icons. */
  prefixes: string[]
  icons: number
}

/** Hash the icons of `prefixes` into a gzipped index, reporting progress on stderr. */
export async function indexSets(prefixes: string[]): Promise<BuiltIndex> {
  const sets = await Promise.all(
    prefixes.map(async (prefix) => ({ prefix, icons: await loadIconSet(prefix) }))
  )
  const found = sets.filter((set) => set.icons.length > 0)
  const icons = found.flatMap((set) => set.icons)
  const started = performance.now()
  const { names, hashes } = await buildIndex(icons, DEFAULT_SIZE, (current, total) => {
    const rate = Math.round(current / ((performance.now() - started) / 1000))
    process.stderr.write(`\r  ${current}/${total} (${rate}/s)`)
  })
  process.stderr.write('\n')
  return {
    namesGz: gzipSync(names),
    hashesGz: gzipSync(hashes),
    prefixes: found.map((set) => set.prefix),
    icons: names.split('\n').filter(Boolean).length
  }
}
