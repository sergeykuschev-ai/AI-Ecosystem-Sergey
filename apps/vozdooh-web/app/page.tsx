import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { HeroShaderGradient } from '../components/HeroShaderGradient'
import { getCatalogRepository } from '../src/catalog/source'
import { availableLandings, landingPath } from '../src/catalog/landings'
import { catalogImage, curatorSelection, productPresentation, storefrontProducts } from '../src/catalog/presentation'
import { withValidImages } from '../src/catalog/validImages'
import { familyLabels, labelFor, roomLabels, type DemoCategory, type DemoFamily, type DemoRoom } from '../src/catalog/vocabulary'

const categories: { slug: DemoCategory; name: string; text: string; catalogCategory: string }[] = [
  { slug: 'diffusers', name: 'Диффузоры', text: 'Аромат как часть интерьера', catalogCategory: 'Диффузоры' },
  { slug: 'candles', name: 'Свечи', text: 'Для неспешных вечеров', catalogCategory: 'Свечи' },
  { slug: 'sprays', name: 'Спреи', text: 'Мгновенно изменить настроение', catalogCategory: 'Спреи для дома' },
  { slug: 'refills', name: 'Рефилы', text: 'Продлить любимый аромат', catalogCategory: 'Рефилы' },
  { slug: 'car', name: 'Для автомобиля', text: 'Знакомый аромат в дороге', catalogCategory: 'Для автомобиля' },
  { slug: 'gifts', name: 'Подарки', text: 'Внимание в каждой детали', catalogCategory: 'Подарочные наборы' },
]

const families = Object.entries(familyLabels) as [DemoFamily, string][]
const rooms = Object.entries(roomLabels) as [DemoRoom, string][]
const roomMoments: Record<DemoRoom, string> = {
  living: 'Время вместе', bedroom: 'Личное пространство', bathroom: 'Пауза среди дня',
  study: 'В своём ритме', hallway: 'С возвращением домой',
}

const money = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})


export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'VOZDOOH — парфюмерия для дома',
  description: 'VOZDOOH — коллекция ароматов для дома: диффузоры, свечи, спреи и подарочные наборы от брендов интерьерной парфюмерии.',
  alternates: { canonical: '/' },
}

