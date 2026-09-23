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
}

function parseCart(raw: string | null): StoredCart {
  if (!raw) return EMPTY_CART
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as StoredCart).lines)) {
      return EMPTY_CART
    }
    const lines = (parsed as StoredCart).lines.filter(
      (line): line is CartLine =>
        !!line &&
        typeof line.sku === 'string' &&
        typeof line.quantity === 'number' &&
        Number.isFinite(line.quantity) &&
        line.quantity > 0,
    )
    return { lines }
  } catch {
    return EMPTY_CART
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
  const raw = window.localStorage.getItem(STORAGE_KEY)
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

export function writeCart(cart: StoredCart): void {
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
  writeCart(cart)
  return cart
}

export function setLineQuantity(sku: string, quantity: number): StoredCart {
  const cart = readCart()
  cart.lines = quantity <= 0
    ? cart.lines.filter((line) => line.sku !== sku)
    : cart.lines.map((line) => (line.sku === sku ? { ...line, quantity } : line))
  writeCart(cart)
  return cart
}

export function clearCart(): StoredCart {
  const cart: StoredCart = { lines: [] }
  writeCart(cart)
  return cart
}

export function cartItemCount(cart: StoredCart): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0)
}
