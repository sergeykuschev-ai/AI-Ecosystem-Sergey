import type { CatalogProduct } from '../catalog/contracts'
import { catalogImage, productPresentation, storefrontProducts } from '../catalog/presentation'
import { isYandexDirectPictureEligible } from '../catalog/yandexImageEligibility'

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
}

function ymlDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function buildYandexYml(products: readonly CatalogProduct[], siteUrl: string, generatedAt = new Date()): string {
  const base = siteUrl.replace(/\/+$/, '')
  const offers = storefrontProducts(products).filter((product) => product.isActive && (product.trade.stock ?? 0) > 0 && (product.trade.price ?? 0) > 0)
  const categoryNames = [...new Set(offers.map((product) => product.trade.category))].sort((a, b) => a.localeCompare(b, 'ru'))
  const categoryIds = new Map(categoryNames.map((name, index) => [name, index + 1]))
  const categories = categoryNames.map((name) => `      <category id="${categoryIds.get(name)}">${xml(name)}</category>`).join('\n')
  const offerXml = offers.map((product) => {
    const image = catalogImage(product)
    const display = productPresentation(product)
    const price = product.trade.price!
    const fields = [
      `      <offer id="${xml(product.trade.sku)}" available="true">`,
      `        <url>${xml(`${base}/catalog/${product.editorial.slug}`)}</url>`,
      `        <price>${Number.isInteger(price) ? price : price.toFixed(2)}</price>`,
      '        <currencyId>RUB</currencyId>',
      `        <categoryId>${categoryIds.get(product.trade.category)}</categoryId>`,
      ...(image && isYandexDirectPictureEligible(image) ? [`        <picture>${xml(`${base}${image}`)}</picture>`] : []),
      `        <name>${xml(display.title)}</name>`,
      ...(product.trade.brand ? [`        <vendor>${xml(product.trade.brand)}</vendor>`] : []),
      ...(product.editorial.description ? [`        <description>${xml(product.editorial.description)}</description>`] : []),
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
    '      <currency id="RUB" rate="1"/>',
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
