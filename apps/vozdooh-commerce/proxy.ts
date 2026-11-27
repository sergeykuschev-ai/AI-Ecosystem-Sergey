import { NextResponse, type NextRequest } from 'next/server'
import { catalogPaginationPolicy } from './src/seo/catalogPolicy'

/** Exact legacy pages and catalog pagination only; commerce is excluded. */
export function proxy(request: NextRequest) {
  const legacy = request.nextUrl.pathname === '/kontakty.html' || request.nextUrl.pathname === '/kontakty.html/'
    ? '/contacts'
    : request.nextUrl.pathname === '/aromaty-dlya-doma/aromaticheskie-svechi' || request.nextUrl.pathname === '/aromaty-dlya-doma/aromaticheskie-svechi/'
      ? '/categories/candles' : null
  if (legacy && (request.method === 'GET' || request.method === 'HEAD')) {
    // Fixed same-origin destinations deliberately discard every legacy query.
    const response = NextResponse.redirect(new URL(legacy, request.url), 301)
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  }
  if (request.nextUrl.pathname !== '/catalog') return NextResponse.next()
  const policy = catalogPaginationPolicy(request.nextUrl.searchParams.getAll('page'))
  if (policy === 'normalize') {
    const url = request.nextUrl.clone()
    url.searchParams.delete('page')
    return NextResponse.redirect(url, 308)
  }
  if (policy === 'missing') return new NextResponse('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Страница каталога не найдена — VOZDOOH</title><body><main><h1>Страница каталога не найдена</h1><p>Все товары показаны в одном каталоге.</p><a href="/catalog">Открыть каталог VOZDOOH</a></main></body></html>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, follow', 'Cache-Control': 'no-store' } })
  return NextResponse.next()
}

export const config = { matcher: ['/catalog', '/kontakty.html', '/aromaty-dlya-doma/aromaticheskie-svechi'] }
