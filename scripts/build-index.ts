#!/usr/bin/env bun
/**
 * Build icon index from @iconify-json/* packages
 *
 * Usage:
 *   bun run scripts/build-index.ts                    # All popular sets
 *   bun run scripts/build-index.ts --prefix lucide    # Specific sets
 */
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { gzipSync } from 'zlib'

import { buildIndex } from '../src/index.ts'

const POPULAR_SETS = [
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
    console.error(
      `Package @iconify-json/${prefix} not installed. Run: bun add @iconify-json/${prefix}`
    )
    return []
  }
}

async function main() {
  const args = process.argv.slice(2)
  let prefixes = POPULAR_SETS

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prefix' && args[i + 1]) {
      prefixes = args[i + 1]!.split(',').map((p) => p.trim())
      break
    }
  }

  console.log(`Building index for: ${prefixes.join(', ')}\n`)

  const allIcons: IconData[] = []

  for (const prefix of prefixes) {
    process.stdout.write(`Loading ${prefix}...`)
    const icons = await loadCollection(prefix)
    if (icons.length > 0) {
      allIcons.push(...icons)
      console.log(` ${icons.length} icons`)
    } else {
      console.log(' skipped')
    }
  }

  console.log(`\nTotal: ${allIcons.length} icons`)
  console.log('Computing hashes...\n')

  const startTime = Date.now()

  const { names, hashes } = await buildIndex(allIcons, 32, (current, total) => {
    if (current % 500 === 0 || current === total) {
      const elapsed = (Date.now() - startTime) / 1000
      const rate = Math.round(current / elapsed)
      process.stdout.write(`\r${current}/${total} (${rate}/s)`)
    }
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n\nHashed ${names.split('\n').length} icons in ${elapsed}s`)

  // Compress
  const namesGz = gzipSync(names)
  const hashesGz = gzipSync(hashes)

  const outDir = resolve(import.meta.dirname, '../data')
  mkdirSync(outDir, { recursive: true })

  writeFileSync(resolve(outDir, 'names.txt.gz'), namesGz)
  writeFileSync(resolve(outDir, 'hashes.bin.gz'), hashesGz)

  const totalSize = ((namesGz.length + hashesGz.length) / 1024 / 1024).toFixed(2)
  console.log(`Saved to ${outDir}/ (${totalSize} MB total)`)
  console.log(`  names.txt.gz: ${(namesGz.length / 1024).toFixed(0)} KB`)
  console.log(`  hashes.bin.gz: ${(hashesGz.length / 1024).toFixed(0)} KB`)
}

main()
