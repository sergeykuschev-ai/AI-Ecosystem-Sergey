import type { TradeProduct } from './contracts'

/** Approved starter translations from the storefront brief (2026-09-24), plus the
 * CULTI Tessuto binding confirmed by the checked-in demand research
 * (research/demand-priority-2026-09.md: «Ткань» подтверждается текстом Candlesbox).
 * Bindings checked against the current staged catalog; no fuzzy or cross-brand lookup.
 * Keep translations here, separate from trade data and JSX.
 */
export const confirmedProductTranslations = [
  {
    "original": "ORO",
    "russian": "Золото",
    "brands": ["TEATRO Fragranze Uniche", "TEATRO"],
    "products": [
      {
        "sku": "ORO100STFU",
        "name": "TEATRO Рум-спрей для дома ORO / Золото Luxury collection, 100 мл"
      },
      {
        "sku": "ORO500RTFU",
        "name": "TEATRO Рефилл для диффузора ORO / Золото Luxury collection, 500 мл"
      },
      {
        "sku": "ORO250TFU",
        "name": "TEATRO Диффузор с палочками ORO / Золото Luxury collection, 250 мл"
      },
      {
        "sku": "ORO500TFU",
        "name": "TEATRO Диффузор с палочками ORO / Золото Luxury collection, 500 мл"
      },
      {
        "sku": "OROGUN500TFU.23",
        "name": "TEATRO Рум-спрей GUN для дома ORO / Золото Luxury Collection, 500 мл"
      }
    ]
  },
  {
    "original": "LOVE",
    "russian": "Любовь",
    "brands": ["TEATRO Fragranze Uniche", "TEATRO"],
    "products": [
      {
        "sku": "LO250TFU",
        "name": "TEATRO Диффузор с палочками LOVE Luxury collection, 250 мл"
      },
      {
        "sku": "LO500TFU",
        "name": "TEATRO Диффузор с палочками LOVE Luxury collection, 500 мл"
      },
      {
        "sku": "0878676",
        "name": "TEATRO Рефилл для диффузора LOVE Luxury collection, 500 мл"
      },
      {
        "sku": "CAPP-LOTFU",
        "name": "TEATRO Подарочный набор в шляпной коробке LOVE Luxury (Диффузор с палочками 250 мл + рефилл 250 мл)"
      }
    ]
  },
  {
    "original": "DOLCE VANIGLIA",
    "russian": "Сладкая ваниль",
    "brands": ["TEATRO Fragranze Uniche", "TEATRO"],
    "products": [
      {
        "sku": "DV250TFU",
        "name": "TEATRO Диффузор с палочками DOLCE VANIGLIA / Сладкая ваниль, 250 мл"
      },
      {
        "sku": "655467",
        "name": "TEATRO Диффузор с палочками DOLCE VANIGLIA / Сладкая ваниль, 500 мл"
      },
      {
        "sku": "DV500RTFU",
        "name": "TEATRO Рефилл для диффузора DOLCE VANIGLIA / Сладкая ваниль, 500 мл"
      }
    ]
  },
  {
    "original": "FOGLIE DI FICO",
    "russian": "Листья инжира",
    "brands": ["TEATRO Fragranze Uniche", "TEATRO"],
    "products": [
      {
        "sku": "FF250TFU",
        "name": "TEATRO Диффузор с палочками FOGLIE DI FICO / Листья инжира, 250 мл"
      }
    ]
  },
  {
    "original": "VENTO DI MARE",
    "russian": "Морской ветер",
    "brands": ["TEATRO Fragranze Uniche", "TEATRO"],
    "products": [
      {
        "sku": "VM250TFU",
        "name": "TEATRO Диффузор с палочками VENTO DI MARE / Морской ветер, 250 мл"
      }
    ]
  },
  {
    "original": "ROSE OUD",
    "russian": "Роза и уд",
    "brands": ["TEATRO Fragranze Uniche", "TEATRO"],
    "products": [
      {
        "sku": "ROU250TFU",
        "name": "TEATRO Диффузор с палочками ROSE OUD / Роза & Уд Luxury collection, 250 мл"
      },
      {
        "sku": "ROU500TFU",
        "name": "TEATRO Диффузор с палочками ROSE OUD / Роза & Уд Luxury collection, 500 мл"
      },
      {
        "sku": "ROU500RTFU",
        "name": "TEATRO Рефилл для диффузора ROSE OUD / Роза & Уд Luxury collection, 500 мл"
      },
      {
        "sku": "CAND-ROU180",
        "name": "TEATRO Ароматическая свеча ROSE OUD / Роза & Уд Luxury Сollection, 180 г"
      }
    ]
  },
  {
    "original": "Tessuto",
    "russian": "Ткань",
    "brands": ["CULTI MILANO"],
    "products": [
      {
        "sku": "df29d346-d192-11ec-be83-7c8bca00854e",
        "name": "Stile Classic диффузор Tessuto 250мл"
      }
    ]
  }
] as const

/** Both source name and SKU must still match the reviewed product within the entry's brands. */
export function confirmedProductTranslation(trade: TradeProduct) {
  return confirmedProductTranslations.find((entry) =>
    (entry.brands as readonly string[]).includes(trade.brand ?? '') &&
    entry.products.some((product) => product.sku === trade.sku && product.name === trade.name),
  ) ?? null
}
