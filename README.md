# whaticon

Find matching [Iconify](https://iconify.design) icons by visual similarity.

Given an SVG, `whaticon` renders it and compares against 57k+ indexed icons using perceptual hashing to find the closest matches.

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
| `-j, --json` | Output as JSON |

## API Usage

```typescript
import { findMatches, loadIndex } from 'whaticon'
import { readFileSync } from 'fs'

// Load index (ships with package)
const index = loadIndex(
  readFileSync('node_modules/whaticon/data/names.txt.gz'),
  readFileSync('node_modules/whaticon/data/hashes.bin.gz')
)

// Find matches
const svg = readFileSync('icon.svg', 'utf-8')
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

#### `svgToPixels(svg, size?)`

Convert SVG to grayscale pixel buffer.

#### `hammingDistance(h1, h2)`

Calculate Hamming distance between two hash buffers.

#### `hashSimilarity(h1, h2)`

Convert hashes to similarity score (0-1).

#### `fetchIconSvg(name)`

Fetch icon SVG from Iconify API.

#### `loadIndex(namesGz, hashesGz)`

Load index from gzipped binary files.

## Indexed Icon Sets

57k+ icons from popular sets:

- Lucide
- Material Design Icons (MDI)
- Heroicons
- Tabler
- Phosphor
- Remix Icon
- Bootstrap Icons
- Font Awesome
- Ionicons
- Carbon
- Fluent

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
- **Index size**: 1.72 MB (gzip compressed)

### Index Format

Two gzip-compressed files:
- `names.txt.gz` — icon names, one per line
- `hashes.bin.gz` — 128 bytes per icon, concatenated

## License

MIT
