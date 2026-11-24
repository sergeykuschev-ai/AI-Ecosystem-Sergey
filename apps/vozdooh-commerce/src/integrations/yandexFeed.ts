import type { CatalogProduct } from '../catalog/contracts'
import { catalogImage, isPubliclyPurchasable, productPresentation, storefrontProducts } from '../catalog/presentation'
import { isYandexDirectPictureEligible } from '../catalog/yandexImageEligibility'

const yandexCurrency = 'RUR'

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
}

function ymlDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Build the feed from catalog records whose local image files were validated by the route. */
export function buildYandexYml(products: readonly CatalogProduct[], siteUrl: string, generatedAt = new Date()): string {
  const base = siteUrl.replace(/\/+$/, '')
  const offers = storefrontProducts(products).flatMap((product) => {
    const description = product.editorial.description
    if (!isPubliclyPurchasable(product) || !description?.trim()) return []

    const images = product.editorial.images.filter((image) =>
      /\.(?:jpe?g|png|webp)$/i.test(image) && isYandexDirectPictureEligible(image))
    const picture = catalogImage({ ...product, editorial: { ...product.editorial, images } })
    return picture ? [{ product, picture, description }] : []
  })
  const categoryNames = [...new Set(offers.map(({ product }) => product.trade.category))].sort((a, b) => a.localeCompare(b, 'ru'))
  const categoryIds = new Map(categoryNames.map((name, index) => [name, index + 1]))
  const categories = categoryNames.map((name) => `      <category id="${categoryIds.get(name)}">${xml(name)}</category>`).join('\n')
  const offerXml = offers.map(({ product, picture, description }) => {
    const display = productPresentation(product)
    const price = product.trade.price!
    const fields = [
      `      <offer id="${xml(product.trade.sku)}" available="true">`,
      `        <url>${xml(`${base}/catalog/${product.editorial.slug}`)}</url>`,
      `        <price>${Number.isInteger(price) ? price : price.toFixed(2)}</price>`,
      `        <currencyId>${yandexCurrency}</currencyId>`,
      `        <categoryId>${categoryIds.get(product.trade.category)}</categoryId>`,
      `        <picture>${xml(`${base}${picture}`)}</picture>`,
      `        <name>${xml(display.title)}</name>`,
      ...(product.trade.brand ? [`        <vendor>${xml(product.trade.brand)}</vendor>`] : []),
      `        <description>${xml(description)}</description>`,
      ...(product.trade.volume ? [`        <param name="Объём / масса">${xml(product.trade.volume)}</param>`] : []),
      '      </offer>',
    ]
    return fields.join('\n')
  }).join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<yml_catalog date="${ymlDate(generatedAt)}">`,
    '  <shop>',
    '    <name>VOZDOOH</name>',
    '    <company>VOZDOOH</company>',
    `    <url>${xml(base)}</url>`,
    '    <currencies>',
    `      <currency id="${yandexCurrency}" rate="1"/>`,
    '    </currencies>',
    '    <categories>',
    categories,
    '    </categories>',
    '    <offers>',
    offerXml,
    '    </offers>',
    '  </shop>',
    '</yml_catalog>',
    '',
  ].join('\n')
}
