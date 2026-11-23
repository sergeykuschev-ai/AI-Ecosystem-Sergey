import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { CatalogPriceStock } from '@/components/store-catalog/CatalogPriceStock';
import { CATALOG_STORES, catalogIndexable, displayPrice, parseCatalogStore } from '@/lib/store-catalog/core';
import { loadCatalog } from '@/lib/store-catalog/server';
export const dynamic='force-dynamic';
type Props={params:Promise<{store:string;productId:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {store:slug,productId}=await params;
  const store=parseCatalogStore(slug);
  if(!store)notFound();
  const snapshot=await loadCatalog(store);
  const product=snapshot?.products.find(p=>p.id===productId);
  if(!product)notFound();
  return { title:product.name+' — «'+CATALOG_STORES[store].name+'», Амурск',
    description:'Товар магазина «'+CATALOG_STORES[store].name+'» в Амурске. Актуальные цену и наличие уточняйте перед покупкой.',
    alternates:{canonical:'/catalog/'+store+'/'+encodeURIComponent(product.id)+'/'},
    robots:{index:catalogIndexable(snapshot)&&displayPrice(product)!==null,follow:true} };
}
export default async function Page({params}:Props){
  const {store:slug,productId}=await params;
  const store=parseCatalogStore(slug);
  if(!store)notFound();
  const catalog=await loadCatalog(store);
  const product=catalog?.products.find(p=>p.id===productId);
  if(!product)notFound();
  const storeCatalogPath='/catalog/'+store+'/';
  return <main className="catalog-main"><Container>
    <nav aria-label="Навигация"><Link href="/">Главная</Link> / <Link href={CATALOG_STORES[store].home}>{CATALOG_STORES[store].name}</Link> / <Link href={storeCatalogPath}>Каталог</Link></nav>
    <article className="catalog-product-detail">
      <p className="catalog-product-category">{product.category}</p>
      <h1>{product.name}</h1>
      {product.sku&&<p>Артикул: {product.sku}</p>}
      {product.barcode&&<p>Штрихкод: {product.barcode}</p>}
      {product.unit&&<p>Единица измерения: {product.unit}</p>}
      {product.description&&<section className="prose"><h2>Описание</h2><p>{product.description}</p></section>}
      <CatalogPriceStock product={product}/>
      <p>Цены и остатки могут измениться после выгрузки 1С. <Link href="/kontakty/">Свяжитесь с магазином</Link> перед поездкой.</p>
    </article>
  </Container></main>;
}
