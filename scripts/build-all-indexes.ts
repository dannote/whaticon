#!/usr/bin/env bun
/**
 * Build all index variants for release
 *
 * Creates three index sizes:
 *   - core: lucide, heroicons, tabler (~10k icons)
 *   - popular: 12 popular sets (~57k icons)
 *   - full: all available sets (~200k+ icons)
 *
 * Output: dist/indexes/{core,popular,full}/
 */
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { gzipSync } from 'zlib'

import { buildIndex } from '../src/index.ts'

const INDEX_VARIANTS = {
  core: ['lucide', 'heroicons', 'tabler'],
  popular: [
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
  ],
  full: [] as string[] // Will be populated from API
}

interface IconifyIcon {
  body: string
  width?: number
  height?: number
}

interface IconifyJSON {
  prefix: string
  icons: Record<string, IconifyIcon>
  width?: number
  height?: number
}

interface IconData {
  name: string
  svg: string
}

interface CollectionInfo {
  name: string
  total: number
  version?: string
}

async function fetchAllPrefixes(): Promise<string[]> {
  const res = await fetch('https://api.iconify.design/collections')
  const data = (await res.json()) as Record<string, CollectionInfo>
  return Object.keys(data).sort()
}

async function loadCollection(prefix: string): Promise<IconData[]> {
  try {
    const pkg = await import(`@iconify-json/${prefix}/icons.json`)
    const data = pkg.default as IconifyJSON

    const defaultWidth = data.width || 24
    const defaultHeight = data.height || 24

    const result: IconData[] = []
    for (const [name, icon] of Object.entries(data.icons)) {
      const w = icon.width || defaultWidth
      const h = icon.height || defaultHeight
      result.push({
        name: `${prefix}:${name}`,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${icon.body}</svg>`
      })
    }
    return result
  } catch {
    return []
  }
}

async function buildVariant(
  name: string,
  prefixes: string[],
  outDir: string
): Promise<{ icons: number; size: number }> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Building "${name}" index (${prefixes.length} sets)`)
  console.log('='.repeat(60))

  const allIcons: IconData[] = []

  for (const prefix of prefixes) {
    process.stdout.write(`  Loading ${prefix}...`)
    const icons = await loadCollection(prefix)
    if (icons.length > 0) {
      allIcons.push(...icons)
      console.log(` ${icons.length}`)
    } else {
      console.log(' (not installed)')
    }
  }

  console.log(`\n  Total: ${allIcons.length} icons`)
  console.log('  Hashing...')

  const startTime = Date.now()
  const { names, hashes } = await buildIndex(allIcons, 32, (current, total) => {
    if (current % 5000 === 0 || current === total) {
      const pct = ((current / total) * 100).toFixed(0)
      const elapsed = (Date.now() - startTime) / 1000
      const rate = Math.round(current / elapsed)
      process.stdout.write(`\r  ${current}/${total} (${pct}%, ${rate}/s)`)
    }
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n  Hashed in ${elapsed}s`)

  // Compress and save
  const namesGz = gzipSync(names)
  const hashesGz = gzipSync(hashes)

  const variantDir = resolve(outDir, name)
  mkdirSync(variantDir, { recursive: true })

  writeFileSync(resolve(variantDir, 'names.txt.gz'), namesGz)
  writeFileSync(resolve(variantDir, 'hashes.bin.gz'), hashesGz)

  // Write metadata
  const metadata = {
    version: 1,
    variant: name,
    prefixes: prefixes.filter((p) => allIcons.some((i) => i.name.startsWith(`${p}:`))),
    icons: allIcons.length,
    created: new Date().toISOString()
  }
  writeFileSync(resolve(variantDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

  const totalSize = namesGz.length + hashesGz.length
  console.log(`  Saved to ${variantDir}/`)
  console.log(`    names.txt.gz:  ${(namesGz.length / 1024).toFixed(0)} KB`)
  console.log(`    hashes.bin.gz: ${(hashesGz.length / 1024).toFixed(0)} KB`)
  console.log(`    Total: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)

  return { icons: allIcons.length, size: totalSize }
}

async function main() {
  const outDir = resolve(import.meta.dirname, '../dist/indexes')
  mkdirSync(outDir, { recursive: true })

  // Get all prefixes for full index
  console.log('Fetching available icon sets...')
  INDEX_VARIANTS.full = await fetchAllPrefixes()
  console.log(`Found ${INDEX_VARIANTS.full.length} sets`)

  const results: Record<string, { icons: number; size: number }> = {}

  for (const [name, prefixes] of Object.entries(INDEX_VARIANTS)) {
    results[name] = await buildVariant(name, prefixes, outDir)
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log('SUMMARY')
  console.log('='.repeat(60))
  for (const [name, { icons, size }] of Object.entries(results)) {
    console.log(
      `  ${name.padEnd(10)} ${String(icons).padStart(7)} icons  ${(size / 1024 / 1024).toFixed(2)} MB`
    )
  }

  // Write manifest for GitHub release
  const manifest = {
    version: process.env.VERSION || '1.0.0',
    created: new Date().toISOString(),
    variants: Object.fromEntries(
      Object.entries(results).map(([name, { icons, size }]) => [
        name,
        {
          icons,
          sizeBytes: size,
          files: ['names.txt.gz', 'hashes.bin.gz', 'metadata.json']
        }
      ])
    )
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nManifest written to ${outDir}/manifest.json`)
}

main()
