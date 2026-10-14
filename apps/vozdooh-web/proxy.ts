import { NextResponse, type NextRequest } from 'next/server'
import { catalogPaginationPolicy } from './src/seo/catalogPolicy'

/** Only catalog pagination is intercepted; commerce and product routes are excluded. */
export function proxy(request: NextRequest) {
  const policy = catalogPaginationPolicy(request.nextUrl.searchParams.getAll('page'))
  if (policy === 'normalize') {
    const url = request.nextUrl.clone()
    url.searchParams.delete('page')
    return NextResponse.redirect(url, 308)
  }
  if (policy === 'missing') return new NextResponse('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Страница каталога не найдена — VOZDOOH</title><body><main><h1>Страница каталога не найдена</h1><p>Все товары показаны в одном каталоге.</p><a href="/catalog">Открыть каталог VOZDOOH</a></main></body></html>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, follow', 'Cache-Control': 'no-store' } })
  return NextResponse.next()
}

export const config = { matcher: '/catalog' }
