import { catalogSource, type CatalogSource } from '../catalog/source'

export type AppEnv = {
  siteUrl: string
  catalogProvider: CatalogSource
  commerceProvider: string
  paymentProvider: string
  inventoryProvider: string
}

export function getEnv(): AppEnv {
  return {
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3400',
    catalogProvider: catalogSource(),
    commerceProvider: process.env.COMMERCE_PROVIDER ?? 'stub',
    paymentProvider: process.env.PAYMENT_PROVIDER ?? 'stub',
    inventoryProvider: process.env.INVENTORY_PROVIDER ?? 'stub',
  }
}
