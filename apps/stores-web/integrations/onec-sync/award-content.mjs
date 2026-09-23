function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function ensurePeriod(value) {
  const text = normalizeSpaces(value).replace(/[.;,:\s]+$/g, "");
  return text ? text + "." : "";
}

function baseSentence(title) {
  const clean = normalizeSpaces(title)
    .replace(/^Сухой корм AWARD\s+/i, "Сухой рацион AWARD ")
    .replace(/^Влажный корм AWARD\s+/i, "Влажный рацион AWARD ")
    .replace(/^Диетический корм AWARD\s+/i, "Диетический рацион AWARD ")
    .replace(/^Вет(?:еринарная)?\s*диета AWARD\s+/i, "Ветеринарный рацион AWARD ");
  return ensurePeriod(clean);
}

const SAFE_FEATURES = [
  [/монопротеин/i, "Монопротеиновая формула"],
  [/без (?:содержания )?(?:зерна|зерновых).*глютен|беззернов/i, "Без зерновых и глютена"],
  [/пробиот[^.]*пребиот|пребиот[^.]*пробиот/i, "Содержит пробиотики и пребиотики"],
  [/таурин/i, "Содержит таурин"],
  [/полиненасыщенн/i, "С полиненасыщенными жирными кислотами"],
  [/клюкв/i, "С клюквой"],
  [/тыкв/i, "С тыквой"],
  [/брокколи/i, "С брокколи"],
  [/брусник/i, "С брусникой"],
  [/яблок/i, "С яблоком"],
  [/без красител[^.]*консервант|без консервант[^.]*красител/i, "Без красителей и консервантов"],
];

export function composeAwardDescription({ title, sourceDescription, siteCategory }) {
  const source = normalizeSpaces(sourceDescription);
  const features = [];
  for (const [pattern, text] of SAFE_FEATURES) {
    if (pattern.test(source) && !features.includes(text)) features.push(text);
  }

  const first = baseSentence(title);
  const featureSentence = features.length ? ensurePeriod(features.slice(0, 3).join(". ")) : "";
  const caution = siteCategory === "Ветеринарные диеты"
    ? "Ветеринарный рацион применяйте по рекомендации ветеринарного специалиста."
    : "";
  return [first, featureSentence, caution].filter(Boolean).join(" ");
}
