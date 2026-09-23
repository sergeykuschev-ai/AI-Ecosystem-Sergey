'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BrandLogo } from './BrandLogo'
import { CartLink } from './CartLink'

const navLinks = [
  { href: '/catalog', label: 'Каталог' },
  { href: '/finder', label: 'Подобрать аромат' },
  { href: '/brands', label: 'Бренды' },
  { href: '/collections', label: 'Коллекции' },
  { href: '/#about', label: 'О нас' },
]

export function SiteHeader() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [openPathname, setOpenPathname] = useState(pathname)
  const navRef = useRef<HTMLElement>(null)

  if (openPathname !== pathname) {
    setOpenPathname(pathname)
    setMenuOpen(false)
  }

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    navRef.current?.querySelector('a')?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  return (
    <header className="header">
      <button
        type="button"
        className="menuTrigger"
        aria-expanded={menuOpen}
        aria-controls="siteNav"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="menuTriggerLines" aria-hidden="true"><i /><i /></span>
        <span className="menuTriggerLabel">{menuOpen ? 'Закрыть' : 'Меню'}</span>
      </button>
      <BrandLogo />
      <nav
        className={`siteNav${menuOpen ? ' open' : ''}`}
        id="siteNav"
        aria-label="Основная навигация"
        ref={navRef}
      >
        {navLinks.map((link) => (
          <Link href={link.href} key={link.href} onClick={() => setMenuOpen(false)}>{link.label}</Link>
        ))}
      </nav>
      <div className="actions">
        <CartLink />
      </div>
    </header>
  )
}
