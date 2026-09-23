'use client'

import type { CatalogProduct } from '../src/catalog/contracts'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { categoryLabels, familyLabels, moodLabels, roomLabels } from '../src/catalog/vocabulary'

type GroupKey = 'family' | 'mood' | 'room' | 'category'

type Selection = Record<GroupKey, string | null>

const groups: { key: GroupKey; step: string; title: string; options: Record<string, string> }[] = [
  { key: 'family', step: '01', title: 'Характер аромата', options: familyLabels },
  { key: 'mood', step: '02', title: 'Настроение', options: moodLabels },
  { key: 'room', step: '03', title: 'Помещение', options: roomLabels },
  { key: 'category', step: '04', title: 'Формат', options: categoryLabels },
]

export function ScentFinder({ products, demo }: { products: CatalogProduct[]; demo: boolean }) {
  const [selection, setSelection] = useState<Selection>({ family: null, mood: null, room: null, category: null })

  const visibleGroups = groups.map((group) => group.key === 'category' && !demo ? { ...group, options: Object.fromEntries(products.map((product) => [product.trade.category, product.trade.category])) } : group)

  const matched = useMemo(
    () => products.filter((product) => {
      if (selection.family && product.editorial.scentFamily !== selection.family) return false
      if (selection.mood && product.editorial.mood !== selection.mood) return false
      if (selection.room && product.editorial.room !== selection.room) return false
      if (selection.category && product.trade.category !== selection.category) return false
      return true
    }),
    [selection, products],
  )

  const resultHref = useMemo(() => {
    const params = new URLSearchParams()
    for (const { key } of groups) {
      const value = selection[key]
      if (value) params.set(key, value)
    }
    const query = params.toString()
    return query ? `/catalog?${query}` : '/catalog'
  }, [selection])

  const toggle = (key: GroupKey, value: string) => {
    setSelection((current) => ({ ...current, [key]: current[key] === value ? null : value }))
  }

  return (
    <div className="finderQuiz">
      {visibleGroups.map(({ key, step, title, options }) => (
        <div className="quizGroup" key={key}>
          <b>{step} · {title}</b>
          <div className="quizOptions">
            {Object.entries(options).map(([value, label]) => (
              <button
                type="button"
                className={`quizOption${selection[key] === value ? ' selected' : ''}`}
                onClick={() => toggle(key, value)}
                aria-pressed={selection[key] === value}
                key={value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="quizResult">
        <p>
          {!demo ? `Найдено внутренних тестовых позиций: ${matched.length}.` : matched.length > 0
            ? `Под выбранные критерии сейчас попадает ${matched.length} демонстрационных позиций.`
            : 'Под выбранные критерии демонстрационных позиций нет — попробуйте смягчить условия.'}
        </p>
        <Link className="creamButton" href={resultHref}>Показать в каталоге →</Link>
        <button type="button" className="quizOption" onClick={() => setSelection({ family: null, mood: null, room: null, category: null })}>
          Сбросить
        </button>
      </div>
    </div>
  )
}
