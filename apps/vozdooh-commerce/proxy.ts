import { NextResponse, type NextRequest } from 'next/server'
import { catalogPaginationPolicy } from './src/seo/catalogPolicy'
import { historicalRedirect } from './src/seo/historicalRedirects'

/** Exact historic identities and existing catalog pagination only. */
export function proxy(request: NextRequest) {
  const destination = historicalRedirect(request.nextUrl.pathname, request.method)
  // A fixed relative Location avoids forwarding query data or trusting a supplied host.
  // Use the standard Response constructor for 301 rather than redirect()'s 307/308 default.
  if (destination) return new NextResponse(null, { status: 301, headers: { Location: destination } })
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

export const config = { matcher: [
  '/catalog',
  '/kontakty.html',
  '/dostavka.html',
  '/aromaty-dlya-doma/aromaticheskie-svechi',
  '/aromaty-dlya-doma/aromaticheskie-svechi/',
  '/decor-classic-diffuzor-aramara-250ml.html',
  '/vellutier-svecha-bolshaya-vecherniy-tost-515gr-midnight-toast.html',
] }
