function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().replace(/[.;,:\s]+$/g, "");
}

function sentence(value) {
  const text = clean(value);
  return text ? text + "." : "";
}

export function composeSibCatDescription({ title, composition, advantages }) {
  const parts = [sentence("Наполнитель «Сибирская кошка»: " + clean(title).replace(/^.*?наполнитель\s*/i, ""))];
  if (composition) parts.push(sentence("Состав: " + composition));
  if (advantages) {
    const first = clean(advantages).split(/[.;]/)[0];
    if (first) parts.push(sentence(first));
  }
  return parts.filter(Boolean).join(" ");
}
