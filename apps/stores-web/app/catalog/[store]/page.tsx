import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { CatalogPriceStock } from '@/components/store-catalog/CatalogPriceStock';
import { CATALOG_STORES, catalogIndexable, paginate, parseCatalogStore, searchProducts } from '@/lib/store-catalog/core';
import { loadCatalog } from '@/lib/store-catalog/server';
export const dynamic = 'force-dynamic';
type Query = { q?: string|string[]; category?: string|string[]; page?: string|string[] };
type Props = { params: Promise<{store:string}>; searchParams:Promise<Query> };
const single=(v:string|string[]|undefined)=>typeof v==='string'?v:'';
function linkFor(store:string, q:string, category:string, page:number) {
  const p=new URLSearchParams();
  if(q)p.set('q',q);
  if(category)p.set('category',category);
  if(page>1)p.set('page',String(page));
  return '/catalog/'+store+'/'+(p.toString()?'?'+p.toString():'');
}
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {store:slug}=await params;
  const store=parseCatalogStore(slug);
  if(!store) notFound();
  const snapshot=await loadCatalog(store);
  return { title:'Каталог товаров «'+CATALOG_STORES[store].name+'» — Амурск',
    description:'Поиск товаров магазина «'+CATALOG_STORES[store].name+'» в Амурске. Цена и наличие по подтверждённой выгрузке 1С.',
    alternates:{canonical:'/catalog/'+store+'/'}, robots:{index:catalogIndexable(snapshot),follow:true} };
}
function productPath(store: string, id: string): string {
  return '/catalog/' + store + '/' + encodeURIComponent(id) + '/';
}
export default async function Page({params,searchParams}:Props) {
  const {store:slug}=await params;
  const store=parseCatalogStore(slug);
  if(!store)notFound();
  const snapshot=await loadCatalog(store);
  const qp=await searchParams;
  const q=single(qp.q).trim().slice(0,100);
  const category=single(qp.category).trim().slice(0,200);
  const selectedPage=Number(single(qp.page)||1);
  const all=snapshot?.products??[];
  const categories=[...new Set(all.map(p=>p.category))].sort((a,b)=>a.localeCompare(b,'ru'));
  const selectedCategory=categories.includes(category)?category:'';
  const found=searchProducts(all,q,selectedCategory);
  const paging=paginate(found,selectedPage);
  return <main className="catalog-main"><Container>
    <nav aria-label="Навигация"><Link href="/">Главная</Link> / <Link href={CATALOG_STORES[store].home}>{CATALOG_STORES[store].name}</Link> / Каталог</nav>
    <h1>Каталог товаров «{CATALOG_STORES[store].name}»</h1>
    <p>Товары, цены и остатки магазина «{CATALOG_STORES[store].name}». При отсутствии свежей проверки 1С цены и наличие не отображаются.</p>
    {!snapshot||all.length===0?<section className="catalog-empty">
      <h2>Каталог готовится к публикации</h2>
      <p>Проверенных товарных данных пока нет. Цены и наличие уточняйте в магазине.</p>
      <Link href="/kontakty/">Адрес и контакты</Link>
    </section>:<>
      <form className="catalog-filters" method="get">
        <label htmlFor="catalog-q">Название, артикул или штрихкод</label>
        <input id="catalog-q" name="q" type="search" defaultValue={q} maxLength={100} placeholder="Что ищете?" />
        <label htmlFor="catalog-category">Категория</label>
        <select id="catalog-category" name="category" defaultValue={selectedCategory}>
          <option value="">Все категории</option>
          {categories.map(value=><option key={value} value={value}>{value}</option>)}
        </select>
        <button type="submit">Найти</button>
      </form>
      <p role="status">Найдено товаров: {found.length}</p>
      {paging.rows.length===0?<p>По запросу товары не найдены.</p>:<ul className="catalog-product-grid">
        {paging.rows.map(product=><li key={product.id} className="catalog-product-card">
          <p className="catalog-product-category">{product.category}</p>
          <h2><Link href={productPath(store,product.id)}>{product.name}</Link></h2>
          {product.sku&&<p>Артикул: {product.sku}</p>}
          <CatalogPriceStock product={product}/>
        </li>)}
      </ul>}
      {paging.pages>1&&<nav className="catalog-pages" aria-label="Страницы каталога">
        {paging.page>1&&<Link href={linkFor(store,q,selectedCategory,paging.page-1)}>Предыдущая</Link>}
        <span>Страница {paging.page} из {paging.pages}</span>
        {paging.page<paging.pages&&<Link href={linkFor(store,q,selectedCategory,paging.page+1)}>Следующая</Link>}
      </nav>}
      <p className="catalog-last-update">Дата выгрузки 1С: <time dateTime={snapshot.exportedAt}>{new Date(snapshot.exportedAt).toLocaleString('ru-RU',{timeZone:'Asia/Vladivostok'})}</time> (Амурск).</p>
      <p>Перед покупкой <Link href="/kontakty/">уточните наличие в магазине</Link>.</p>
    </>}
  </Container></main>;
}
