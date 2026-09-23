import Link from 'next/link'
import { ProductCard } from '../components/ProductCard'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { demoProducts, familyLabels, roomLabels, type DemoCategory, type DemoFamily, type DemoRoom } from '../src/catalog/demo'

const categories: { slug: DemoCategory; name: string; text: string }[] = [
  { slug: 'diffusers', name: 'Диффузоры', text: 'Аромат как часть интерьера' },
  { slug: 'candles', name: 'Свечи', text: 'Тихий свет и сложные композиции' },
  { slug: 'sprays', name: 'Спреи', text: 'Мгновенно изменить настроение' },
  { slug: 'refills', name: 'Рефилы', text: 'Продлить любимый аромат' },
  { slug: 'car', name: 'Для автомобиля', text: 'Знакомый аромат в дороге' },
  { slug: 'gifts', name: 'Подарки', text: 'Готовые знаки внимания' },
]

const families = Object.entries(familyLabels) as [DemoFamily, string][]
const rooms = Object.entries(roomLabels) as [DemoRoom, string][]

export default function Home() {
  return (
    <main>
      <SiteHeader />
      <section className="hero">
        <div className="heroText">
          <div className="eyebrow">Парфюмерия для дома</div>
          <h1>Атмосфера начинается с аромата.</h1>
          <p>Коллекция для тех, кто выбирает аромат для дома так же внимательно, как свет, музыку и текстиль.</p>
          <div className="heroActions">
            <Link className="primary" href="/catalog">Смотреть коллекцию</Link>
            <Link className="textLink quiet" href="/finder">Подобрать аромат →</Link>
          </div>
        </div>
        <div className="heroObject" aria-hidden="true">
          <div className="sticks" />
          <div className="bottle"><span>VOZDOOH</span><small>HOME FRAGRANCE</small></div>
          <div className="shadow" />
        </div>
        <span className="edition">CURATED HOME FRAGRANCE · 2026</span>
      </section>

      <section id="catalog" className="section">
        <div className="sectionHead">
          <div>
            <span className="eyebrow">Каталог</span>
            <h2>Выберите способ наполнить дом ароматом</h2>
          </div>
          <p>Начните с формата. Реальный ассортимент и наличие появятся здесь после синхронизации с 1С.</p>
        </div>
        <div className="categoryGrid">
          {categories.map((category, index) => (
            <Link className="category" href={`/catalog?category=${category.slug}`} key={category.slug}>
              <span>0{index + 1}</span>
              <h3>{category.name}</h3>
              <p>{category.text}</p>
              <b>Смотреть →</b>
            </Link>
          ))}
        </div>
      </section>

      <section id="finder" className="finder">
        <div>
          <span className="eyebrow light">Подбор аромата</span>
          <h2>Как должен ощущаться ваш дом?</h2>
          <p>Не обязательно знать ноты и парфюмерные термины. Выберите настроение — мы сузим выбор.</p>
          <Link className="creamButton" href="/finder">Подобрать аромат</Link>
        </div>
        <div className="finderOptions">
          <span>По характеру</span>
          {families.map(([slug, label], index) => (
            <Link href={`/catalog?family=${slug}`} key={slug}><em>0{index + 1}</em>{label}<b>→</b></Link>
          ))}
        </div>
      </section>

      <section className="section editorial">
        <div>
          <span className="eyebrow">Кураторский выбор</span>
          <h2>Только то, что стоит вашего пространства.</h2>
        </div>
        <div className="products">
          {demoProducts.slice(0, 4).map((product, index) => (
            <ProductCard product={product} index={index} key={product.id} />
          ))}
        </div>
      </section>

      <section className="room">
        <div>
          <span className="eyebrow light">По пространству</span>
          <h2>У каждой комнаты свой характер.</h2>
          <p>Мы подскажем интенсивность и направление аромата под назначение пространства.</p>
        </div>
        <div className="roomLinks">
          {rooms.map(([slug, label], index) => (
            <Link href={`/catalog?room=${slug}`} key={slug}><span>0{index + 1}</span>{label}<b>→</b></Link>
          ))}
        </div>
      </section>

      <section id="brands" className="section brands">
        <span className="eyebrow">Бренды и коллекции</span>
        <div className="sectionHead">
          <h2>Коллекция без компромиссов.</h2>
          <p>После импорта каталога здесь появятся только бренды, которые действительно есть в ассортименте VOZDOOH.</p>
        </div>
        <div className="brandPlaceholder">
          <Link href="/brands">REAL BRANDS FROM 1C <span>→</span></Link>
          <Link href="/collections">EDITORIAL COLLECTIONS <span>→</span></Link>
        </div>
      </section>

      <section id="about" className="manifesto">
        <span>VOZDOOH / МАНИФЕСТ</span>
        <p>Мы выбираем аромат не по громкости, а по тому, <i>что он делает с пространством.</i></p>
        <small>Интернет-магазин премиальной парфюмерии для дома</small>
      </section>
      <SiteFooter />
    </main>
  )
}
