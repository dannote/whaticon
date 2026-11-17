#!/usr/bin/env bun
/**
 * Publish the indexes `indexes/build.ts` built as a GitHub release, tagged
 * `index-v$VERSION`. The version defaults to today's date. An existing release is left alone:
 * clients may be downloading from it, so a rebuild gets a new version instead.
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as v from 'valibot'

import { INDEXES_DIR } from '../paths.ts'
import { ManifestSchema } from './manifest.ts'

const version = process.env.VERSION || new Date().toISOString().slice(0, 10).replaceAll('-', '.')
const tag = `index-v${version}`
const manifest = v.parse(
  v.pipe(v.string(), v.parseJson(), ManifestSchema),
  await readFile(resolve(INDEXES_DIR, 'manifest.json'), 'utf-8')
)
const rows = Object.entries(manifest.variants).map(
  ([name, { icons, sizeBytes }]) =>
    `| ${name} | ${icons.toLocaleString('en-US')} | ${(sizeBytes / 1024 / 1024).toFixed(2)} MB |`
)
const notes = ['| Variant | Icons | Size |', '| --- | --- | --- |', ...rows].join('\n')
const files = Object.values(manifest.variants).flatMap((variant) => variant.files)
execFileSync(
  'gh',
  [
    'release',
    'create',
    tag,
    '--title',
    `Index v${version}`,
    '--notes',
    notes,
    ...[...files, 'manifest.json'].map((file) => resolve(INDEXES_DIR, file))
  ],
  { stdio: 'inherit' }
)
