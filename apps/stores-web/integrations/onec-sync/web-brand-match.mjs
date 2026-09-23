
function norm(value) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9.,]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function weights(value) {
  const result = [];
  for (const match of norm(value).matchAll(/(\d+(?:[.,]\d+)?)\s*(кг|гр|г)(?=\s|$|[),.;"\'])/g)) {
    const n = Number(match[1].replace(",", "."));
    if (Number.isFinite(n)) result.push(Math.round(n * (match[2] === "кг" ? 1000 : 1) * 10) / 10);
  }
  return [...new Set(result)];
}

function species(value) {
  const text = norm(value);
  const s = new Set();
  if (/кош|котят|котов/.test(text)) s.add("cat");
  if (/собак|щен/.test(text)) s.add("dog");
  return s;
}

function kind(value) {
  const text = norm(value);
  if (/пауч|влажн|кусочки|ломтики|желе|соус/.test(text)) return "wet";
  if (/сух|рацион/.test(text)) return "dry";
  return null;
}

const SIGNALS = [
  "говядин","печен","индейк","потрош","ягнен","бурый рис","рис","цыплен",
  "куриц","утк","анчоус","кревет","малина","лосос","черник","клюкв","морков",
  "кролик","овощ","три мяса","мясной рацион","стерилиз","кастр","чувств",
  "котят","щен","мелк пород","сред пород","крупн пород","домашн","активн",
];

function signalHits(value) {
  const text = norm(value);
  return SIGNALS.filter((signal) => text.includes(signal));
}

function overlap(a, b) {
  return a.filter((item) => b.includes(item)).length;
}

const FLAVOR_SIGNALS = [
  "говядин","печен","индейк","потрош","ягнен","бурый рис","рис","цыплен",
  "куриц","утк","анчоус","кревет","малина","лосос","черник","клюкв","морков",
  "кролик","овощ",
];

function strictIdentityCheck(localName, candidate) {
  const local = norm(localName);
  const source = norm([candidate.title, candidate.pageTitle, candidate.description, candidate.matchText].join(" "));
  const sourceTitle = norm(candidate.title);

  for (const line of ["wow", "menu", "monoprotein"]) {
    if (local.includes(line) && !sourceTitle.includes(line)) return "product-line-mismatch";
  }

  const localFlavors = FLAVOR_SIGNALS.filter((signal) => local.includes(signal));
  const sourceFlavors = FLAVOR_SIGNALS.filter((signal) => source.includes(signal));
  if (localFlavors.length && overlap(localFlavors, sourceFlavors) < localFlavors.length) return "flavor-mismatch";

  const sizes = ["мелк пород", "сред пород", "крупн пород"];
  const localSize = sizes.find((signal) => local.includes(signal));
  const sourceSize = sizes.find((signal) => source.includes(signal));
  if (localSize && sourceSize && localSize !== sourceSize) return "breed-size-mismatch";

  for (const stage of ["щен", "котят", "чувств"]) {
    if (local.includes(stage) && !source.includes(stage)) return "life-stage-mismatch";
  }
  if ((local.includes("стерилиз") || local.includes("кастр")) && !(source.includes("стерилиз") || source.includes("кастр"))) {
    return "life-stage-mismatch";
  }
  return null;
}

export function scoreWebBrandMatch(localName, candidate) {
  const text = [candidate.title, candidate.description, candidate.matchText].join(" ");
  const strictFailure = strictIdentityCheck(localName, candidate);
  if (strictFailure) return { score: -100, reasons: [strictFailure] };
  let score = 0;
  const reasons = [];

  const lw = weights(localName);
  const cw = weights(text);
  if (lw.length && cw.length) {
    if (lw.some((a) => cw.some((b) => Math.abs(a - b) < 0.1))) {
      score += 45; reasons.push("weight");
    } else {
      return { score: -100, reasons: ["weight-mismatch"] };
    }
  }

  const ls = species(localName);
  const cs = species(text);
  if (ls.size && cs.size) {
    const ok = [...ls].some((x) => cs.has(x));
    if (!ok) return { score: -100, reasons: ["species-mismatch"] };
    score += 22; reasons.push("species");
  }

  const lk = kind(localName);
  const ck = kind(text);
  if (lk && ck) {
    if (lk !== ck) return { score: -100, reasons: ["kind-mismatch"] };
    score += 12; reasons.push("kind");
  }

  const la = signalHits(localName);
  const ca = signalHits(text);
  const common = overlap(la, ca);
  score += common * 8;
  if (common) reasons.push("signals:" + common);

  const local = norm(localName).replace(/\bновый\b/g, "").trim();
  const candidateText = norm(text);
  for (const token of local.split(" ").filter((x) => x.length >= 5)) {
    if (candidateText.includes(token)) score += 1;
  }

  return { score, reasons };
}

export function matchWebBrandProduct(localProduct, candidates, { threshold = 70, margin = 10 } = {}) {
  const localIdentity = [localProduct.name, localProduct.site_category].filter(Boolean).join(" ");
  const ranked = candidates
    .map((candidate) => ({ candidate, ...scoreWebBrandMatch(localIdentity, candidate) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];

  if (!best || best.score < threshold) {
    return { ok: false, reason: "low-score", bestScore: best?.score ?? null, secondScore: second?.score ?? null, best: best?.candidate ?? null };
  }
  if (second && best.score - second.score < margin) {
    return { ok: false, reason: "ambiguous", bestScore: best.score, secondScore: second.score, best: best.candidate };
  }
  return { ok: true, score: best.score, candidate: best.candidate, reasons: best.reasons };
}
