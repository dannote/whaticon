#!/usr/bin/env bun
/**
 * Build every index variant for a release into `dist/indexes/`: core and popular from their
 * sets, and full from every installed set (`install-icon-sets.ts` installs them all).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { HASH_SCHEME } from '../src/index.ts'
import { CORE_SETS, POPULAR_SETS, indexSets, installedSets } from './icon-sets.ts'
import { INDEXES_DIR, type Manifest } from './manifest.ts'

const variants = { core: CORE_SETS, popular: POPULAR_SETS, full: await installedSets() }

await mkdir(INDEXES_DIR, { recursive: true })
const manifest: Manifest = { created: new Date().toISOString(), variants: {} }
for (const [variant, prefixes] of Object.entries(variants)) {
  console.log(`${variant}: ${prefixes.length} sets`)
  const index = await indexSets(prefixes)
  const [names, hashes, metadata] = [
    `${variant}-names.txt.gz`,
    `${variant}-hashes.bin.gz`,
    `${variant}-metadata.json`
  ]
  await writeFile(resolve(INDEXES_DIR, names), index.namesGz)
  await writeFile(resolve(INDEXES_DIR, hashes), index.hashesGz)
  await writeFile(
    resolve(INDEXES_DIR, metadata),
    JSON.stringify(
      {
        version: 1,
        scheme: HASH_SCHEME,
        variant,
        prefixes: index.prefixes,
        icons: index.icons,
        created: manifest.created
      },
      null,
      2
    )
  )
  const sizeBytes = index.namesGz.length + index.hashesGz.length
  manifest.variants[variant] = { icons: index.icons, sizeBytes, files: [names, hashes, metadata] }
  console.log(`  ${index.icons} icons, ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`)
}
await writeFile(resolve(INDEXES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
