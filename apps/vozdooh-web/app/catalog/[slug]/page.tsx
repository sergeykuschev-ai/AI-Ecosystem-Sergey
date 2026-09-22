import Link from 'next/link'
import { notFound } from 'next/navigation'
import { demoProducts } from '../../../src/catalog/demo'

export function generateStaticParams(){ return demoProducts.map(({slug})=>({slug})) }

export default async function ProductPage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params
  const product=demoProducts.find(x=>x.slug===slug)
  if(!product) notFound()
  return <main className="productPage">
    <header className="subHeader"><Link className="logo" href="/">VOZDOOH</Link><Link href="/catalog">Каталог</Link></header>
    <div className="productLayout"><div className="productHeroPlaceholder">PRODUCT IMAGE</div><div className="productInfo"><span className="eyebrow">Техническая карточка</span><h1>{product.name}</h1><p className="productSku">SKU: {product.sku}</p><p>Реальный бренд, объём, цена, остаток, ноты и характеристики появятся только из 1С и проверяемого контента.</p><button disabled>Добавить в корзину после импорта</button></div></div>
  </main>
}
