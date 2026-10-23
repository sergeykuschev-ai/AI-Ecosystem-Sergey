// Generated from the current public/catalog image audit (2026-10-07).
// Yandex Direct requires product-feed images to be at least 450 px on each side.
const tooSmallForYandexDirect = new Set([
  '/catalog/official/0789.webp',
  '/catalog/official/084e10f7-dad6-11ee-b40a-f198e863aac1.webp',
  '/catalog/official/087654.webp',
  '/catalog/official/088976.webp',
  '/catalog/official/08d97776-bb50-11ef-b425-ed110731e4f3.jpg',
  '/catalog/official/09877.jpg',
  '/catalog/official/1112211.webp',
  '/catalog/official/137897.webp',
  '/catalog/official/223211.webp',
  '/catalog/official/2332.webp',
  '/catalog/official/32131.webp',
  '/catalog/official/323244211.webp',
  '/catalog/official/3246675.webp',
  '/catalog/official/33421956.webp',
  '/catalog/official/3444567.webp',
  '/catalog/official/3534657.webp',
  '/catalog/official/4356.png',
  '/catalog/official/45360.webp',
  '/catalog/official/454569087.webp',
  '/catalog/official/5432311112.webp',
  '/catalog/official/5445098.webp',
  '/catalog/official/63a36c45-bb50-11ef-b425-ed110731e4f3.jpg',
  '/catalog/official/675483.webp',
  '/catalog/official/67787900.jpg',
  '/catalog/official/787532.webp',
  '/catalog/official/7c1b6caa-5341-11ed-8c25-7c8bca00854e.webp',
  '/catalog/official/83763644-bb50-11ef-b425-ed110731e4f3.jpg',
  '/catalog/official/87654.webp',
  '/catalog/official/876687.webp',
  '/catalog/official/988768798.webp',
  '/catalog/official/99889898.webp',
  '/catalog/official/9a227639-b1a0-11ed-a1a3-7c8bca00854e.png',
  '/catalog/official/BAST500NTFU.jpg',
  '/catalog/official/N019836.jpg',
  '/catalog/official/fc7e824a-136a-11ef-b412-e92179844ed4.webp',
  '/catalog/official/fcf32570-dad6-11ee-b40a-f198e863aac1.webp',
])

export function isYandexDirectPictureEligible(path: string): boolean {
  return !tooSmallForYandexDirect.has(path)
}
