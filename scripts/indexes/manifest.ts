import * as v from 'valibot'

export const ManifestSchema = v.object({
  created: v.string(),
  variants: v.record(
    v.string(),
    v.object({ icons: v.number(), sizeBytes: v.number(), files: v.array(v.string()) })
  )
})

export type Manifest = v.InferOutput<typeof ManifestSchema>
