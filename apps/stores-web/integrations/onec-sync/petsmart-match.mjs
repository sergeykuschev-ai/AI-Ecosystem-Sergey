function norm(value) {
  return String(value ?? "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function countPieces(value) {
  const text = norm(value);
  const match = text.match(/(\d+)\s*шт(?:\.|\s|$)/);
  if (match) return Number(match[1]);
  if (/(?:^|\s)по\s+шт(?:\.|\s|$)/.test(text)) return 1;
  return null;
}

function dimension(value) {
  const match = norm(value).match(/(\d+)\s*[*xх×]\s*(\d+)\s*см?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])].sort((a, b) => a - b).join("x");
}

function liters(value) {
  const match = norm(value).match(/(\d+(?:[.,]\d+)?)\s*л\b/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function aroma(value) {
  const text = norm(value);
  if (/лимон/.test(text)) return "lemon";
  if (/яблок/.test(text)) return "apple";
  if (/роз/.test(text)) return "rose";
  if (/цветоч/.test(text)) return "floral";
  if (/лаванд/.test(text)) return "lavender";
  if (/без запах/.test(text)) return "unscented";
  return null;
}

export function validatePetsmartVariant(localName, officialName) {
  const localCount = countPieces(localName);
  const officialCount = countPieces(officialName);
  if (localCount !== null && officialCount !== null && localCount !== officialCount) {
    return { ok: false, reason: "piece count mismatch: " + localCount + " vs " + officialCount };
  }

  const localDim = dimension(localName);
  const officialDim = dimension(officialName);
  if (localDim && officialDim && localDim !== officialDim) {
    return { ok: false, reason: "dimension mismatch: " + localDim + " vs " + officialDim };
  }

  const localLiters = liters(localName);
  const officialLiters = liters(officialName);
  if (localLiters !== null && officialLiters !== null && Math.abs(localLiters - officialLiters) > 0.001) {
    return { ok: false, reason: "volume mismatch: " + localLiters + " vs " + officialLiters };
  }

  const localAroma = aroma(localName);
  const officialAroma = aroma(officialName);
  if (localAroma && officialAroma && localAroma !== officialAroma) {
    return { ok: false, reason: "aroma mismatch: " + localAroma + " vs " + officialAroma };
  }

  return { ok: true, reason: "vendor_code and package attributes match" };
}
