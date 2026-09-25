import { mkdir, open, readFile, link, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RequestError, type OrderRequest, type OrderRequestStore } from './orderRequests'

/** Single-host POSIX storage: fsync temporary file, publish with exclusive hard link, fsync directory. */
export function localRequestStore(directory = resolve('.local/order-requests')): OrderRequestStore {
  function path(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new RequestError('INVALID_RETRY_KEY')
    return join(directory, `${key}.json`)
  }
  async function find(key: string): Promise<OrderRequest | null> {
    try {
      const record = JSON.parse(await readFile(path(key), 'utf8')) as OrderRequest
      if (record.version !== 1 || record.input.retryKey !== key || !record.id || !record.fingerprint || !Number.isSafeInteger(record.totalMinor)) throw new Error('CORRUPT_REQUEST_STORE')
      const folder = await open(directory, 'r')
      try { await folder.sync() } finally { await folder.close() }
      return record
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  return {
    find,
    async save(request) {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const temporary = join(directory, `.${randomUUID()}.tmp`)
      const handle = await open(temporary, 'wx', 0o600)
      try {
        try {
          await handle.writeFile(JSON.stringify(request))
          await handle.sync()
        } finally { await handle.close() }
        try { await link(temporary, path(request.input.retryKey)) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          const existing = await find(request.input.retryKey)
          if (!existing || existing.fingerprint !== request.fingerprint) throw new RequestError('RETRY_CONFLICT', 409)
          // Sync even on retries: a previous writer may have lost its response before fsync.
          const folder = await open(directory, 'r')
          try { await folder.sync() } finally { await folder.close() }
          return existing
        }
        const folder = await open(directory, 'r')
        try { await folder.sync() } finally { await folder.close() }
        return request
      } finally { await unlink(temporary) }
    },
  }
}
