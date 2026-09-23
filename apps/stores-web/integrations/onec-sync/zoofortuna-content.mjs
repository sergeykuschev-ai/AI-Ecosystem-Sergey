function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().replace(/[.;,:\s]+$/g, "");
}

function sentence(value) {
  const text = clean(value);
  return text ? text + "." : "";
}

function measurement(source, label) {
  const match = source.match(new RegExp(label + "\\s*(\\d+(?:[.,]\\d+)?)\\s*см", "i"));
  return match ? match[1].replace(".", ",") + " см" : null;
}

export function composeZooFortunaDescription({ title, sourceDescription }) {
  const source = clean(sourceDescription);
  const facts = [];
  const back = measurement(source, "длина спины");
  const neck = measurement(source, "обхват шеи");
  const chest = measurement(source, "обхват груди");
  const waist = measurement(source, "обхват талии");

  const sizes = [];
  if (back) sizes.push("длина спины — " + back);
  if (neck) sizes.push("шея — " + neck);
  if (chest) sizes.push("грудь — " + chest);
  if (waist) sizes.push("талия — " + waist);
  if (sizes.length) facts.push("Размер: " + sizes.join(", "));

  if (/флис/i.test(source)) facts.push("Подкладка из флиса");
  if (/светоотражающ/i.test(source)) facts.push("Есть светоотражающие элементы");
  if (/молни/i.test(source)) facts.push("Застёжка на молнию");
  if (/произведено в россии/i.test(source)) facts.push("Произведено в России");

  return [sentence(title), facts.slice(0, 4).map(sentence).join(" ")].filter(Boolean).join(" ");
}
