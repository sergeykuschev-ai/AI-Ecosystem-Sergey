/** Owner-verified #310 identities only. Do not decode, infer sizes, or forward queries. */
export function historicalRedirect(pathname: string, method: string): string | undefined {
  if (method !== 'GET' && method !== 'HEAD') return undefined
  switch (pathname) {
    case '/kontakty.html': return '/contacts'
    case '/dostavka.html': return '/delivery'
    case '/aromaty-dlya-doma/aromaticheskie-svechi':
    case '/aromaty-dlya-doma/aromaticheskie-svechi/': return '/categories/candles'
    case '/decor-classic-diffuzor-aramara-250ml.html': return '/catalog/culti-decor-aramara-250'
    case '/vellutier-svecha-bolshaya-vecherniy-tost-515gr-midnight-toast.html': return '/catalog/vellutier-midnight-toast-515'
    default: return undefined
  }
}
