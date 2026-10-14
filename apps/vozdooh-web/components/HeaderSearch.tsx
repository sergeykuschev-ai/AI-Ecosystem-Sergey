'use client'

import { useRef } from 'react'

/** Native disclosure keeps the GET search usable without JavaScript. */
export function HeaderSearch({ onOpen }: { onOpen: () => void }) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  function close() {
    detailsRef.current?.removeAttribute('open')
    detailsRef.current?.querySelector('summary')?.focus()
  }
  return (
    <details className="headerSearch" ref={detailsRef} onToggle={(event) => {
      if (event.currentTarget.open) {
        onOpen()
        inputRef.current?.focus()
      }
    }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
    }}>
      <summary aria-label="Открыть поиск" aria-controls="header-search-panel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
      </summary>
      <form id="header-search-panel" action="/catalog" method="get" role="search" className="headerSearchPanel">
        <label htmlFor="header-search">Поиск по названию, бренду или артикулу</label>
        <div className="headerSearchRow">
          <input ref={inputRef} id="header-search" type="search" name="q" placeholder="Название, бренд или артикул" />
          <button className="primary" type="submit">Найти</button>
          <button className="headerSearchClose" type="button" aria-label="Закрыть поиск" onClick={close}>×</button>
        </div>
      </form>
    </details>
  )
}
