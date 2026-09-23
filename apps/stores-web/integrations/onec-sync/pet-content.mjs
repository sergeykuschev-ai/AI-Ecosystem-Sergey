function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function ensurePeriod(value) {
  const text = normalizeSpaces(value).replace(/[.;,:\s]+$/g, "");
  return text ? text + "." : "";
}

function baseSentence(title) {
  const clean = normalizeSpaces(title)
    .replace(/^Сухой корм\s+/i, "Сухой рацион ")
    .replace(/^Влажный корм\s+/i, "Влажный рацион ");
  return ensurePeriod(clean);
}

const SAFE_FEATURES = [
  [/монопротеин/i, "Монопротеиновая формула"],
  [/без (?:содержания )?(?:зерна|зерновых).*глютен|беззернов/i, "Без зерновых и глютена"],
  [/без сои/i, "Без сои"],
  [/без (?:[^.]*[,;] )?искусствен[^.]*красител/i, "Без искусственных красителей"],
  [/без [^.]*усилител[^.]*вкус/i, "Без усилителей вкуса"],
  [/пробиот[^.]*пребиот|пребиот[^.]*пробиот/i, "Содержит пробиотики и пребиотики"],
  [/пребиот/i, "Содержит пребиотики"],
  [/пробиот/i, "Содержит пробиотики"],
  [/таурин/i, "Содержит таурин"],
  [/омега[- ]?3|омега[- ]?6|полиненасыщенн/i, "Содержит полезные жирные кислоты"],
  [/клетчатк/i, "Содержит клетчатку"],
  [/клюкв/i, "С клюквой"],
  [/тыкв/i, "С тыквой"],
  [/брокколи/i, "С брокколи"],
  [/брусник/i, "С брусникой"],
  [/яблок/i, "С яблоком"],
  [/без красител[^.]*консервант|без консервант[^.]*красител/i, "Без красителей и консервантов"],
];

export function composePetProductDescription({ title, sourceDescription, siteCategory }) {
  const source = normalizeSpaces(sourceDescription);
  const features = [];
  for (const [pattern, text] of SAFE_FEATURES) {
    if (pattern.test(source) && !features.includes(text)) features.push(text);
  }

  const first = baseSentence(title);
  const second = features.length ? ensurePeriod(features.slice(0, 3).join(". ")) : "";
  const caution = siteCategory === "Ветеринарные диеты"
    ? "Ветеринарный рацион применяйте по рекомендации ветеринарного специалиста."
    : "";
  return [first, second, caution].filter(Boolean).join(" ");
}
