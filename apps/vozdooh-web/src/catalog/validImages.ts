import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CatalogProduct } from './contracts'
import { catalogImage } from './presentation'

/** Validate local assets without mutating repository/editorial data. */
export async function withValidImages(products: readonly CatalogProduct[]): Promise<CatalogProduct[]> {
  return Promise.all(products.map(async (product) => {
    const images: string[] = []
    for (const image of product.editorial.images) {
      if (!catalogImage({ ...product, editorial: { ...product.editorial, images: [image] } })) continue
      try {
        const file = await stat(join(process.cwd(), 'public', image))
        if (file.isFile() && file.size > 0) images.push(image)
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
    }
    return { ...product, editorial: { ...product.editorial, images } }
  }))
}
