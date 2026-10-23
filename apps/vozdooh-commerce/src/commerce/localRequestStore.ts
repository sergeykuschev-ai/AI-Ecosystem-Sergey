import { mkdir, open, readFile, link, unlink, rename } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RequestError, validateStoredRequest, type OrderRequest, type OrderRequestStore } from './orderRequests'

/** Single-host POSIX storage: fsync temporary file, publish with exclusive hard link, fsync directory. */
export function localRequestStore(directory = resolve('.local/order-requests')): OrderRequestStore {
  function path(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new RequestError('INVALID_RETRY_KEY')
    return join(directory, `${key}.json`)
  }
  async function find(key: string): Promise<OrderRequest | null> {
    try {
      const record = validateStoredRequest(JSON.parse(await readFile(path(key), 'utf8')), key)
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
    async findById(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new RequestError('INVALID_REQUEST_ID')
      try {
        const names = await import('node:fs/promises').then((fs) => fs.readdir(directory))
        for (const name of names) {
          if (!name.endsWith('.json')) continue
          const key = name.slice(0, -5)
          const record = await find(key)
          if (record?.id === id) return record
        }
        return null
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async replace(request) {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const destination = path(request.input.retryKey)
      const temporary = join(directory, `.${randomUUID()}.tmp`)
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(request)); await handle.sync(); await handle.close()
        await rename(temporary, destination)
        const folder = await open(directory, 'r'); try { await folder.sync() } finally { await folder.close() }
        return request
      } catch (error) {
        try { await handle.close() } catch {}
        try { await unlink(temporary) } catch {}
        throw error
      }
    },
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
