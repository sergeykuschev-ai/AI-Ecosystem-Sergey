export function siteStructuredData(siteUrlInput: string) {
  const siteUrl = siteUrlInput.replace(/\/+$/, '')
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${siteUrl}/#website`, url: siteUrl, name: 'VOZDOOH', inLanguage: 'ru-RU' },
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'VOZDOOH',
        legalName: 'ИП Кущев Сергей Васильевич',
        url: siteUrl,
        sameAs: ['https://www.instagram.com/vozdooh.dv/'],
        telephone: '+79244199990',
        email: 'vozdooh.kms@yandex.ru',
        taxID: '270393428446',
        areaServed: [
          { '@type': 'City', name: 'Хабаровск' },
          { '@type': 'Country', name: 'Россия' },
        ],
        identifier: { '@type': 'PropertyValue', propertyID: 'ОГРНИП', value: '322270000003316' },
        address: {
          '@type': 'PostalAddress',
          addressCountry: 'RU',
          addressLocality: 'Хабаровск',
          streetAddress: 'ул. Павла Морозова, 97',
        },
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer service',
          telephone: '+79244199990',
          email: 'vozdooh.kms@yandex.ru',
          availableLanguage: ['ru'],
        },
      },
    ],
  } as const
}

export function serializeSiteStructuredData(siteUrl: string) {
  return JSON.stringify(siteStructuredData(siteUrl)).replace(/</g, '\\u003c')
}
