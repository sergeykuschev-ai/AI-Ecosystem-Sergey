function normalize(value) {
  return String(value ?? "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function kind(value) {
  const text = normalize(value);
  if (/сухой корм/.test(text)) return "dry";
  if (/влажный корм|пауч|паштет/.test(text)) return "wet";
  if (/лакомств|крем-лакомств/.test(text)) return "treat";
  if (/вет.*диет|диетический корм/.test(text)) return "vet";
  return null;
}

function species(value) {
  const text = normalize(value);
  const result = new Set();
  if (/кош|котят/.test(text)) result.add("cat");
  if (/собак|щен/.test(text)) result.add("dog");
  return result;
}

function weights(value) {
  const text = normalize(value);
  const result = [];
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(кг|гр?|г)(?=\s|$|[),.;"'])/g)) {
    const number = Number(match[1].replace(",", "."));
    if (!Number.isFinite(number)) continue;
    result.push(Math.round(number * (match[2] === "кг" ? 1000 : 1) * 100) / 100);
  }
  return result;
}

export function validateOfficialMatch(localName, officialTitle) {
  const localKind = kind(localName);
  const officialKind = kind(officialTitle);
  if (localKind && officialKind && localKind !== officialKind) {
    return { ok: false, reason: `kind mismatch: ${localKind} vs ${officialKind}` };
  }

  const localSpecies = species(localName);
  const officialSpecies = species(officialTitle);
  if (localSpecies.size && officialSpecies.size) {
    const overlap = [...localSpecies].some((item) => officialSpecies.has(item));
    if (!overlap) return { ok: false, reason: "species mismatch" };
  }

  const localWeights = weights(localName);
  const officialWeights = weights(officialTitle);
  if (localWeights.length && officialWeights.length) {
    const overlap = localWeights.some((value) => officialWeights.some((other) => Math.abs(value - other) < 0.01));
    if (!overlap) return { ok: false, reason: `weight mismatch: ${localWeights.join(",")} vs ${officialWeights.join(",")}` };
  }

  if (/ассорти/.test(normalize(localName)) && !/ассорти/.test(normalize(officialTitle))) {
    return { ok: false, reason: "local assortment maps to a specific official variant" };
  }

  return { ok: true, reason: "sku + basic attributes match" };
}
