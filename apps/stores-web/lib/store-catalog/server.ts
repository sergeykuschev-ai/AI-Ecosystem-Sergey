// Server-side: uses Node fs APIs, imported only from server components.
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { type CatalogSnapshot, type CatalogStore, validateCatalogSnapshot } from './core';

export async function loadCatalog(store: CatalogStore): Promise<CatalogSnapshot | null> {
  const dir = process.env.AMURSK_CATALOG_DATA_DIR;
  if (!dir || !isAbsolute(dir)) return null;
  const filename = join(dir, store + '.json');
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Invalid catalog file size');
    return validateCatalogSnapshot(JSON.parse(await readFile(filename, 'utf8')), store);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error('[catalog] rejected verified snapshot', store, error instanceof Error ? error.message : 'invalid snapshot');
    return null;
  }
}