export default async function Home() {
  const products = storefrontProducts(await withValidImages(await (await getCatalogRepository()).list()))
  const sellableProducts = products.filter((product) => (product.trade.stock ?? 0) > 0)
  const curated = curatorSelection(sellableProducts)
  const heroProduct = curated[0] ?? sellableProducts[0] ?? products[0] ?? null
  const heroImage = heroProduct ? catalogImage(heroProduct) : null
  const heroDisplay = heroProduct ? productPresentation(heroProduct) : null
  const categoryProducts = Object.fromEntries(categories.map((category) => [
    category.slug,
    sellableProducts.find((product) => product.trade.category === category.catalogCategory) ?? null,
  ]))
  const roomHighlights = rooms
    .map(([slug, label], index) => ({
      slug,
      label,
      index,
      product: sellableProducts.find((product) => product.editorial.room === slug) ?? null,
    }))
    .filter((item) => item.product !== null)
  const brandHighlights = availableLandings(sellableProducts, 'brand').slice(0, 6)

  return (
    <main>
      <SiteHeader />
      <section className="hero">
        <div className="heroScene" aria-hidden="true">
          <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
            <defs>
              <radialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#d9b58a" stopOpacity=".8" />
                <stop offset="45%" stopColor="#b58b60" stopOpacity=".32" />
                <stop offset="100%" stopColor="#b58b60" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="archLight" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d5b58b" />
                <stop offset="100%" stopColor="#98704d" />
              </linearGradient>
            </defs>
            <ellipse cx="1060" cy="580" rx="430" ry="330" fill="url(#heroGlow)" opacity=".55" />
            <path d="M950 730 L950 350 A160 160 0 0 1 1270 350 L1270 730 Z" fill="url(#archLight)" opacity=".75" />
            <path d="M950 730 L950 350 A160 160 0 0 1 1270 350 L1270 730 Z" fill="none" stroke="#1a120c" strokeOpacity=".35" strokeWidth="3" />
            <line x1="1110" y1="192" x2="1110" y2="730" stroke="#241708" strokeOpacity=".45" strokeWidth="6" />
            <line x1="950" y1="470" x2="1270" y2="470" stroke="#241708" strokeOpacity=".45" strokeWidth="6" />
            <rect x="0" y="730" width="1440" height="170" fill="#120b06" />
            <rect x="0" y="728" width="1440" height="2" fill="#000" opacity=".35" />
            <ellipse cx="1110" cy="734" rx="340" ry="24" fill="#b18a60" opacity=".2" />
            <g fill="#1c130c">
              <rect x="860" y="580" width="380" height="12" rx="2" />
              <rect x="880" y="592" width="10" height="138" />
              <rect x="1210" y="592" width="10" height="138" />
              <rect x="880" y="706" width="340" height="8" rx="2" opacity=".8" />
            </g>
            <g>
              <path d="M975 580 c-13 -17 -17 -40 -7 -62 c6 -13 21 -19 21 -19 c0 0 15 6 21 19 c10 22 6 45 -7 62 Z" fill="#221610" />
              <g stroke="#2a1c12" strokeWidth="3" strokeLinecap="round">
                <line x1="989" y1="505" x2="972" y2="428" />
                <line x1="989" y1="505" x2="996" y2="420" />
                <line x1="989" y1="505" x2="1014" y2="432" />
                <line x1="989" y1="505" x2="980" y2="440" />
              </g>
              <path d="M996 420 C981 382 1014 358 998 322 C986 292 1008 270 1002 244" fill="none" stroke="#cfb18d" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" />
            </g>
            <ellipse cx="1141" cy="540" rx="95" ry="85" fill="url(#heroGlow)" />
            <rect x="1130" y="512" width="22" height="68" rx="3" fill="#2a1c12" />
            <line x1="1141" y1="512" x2="1141" y2="500" stroke="#dfc5a0" strokeWidth="3" strokeLinecap="round" />
            <circle cx="1141" cy="493" r="7" fill="#ead5b4" />
            <g stroke="#150e08" strokeWidth="7" strokeLinecap="round" fill="none" opacity=".9">
              <path d="M1332 730 C1326 650 1340 600 1328 528" />
              <path d="M1330 650 C1302 620 1294 588 1298 554" />
              <path d="M1332 610 C1360 578 1368 546 1364 516" />
            </g>
          </svg>
        </div>
        <HeroShaderGradient />
        {heroProduct && heroImage && heroDisplay && (
          <Link className="heroProductShowcase" href={`/catalog/${heroProduct.editorial.slug}`} aria-label={`Открыть ${heroDisplay.title}`}>
            <Image src={heroImage} alt={heroProduct.trade.name} fill sizes="(max-width: 800px) 46vw, 28vw" priority />
            <span className="heroProductCaption">
              <small>{heroProduct.trade.brand ?? 'VOZDOOH'}</small>
              <b>{heroDisplay.title}</b>
            </span>
          </Link>
        )}
        <div className="heroText">
          <div className="eyebrow">Парфюмерия для дома</div>
          <h1>Атмосфера начинается с аромата.</h1>
          <p>Коллекция для тех, кто выбирает аромат для дома так же внимательно, как свет, музыку и текстиль.</p>
          <div className="heroActions">
            <Link className="creamButton" href="/catalog">Смотреть коллекцию</Link>
            <Link className="textLink quiet" href="/finder">Подобрать аромат →</Link>
          </div>
        </div>
        <span className="edition">CURATED HOME FRAGRANCE · 2026</span>
      </section>

      <section id="catalog" className="section sectionWhite">
        <div className="sectionHead">
          <div>
            <span className="eyebrow">Каталог</span>
            <h2>Маленькие ритуалы для дома</h2>
          </div>
          <p>От света свечи до любимого диффузора — найдите свой формат.</p>
        </div>
        <div className="categoryGrid">
          {categories.map((category, index) => {
            const product = categoryProducts[category.slug]
            const image = product ? catalogImage(product) : null
            return (
              <Link className="category" href={`/categories/${category.slug}`} key={category.slug}>
                {product && image && (
                  <span className="categoryVisual" aria-hidden="true">
                    <Image src={image} alt="" fill sizes="(max-width: 800px) 44vw, 30vw" />
                  </span>
                )}
                <span className="categoryIndex" aria-hidden="true">0{index + 1}</span>
                <h3>{category.name}</h3>
                <p>{category.text}</p>
                <b aria-hidden="true">→</b>
              </Link>
            )
          })}
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

      <section className="section editorial" aria-labelledby="selection-title">
        <div className="selectionHeading">
          <span className="eyebrow">Кураторский выбор</span>
          <h2 id="selection-title">Меньше случайного.<br /><i>Больше личного.</i></h2>
        </div>
        <div className="selectionCopy">
          <span className="selectionStatus">Из актуального наличия</span>
          <p>Четыре позиции из текущего ассортимента с подтверждёнными изображениями и редакционными данными. Без случайных товаров и неподтверждённых обещаний.</p>
          <Link className="textLink" href="/catalog">Смотреть весь каталог <span aria-hidden="true">→</span></Link>
        </div>
        {curated.length > 0 && (
          <div className="curatedGrid">
            {curated.map((product, index) => {
              const image = catalogImage(product)
              const display = productPresentation(product)
              const room = product.editorial.room ? labelFor(roomLabels, product.editorial.room) : null
              return (
                <Link className="curatedCard" href={`/catalog/${product.editorial.slug}`} key={product.trade.sku}>
                  <span className="curatedVisual">
                    {image && <Image src={image} alt={product.trade.name} fill sizes="(max-width: 800px) 50vw, 25vw" />}
                    <small aria-hidden="true">0{index + 1}</small>
                  </span>
                  <span className="curatedMeta">
                    <small>{product.trade.brand}</small>
                    <strong>{display.title}</strong>
                    <span>{[display.subtitle, room].filter(Boolean).join(' · ')}</span>
                    {product.trade.price !== null && <b>{money.format(product.trade.price)}</b>}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section className="room">
        <div className="roomIntro">
          <span className="eyebrow light">По пространству</span>
          <h2>У каждой комнаты свой характер.</h2>
          <p>Показываем только те пространства, для которых в текущем ассортименте уже есть подтверждённая редакционная подборка.</p>
        </div>
        <div className="roomLinks roomVisualGrid">
          {roomHighlights.map(({ slug, label, index, product }) => {
            if (!product) return null
            const image = catalogImage(product)
            const display = productPresentation(product)
            return (
              <Link className="roomCard roomVisualCard" href={`/catalog?room=${slug}`} key={slug}>
                {image && <span className="roomVisual"><Image src={image} alt="" fill sizes="(max-width: 800px) 42vw, 24vw" /></span>}
                <span className="roomIndex" aria-hidden="true">0{index + 1}</span>
                <div className="roomCardCopy">
                  <p>{roomMoments[slug]}</p>
                  <h3>{label}</h3>
                  <small>{product.trade.brand} · {display.title}</small>
                </div>
                <b aria-hidden="true">→</b>
              </Link>
            )
          })}
        </div>
      </section>

      <section id="brands" className="section brands">
        <span className="eyebrow">Бренды в наличии</span>
        <div className="sectionHead">
          <h2>За ароматом —<br />свой мир.</h2>
          <p>Показываем бренды через реальные позиции, которые сейчас есть в витрине VOZDOOH.</p>
        </div>
        <div className="homeBrandGrid">
          {brandHighlights.map((brand, index) => {
            const representative = brand.products[0]
            const image = representative ? catalogImage(representative) : null
            return (
              <Link className="homeBrandCard" href={landingPath('brand', brand.slug)} key={brand.slug}>
                {image && <span className="homeBrandVisual"><Image src={image} alt="" fill sizes="(max-width: 800px) 50vw, 24vw" /></span>}
                <span className="homeBrandCopy">
                  <small>0{index + 1} / {brand.products.length} поз.</small>
                  <strong>{brand.name}</strong>
                  <span>{brand.description}</span>
                  <b>Смотреть бренд →</b>
                </span>
              </Link>
            )
          })}
        </div>
        <div className="brandActions">
          <Link className="textLink" href="/brands">Все бренды →</Link>
          <Link className="textLink" href="/collections">Коллекции →</Link>
        </div>
      </section>

      <section id="about" className="manifesto">
        <span>Искусство атмосферы</span>
        <p>Мы выбираем аромат не по громкости, а по тому, <i>что он делает с пространством.</i></p>
      </section>
      <SiteFooter />
    </main>
  )
}
