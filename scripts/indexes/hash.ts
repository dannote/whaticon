/**
 * Hash icon sets into a gzipped index.
 */
import { gzipSync } from 'node:zlib'

import { buildIndex } from '#src/index.ts'

import { loadIconSet } from '../icon-sets/index.ts'

export interface HashedIndex {
  namesGz: Buffer
  hashesGz: Buffer
  /** The sets that held icons. */
  prefixes: string[]
  icons: number
}

/** Hash the icons of `prefixes` into a gzipped index, reporting progress on stderr. */
export async function hashSets(prefixes: string[]): Promise<HashedIndex> {
  const sets = await Promise.all(
    prefixes.map(async (prefix) => ({ prefix, icons: await loadIconSet(prefix) }))
  )
  const found = sets.filter((set) => set.icons.length > 0)
  const icons = found.flatMap((set) => set.icons)
  const started = performance.now()
  const { names, hashes, skipped } = await buildIndex(icons, (current, total) => {
    const rate = Math.round(current / ((performance.now() - started) / 1000))
    process.stderr.write(`\r  ${current}/${total} (${rate}/s)`)
  })
  process.stderr.write('\n')
  if (skipped.length > 0) {
    console.warn(`  ${skipped.length} icons did not render: ${skipped.slice(0, 10).join(', ')}`)
  }
  return {
    namesGz: gzipSync(names),
    hashesGz: gzipSync(hashes),
    prefixes: found.map((set) => set.prefix),
    icons: names.split('\n').filter(Boolean).length
  }
}
