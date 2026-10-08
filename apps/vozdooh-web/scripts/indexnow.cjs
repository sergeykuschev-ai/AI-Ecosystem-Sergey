/* Submit newly created or materially changed VOZDOOH URLs to Yandex IndexNow. */
const key = 'a6bad1d47f5626833b7f2292a8d28757'
const host = 'vozdooh27.ru'
const base = `https://${host}`
const keyLocation = `${base}/${key}.txt`

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('Usage: node scripts/indexnow.cjs /path [/other-path]')
  process.exit(2)
}

const urlList = paths.map((input) => {
  const url = input.startsWith('http://') || input.startsWith('https://')
    ? new URL(input)
    : new URL(input.startsWith('/') ? input : `/${input}`, base)
  if (url.hostname !== host) throw new Error(`Refusing foreign host: ${url.hostname}`)
  return url.toString()
})

fetch('https://yandex.com/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation, urlList }),
})
  .then(async (response) => {
    const body = await response.text()
    console.log(JSON.stringify({ status: response.status, ok: response.ok, urls: urlList, body }))
    if (!response.ok && response.status !== 202) process.exitCode = 1
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
