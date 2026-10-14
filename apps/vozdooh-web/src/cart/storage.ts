'use client'

import type { CartLine } from '../commerce/contracts'

/**
 * Client-side persistent cart backed by localStorage.
 * Lines reference SKUs from the selected catalog. Missing SKUs stay visible
 * for removal after source changes; checkout and totals remain disabled.
 */

const STORAGE_KEY = 'vozdooh-cart-v1'
const EMPTY_CART: StoredCart = { lines: [] }

export type StoredCart = {
  lines: CartLine[]
  paymentSnapshots?: Record<string, { requestId?: string; lines: (CartLine & { remaining: number })[]; cleaned?: boolean }>
}

function parseCart(raw: string | null): StoredCart {
  if (!raw) return { lines: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as StoredCart).lines)) {
      return { lines: [] }
    }
    const lines = (parsed as StoredCart).lines.filter(
      (line): line is CartLine =>
        !!line &&
        typeof line.sku === 'string' &&
        typeof line.quantity === 'number' &&
        Number.isFinite(line.quantity) &&
        line.quantity > 0,
    )
    const paymentSnapshots = (parsed as StoredCart).paymentSnapshots
    // Invalid metadata disables automatic cleanup, never broadens it.
    const validSnapshots = paymentSnapshots && typeof paymentSnapshots === 'object' && Object.values(paymentSnapshots).every((snapshot) =>
      snapshot && Array.isArray(snapshot.lines) && snapshot.lines.every((line) => line && typeof line.sku === 'string' && Number.isSafeInteger(line.quantity) && line.quantity > 0 && Number.isSafeInteger(line.remaining) && line.remaining >= 0 && line.remaining <= line.quantity))
    return validSnapshots ? { lines, paymentSnapshots } : { lines }
  } catch {
    return { lines: [] }
  }
}

export function readCart(): StoredCart {
  if (typeof window === 'undefined') return EMPTY_CART
  return parseCart(window.localStorage.getItem(STORAGE_KEY))
}

/** Stable snapshot helpers for useSyncExternalStore. */
let snapshotCache: { raw: string | null; cart: StoredCart } | null = null

export function getServerCartSnapshot(): StoredCart {
  return EMPTY_CART
}

export function getCartSnapshot(): StoredCart {
  if (typeof window === 'undefined') return EMPTY_CART
  let raw: string | null
  try { raw = window.localStorage.getItem(STORAGE_KEY) } catch { return snapshotCache?.cart ?? EMPTY_CART }
  if (snapshotCache && snapshotCache.raw === raw) return snapshotCache.cart
  const cart = parseCart(raw)
  snapshotCache = { raw, cart }
  return cart
}

export function subscribeCart(callback: () => void): () => void {
  window.addEventListener('vozdooh-cart-changed', callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener('vozdooh-cart-changed', callback)
    window.removeEventListener('storage', callback)
  }
}

function persistCart(cart: StoredCart): void {
  if (typeof window === 'undefined') return
  const raw = JSON.stringify(cart)
  window.localStorage.setItem(STORAGE_KEY, raw)
  snapshotCache = { raw, cart }
  window.dispatchEvent(new CustomEvent('vozdooh-cart-changed'))
}

export function addLine(sku: string, quantity = 1): StoredCart {
  const cart = readCart()
  const existing = cart.lines.find((line) => line.sku === sku)
  if (existing) {
    existing.quantity += quantity
  } else {
    cart.lines.push({ sku, quantity })
  }
  persistCart(cart)
  return cart
}

/** Reductions consume original units first; later additions never become eligible. */
function reduceSnapshots(cart: StoredCart, sku: string, removed: number): void {
  for (const snapshot of Object.values(cart.paymentSnapshots ?? {})) {
    for (const line of snapshot.lines) {
      if (line.sku === sku) line.remaining = Math.max(0, line.remaining - removed)
    }
  }
}

