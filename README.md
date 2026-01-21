# whaticon

Find matching [Iconify](https://iconify.design) icons by visual similarity.

Given an SVG, `whaticon` renders it and compares against indexed icons using perceptual hashing to find the closest matches.

## Installation

```bash
npm install whaticon
```

## CLI Usage

```bash
# Find matches for an SVG file
npx whaticon icon.svg

# Find similar icons to a known icon
npx whaticon --icon lucide:home

# Limit to specific icon sets
npx whaticon icon.svg --prefix lucide,tabler

# Prefer certain icon sets (sorted first at equal similarity)
npx whaticon icon.svg --prefer lucide

# Adjust threshold and limit
npx whaticon icon.svg --threshold 0.9 --limit 5

# Use different index size
npx whaticon icon.svg --index full    # 200k+ icons
npx whaticon icon.svg --index core    # ~10k icons (faster)

# JSON output
npx whaticon icon.svg --json
```

### Options

| Option | Description |
|--------|-------------|
| `-n, --limit <n>` | Maximum results (default: 10) |
| `-t, --threshold <n>` | Minimum similarity 0-1 (default: 0.8) |
| `-p, --prefix <sets>` | Limit to icon sets (comma-separated) |
| `--prefer <sets>` | Prefer these icon sets (comma-separated) |
| `-i, --index <variant>` | Index: `core`, `popular` (default), `full` |
| `-j, --json` | Output as JSON |

## Index Variants

| Variant | Icons | Size | Description |
|---------|-------|------|-------------|
| `core` | ~10k | ~0.4 MB | lucide, heroicons, tabler |
| `popular` | ~57k | ~1.8 MB | 12 popular sets (default) |
| `full` | ~200k+ | ~6 MB | All Iconify sets |

The `popular` index is bundled with the package. Other variants are downloaded on first use to `~/.cache/whaticon/`.

## API Usage

```typescript
import { findMatches, loadIndex } from 'whaticon'
import { ensureIndex } from 'whaticon/download'

// Ensure index is available (downloads if needed)
const { namesGz, hashesGz } = await ensureIndex('popular')
const index = loadIndex(namesGz, hashesGz)

// Find matches
const svg = '<svg>...</svg>'
const matches = await findMatches(svg, index, {
  limit: 5,
  threshold: 0.85,
  prefixes: ['lucide', 'mdi'],
  prefer: ['lucide']
})

console.log(matches)
// [
//   { name: 'lucide:home', similarity: 0.95 },
//   { name: 'mdi:home', similarity: 0.92 },
//   ...
// ]
```

### Functions

#### `findMatches(svg, index, options?)`
Find matching icons from an index.

#### `computeDHash(svg, size?)`
Compute difference hash for an SVG. Returns 128-byte Buffer.

#### `loadIndex(namesGz, hashesGz)`
Load index from gzipped binary files.

#### `ensureIndex(variant)`
Ensure index is downloaded, returns gzipped buffers.

#### `isIndexDownloaded(variant)`
Check if index variant is cached locally.

## Building Custom Index

```typescript
import { buildIndex } from 'whaticon'
import { gzipSync, writeFileSync } from 'fs'

const icons = [
  { name: 'my:icon1', svg: '<svg>...</svg>' },
  { name: 'my:icon2', svg: '<svg>...</svg>' },
]

const { names, hashes } = await buildIndex(icons)

writeFileSync('names.txt.gz', gzipSync(names))
writeFileSync('hashes.bin.gz', gzipSync(hashes))
```

## How It Works

1. **Render**: SVG is rendered to a 33×32 grayscale image using [sharp](https://sharp.pixelplumbing.com/)
2. **Hash**: A [difference hash (dHash)](https://www.hackerfactor.com/blog/index.php?/archives/529-Kind-of-Like-That.html) is computed — comparing adjacent pixels to produce 1024 bits
3. **Match**: Hamming distance between hashes determines similarity

### Performance

- **Index build**: ~10,000 icons/sec (sprite sheet batching)
- **Search**: ~5ms per query (32-bit popcount optimization)
- **Index size**: ~30 bytes per icon (gzip compressed)

## Index Format

Two gzip-compressed files:
- `names.txt.gz` — icon names, one per line
- `hashes.bin.gz` — 128 bytes per icon, concatenated

## License

MIT
