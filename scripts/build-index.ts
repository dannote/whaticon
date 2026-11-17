#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'
/**
 * Build the index bundled in `data/` from the installed `@iconify-json/*` packages.
 *
 *   bun run build:index                   # the popular sets
 *   bun run build:index --prefix lucide   # chosen sets
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { POPULAR_SETS, indexSets } from './icon-sets.ts'

const command = defineCommand({
  meta: { name: 'build-index', description: 'Build the bundled index' },
  args: { prefix: { type: 'string', description: 'Icon sets (comma-separated)' } },
  async run({ args }) {
    const prefixes = args.prefix?.split(',').map((prefix) => prefix.trim()) ?? POPULAR_SETS
    const index = await indexSets(prefixes)
    const outDir = resolve(import.meta.dirname, '../data')
    await mkdir(outDir, { recursive: true })
    await writeFile(resolve(outDir, 'names.txt.gz'), index.namesGz)
    await writeFile(resolve(outDir, 'hashes.bin.gz'), index.hashesGz)
    console.log(`${index.icons} icons from ${index.prefixes.join(', ')} in ${outDir}`)
  }
})

await runMain(command)
