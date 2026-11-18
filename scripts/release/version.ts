#!/usr/bin/env bun
/**
 * Writes the version `npm version` just set into `src/version.ts`, which `whaticon/match` reads
 * to load the index the package was published with.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as v from 'valibot'

const ROOT = resolve(import.meta.dirname, '../..')
const { version } = v.parse(
  v.pipe(v.string(), v.parseJson(), v.object({ version: v.string() })),
  await readFile(resolve(ROOT, 'package.json'), 'utf-8')
)
await writeFile(
  resolve(ROOT, 'src/version.ts'),
  `// Written by \`npm version\` (scripts/release/version.ts); the published package's version.\nexport const VERSION = '${version}'\n`
)
