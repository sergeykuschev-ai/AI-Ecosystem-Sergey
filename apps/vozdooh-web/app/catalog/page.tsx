import Link from 'next/link'
import { demoProducts } from '../../src/catalog/demo'

const filters=['Категория','Бренд','Характер','Помещение','Объём','Наличие']

export default function CatalogPage(){
  return <main className="catalogPage">
    <header className="subHeader"><Link className="logo" href="/">VOZDOOH</Link><Link href="/cart">Корзина</Link></header>
    <section className="catalogIntro"><span className="eyebrow">Каталог</span><h1>Ароматы для пространства</h1><p>Структура каталога готова к реальным данным из 1С. До импорта здесь используются только технические placeholders.</p></section>
    <div className="filterBar">{filters.map(x=><button key={x}>{x}<span>＋</span></button>)}</div>
    <section className="catalogGrid">{demoProducts.map((p,i)=><Link className="catalogCard" href={'/catalog/'+p.slug} key={p.id}><div className={'catalogVisual p'+i}/><span>PLACEHOLDER</span><h2>{p.name}</h2><p>Цена и наличие — после синхронизации с 1С</p></Link>)}</section>
  </main>
}