export function writeCart(cart: StoredCart): void {
  // Arbitrary replacements cannot establish provenance. Preserve receipts but
  // disable cleanup for old snapshots rather than removing potentially new units.
  const previous = readCart()
  for (const line of previous.lines) reduceSnapshots(previous, line.sku, line.quantity)
  persistCart({ lines: cart.lines, paymentSnapshots: previous.paymentSnapshots })
}

export function setLineQuantity(sku: string, quantity: number): StoredCart {
  const cart = readCart()
  const previous = cart.lines.find((line) => line.sku === sku)?.quantity ?? 0
  reduceSnapshots(cart, sku, Math.max(0, previous - Math.max(0, quantity)))
  cart.lines = quantity <= 0
    ? cart.lines.filter((line) => line.sku !== sku)
    : cart.lines.map((line) => (line.sku === sku ? { ...line, quantity } : line))
  persistCart(cart)
  return cart
}

export function clearCart(): StoredCart {
  const cart = readCart()
  for (const line of cart.lines) reduceSnapshots(cart, line.sku, line.quantity)
  cart.lines = []
  persistCart(cart)
  return cart
}

/** Capture before the asynchronous submission; persist no contact or price data. */
export function capturePaymentCart(attemptKey: string, lines: CartLine[]): void {
  const cart = readCart()
  cart.paymentSnapshots ??= {}
  if (cart.paymentSnapshots[attemptKey]) return
  cart.paymentSnapshots[attemptKey] = { lines: lines.map((line) => ({ sku: line.sku, quantity: line.quantity, remaining: Math.min(line.quantity, cart.lines.find((current) => current.sku === line.sku)?.quantity ?? 0) })) }
  persistCart(cart)
}

/** A retry must use its first snapshot, even after an unknown submission result. */
export function selectPaymentCartAttempt(capturedKey: string, attemptKey: string): void {
  if (capturedKey === attemptKey) return
  const cart = readCart()
  // A legacy retry with no original snapshot cannot prove unit ownership.
  if (cart.paymentSnapshots) delete cart.paymentSnapshots[capturedKey]
  persistCart(cart)
}

export function bindPaymentCart(attemptKey: string, requestId: string): void {
  const cart = readCart()
  if (Object.values(cart.paymentSnapshots ?? {}).some((entry) => entry.requestId === requestId)) return
  const snapshot = cart.paymentSnapshots?.[attemptKey]
  if (!snapshot || (snapshot.requestId && snapshot.requestId !== requestId)) return
  snapshot.requestId = requestId
  persistCart(cart)
}

/** Call only with server-verified paid items. Cart update and receipt are one write. */
export function removePaidCartItems(requestId: string, items: { id: string; quantity: number }[]): boolean {
  const cart = readCart()
  const snapshot = Object.values(cart.paymentSnapshots ?? {}).find((entry) => entry.requestId === requestId)
  if (!snapshot) return true // Legacy / other browser: no evidence, preserve cart.
  if (snapshot.cleaned) return true
  if (items.length !== snapshot.lines.length || new Set(items.map((item) => item.id)).size !== items.length || !snapshot.lines.every((line) => items.some((item) => item.id === line.sku && item.quantity === line.quantity))) return false
  for (const line of snapshot.lines) {
    const current = cart.lines.find((entry) => entry.sku === line.sku)
    const removed = Math.min(current?.quantity ?? 0, line.remaining)
    if (current) current.quantity -= removed
    reduceSnapshots(cart, line.sku, removed)
  }
  cart.lines = cart.lines.filter((line) => line.quantity > 0)
  snapshot.cleaned = true
  persistCart(cart)
  return true
}

/** Pending receipts are safe to recheck after Ozon returns to any storefront page.
 * Never use cart SKUs alone as proof of payment.
 */
export function pendingPaymentRequestIds(): string[] {
  let cart: StoredCart
  try { cart = readCart() } catch { return [] }
  return [...new Set(Object.values(cart.paymentSnapshots ?? {})
    .filter((entry) => !entry.cleaned && entry.lines.some((line) => line.remaining > 0))
    .map((entry) => entry.requestId)
    .filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 12)
}

export function cartItemCount(cart: StoredCart): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0)
}
