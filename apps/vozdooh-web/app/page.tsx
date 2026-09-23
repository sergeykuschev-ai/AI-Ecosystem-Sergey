import Link from 'next/link'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { familyLabels, roomLabels, type DemoCategory, type DemoFamily, type DemoRoom } from '../src/catalog/vocabulary'

const categories: { slug: DemoCategory; name: string; text: string }[] = [
  { slug: 'diffusers', name: 'Диффузоры', text: 'Аромат как часть интерьера' },
  { slug: 'candles', name: 'Свечи', text: 'Для неспешных вечеров' },
  { slug: 'sprays', name: 'Спреи', text: 'Мгновенно изменить настроение' },
  { slug: 'refills', name: 'Рефилы', text: 'Продлить любимый аромат' },
  { slug: 'car', name: 'Для автомобиля', text: 'Знакомый аромат в дороге' },
  { slug: 'gifts', name: 'Подарки', text: 'Внимание в каждой детали' },
]

const families = Object.entries(familyLabels) as [DemoFamily, string][]
const rooms = Object.entries(roomLabels) as [DemoRoom, string][]
const roomMoments: Record<DemoRoom, string> = {
  living: 'Время вместе', bedroom: 'Личное пространство', bathroom: 'Пауза среди дня',
  study: 'В своём ритме', hallway: 'С возвращением домой',
}

export default function Home() {
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
          {categories.map((category, index) => (
            <Link className="category" href={`/catalog?category=${category.slug}`} key={category.slug}>
              <span className="categoryIndex" aria-hidden="true">0{index + 1}</span>
              <h3>{category.name}</h3>
              <p>{category.text}</p>
              <b aria-hidden="true">→</b>
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

      <section className="section editorial" aria-labelledby="selection-title">
        <div className="selectionHeading">
          <span className="eyebrow">Кураторский выбор</span>
          <h2 id="selection-title">Меньше случайного.<br /><i>Больше личного.</i></h2>
        </div>
        <div className="selectionCopy">
          <span className="selectionStatus">Искусство выбирать</span>
          <p>В основе выбора VOZDOOH — внимание к пространству и вашим привычкам. Для нас аромат — личная деталь дома: важны характер, уместность и удовольствие от повседневного ритуала.</p>
          <Link className="textLink" href="/finder">Начать со своего настроения <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="room">
        <div>
          <span className="eyebrow light">По пространству</span>
          <h2>У каждой комнаты свой характер.</h2>
          <p>Начните с места, где хочется задержаться.</p>
        </div>
        <div className="roomLinks">
          {rooms.map(([slug, label], index) => (
            <Link className="roomCard" href={`/catalog?room=${slug}`} key={slug}>
              <span className="roomIndex" aria-hidden="true">0{index + 1}</span>
              <div><p>{roomMoments[slug]}</p><h3>{label}</h3></div>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </div>
      </section>

      <section id="brands" className="section brands">
        <span className="eyebrow">Бренды и коллекции</span>
        <div className="sectionHead">
          <h2>За ароматом —<br />свой мир.</h2>
          <p>Два взгляда на выбор аромата: через почерк создателя и через настроение пространства.</p>
        </div>
        <div className="brandPlaceholder">
          <Link href="/brands"><div><small>01 / Почерк</small><h3>Бренды</h3><p>Имена и подход к созданию ароматов</p></div><span aria-hidden="true">→</span></Link>
          <Link href="/collections"><div><small>02 / Настроение</small><h3>Коллекции</h3><p>Подборки вокруг настроения и пространства</p></div><span aria-hidden="true">→</span></Link>
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
