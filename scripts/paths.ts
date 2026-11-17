import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** The index bundled with the package. */
export const DATA_DIR = resolve(ROOT, 'data')

/** Where `indexes/build.ts` writes a release's files. */
export const INDEXES_DIR = resolve(ROOT, 'dist/indexes')
