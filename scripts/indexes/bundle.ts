#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { POPULAR_SETS } from '../icon-sets/index.ts'
import { DATA_DIR } from '../paths.ts'
import { hashSets } from './hash.ts'

/**
 * Build the index bundled in `data/` from the installed `@iconify-json/*` packages.
 *
 *   bun run indexes:bundle                   # the popular sets
 *   bun run indexes:bundle --prefix lucide   # chosen sets
 */
const command = defineCommand({
  meta: { name: 'indexes:bundle', description: 'Build the bundled index' },
  args: { prefix: { type: 'string', description: 'Icon sets (comma-separated)' } },
  async run({ args }) {
    const prefixes = args.prefix?.split(',').map((prefix) => prefix.trim()) ?? POPULAR_SETS
    const index = await hashSets(prefixes)
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(resolve(DATA_DIR, 'names.txt.gz'), index.namesGz)
    await writeFile(resolve(DATA_DIR, 'hashes.bin.gz'), index.hashesGz)
    console.log(`${index.icons} icons from ${index.prefixes.join(', ')} in ${DATA_DIR}`)
  }
})

await runMain(command)
