/* Submit changed VOZDOOH URLs via the official shared IndexNow endpoint. */
const key = 'a6bad1d47f5626833b7f2292a8d28757'
const host = 'vozdooh27.ru'
const base = `https://${host}`
const keyLocation = `${base}/${key}.txt`

async function urlsFromSitemap() {
  const response = await fetch(`${base}/sitemap.xml`)
  if (!response.ok) throw new Error(`Sitemap fetch failed: ${response.status}`)
  const xml = await response.text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
}

async function main() {
  const inputs = process.argv.slice(2)
  if (inputs.length === 0) {
    console.error('Usage: node scripts/indexnow.cjs /path [/other-path] | --sitemap')
    process.exit(2)
  }

  const candidates = inputs.includes('--sitemap')
    ? await urlsFromSitemap()
    : inputs

  const urlList = [...new Set(candidates.map((input) => {
    const url = input.startsWith('http://') || input.startsWith('https://')
      ? new URL(input)
      : new URL(input.startsWith('/') ? input : `/${input}`, base)
    if (url.hostname !== host) throw new Error(`Refusing foreign host: ${url.hostname}`)
    return url.toString()
  }))]

  if (urlList.length > 10000) throw new Error(`IndexNow URL limit exceeded: ${urlList.length}`)

  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation, urlList }),
  })
  const body = await response.text()
  console.log(JSON.stringify({ status: response.status, ok: response.ok, count: urlList.length, body }))
  if (!response.ok && response.status !== 202) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
