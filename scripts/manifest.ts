import { resolve } from 'node:path'
import * as v from 'valibot'

/** Where `build-all-indexes.ts` writes the release's files. */
export const INDEXES_DIR = resolve(import.meta.dirname, '../dist/indexes')

export const ManifestSchema = v.object({
  created: v.string(),
  variants: v.record(
    v.string(),
    v.object({ icons: v.number(), sizeBytes: v.number(), files: v.array(v.string()) })
  )
})

export type Manifest = v.InferOutput<typeof ManifestSchema>
