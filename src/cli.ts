#!/usr/bin/env node
import { defineCommand, runMain } from 'citty'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { ensureIndex, getCacheDir, isIndexDownloaded, type IndexVariant } from './download.js'
import { fetchIconSvg, findMatches, loadIndex } from './index.js'

const main = defineCommand({
  meta: {
    name: 'whaticon',
    description: 'Find matching Iconify icons by visual similarity'
  },
  args: {
    file: {
      type: 'positional',
      description: 'SVG file to match',
      required: false
    },
    url: {
      type: 'string',
      description: 'Fetch SVG from URL'
    },
    icon: {
      type: 'string',
      description: 'Find similar icons (e.g., lucide:home)'
    },
    limit: {
      type: 'string',
      alias: 'n',
      description: 'Maximum results',
      default: '10'
    },
    threshold: {
      type: 'string',
      alias: 't',
      description: 'Minimum similarity 0-1',
      default: '0.8'
    },
    prefix: {
      type: 'string',
      alias: 'p',
      description: 'Limit to icon sets (comma-separated)'
    },
    prefer: {
      type: 'string',
      description: 'Prefer icon sets (comma-separated), sorted first at equal similarity'
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Index variant: core, popular (default), full'
    },
    json: {
      type: 'boolean',
      alias: 'j',
      description: 'Output as JSON'
    }
  },
  async run({ args }) {
    let svg: string | undefined

    if (args.url) {
      const res = await fetch(args.url)
      if (!res.ok) {
        console.error(`Failed to fetch ${args.url}: ${res.status}`)
        process.exit(1)
      }
      svg = await res.text()
    } else if (args.icon) {
      svg = await fetchIconSvg(args.icon)
    } else if (args.file) {
      const path = resolve(args.file)
      if (!existsSync(path)) {
        console.error(`File not found: ${path}`)
        process.exit(1)
      }
      svg = readFileSync(path, 'utf-8')
    }

    if (!svg) {
      console.error('No input provided. Use --help for usage.')
      process.exit(1)
    }

    // Determine index variant
    const variant = (args.index as IndexVariant) || 'popular'
    if (!['core', 'popular', 'full'].includes(variant)) {
      console.error(`Invalid index variant: ${variant}. Use: core, popular, full`)
      process.exit(1)
    }

    // Try bundled index first, then download
    let namesGz: Buffer
    let hashesGz: Buffer

    const bundledDir = resolve(import.meta.dirname, '../data')
    const bundledNames = resolve(bundledDir, 'names.txt.gz')
    const bundledHashes = resolve(bundledDir, 'hashes.bin.gz')

    if (variant === 'popular' && existsSync(bundledNames) && existsSync(bundledHashes)) {
      // Use bundled popular index
      namesGz = readFileSync(bundledNames)
      hashesGz = readFileSync(bundledHashes)
    } else {
      // Download from GitHub releases
      if (!isIndexDownloaded(variant)) {
        console.error(`Downloading ${variant} index...`)
      }
      const cached = await ensureIndex(variant, (msg) => console.error(msg))
      namesGz = cached.namesGz
      hashesGz = cached.hashesGz
    }

    const index = loadIndex(namesGz, hashesGz)

    const prefixes = args.prefix?.split(',').map((p) => p.trim())
    const prefer = args.prefer?.split(',').map((p) => p.trim())

    const matches = await findMatches(svg, index, {
      limit: parseInt(args.limit, 10),
      threshold: parseFloat(args.threshold),
      prefixes,
      prefer
    })

    if (args.json) {
      console.log(JSON.stringify(matches, null, 2))
    } else {
      if (matches.length === 0) {
        console.log('No matches found above threshold.')
      } else {
        for (const m of matches) {
          const pct = (m.similarity * 100).toFixed(1)
          console.log(`${pct}%  ${m.name}`)
        }
      }
    }
  }
})

runMain(main)
