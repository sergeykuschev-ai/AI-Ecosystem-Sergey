function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().replace(/[.;,:\s]+$/g, "");
}

function sentence(value) {
  const text = clean(value);
  return text ? text + "." : "";
}

function composition(source) {
  const match = String(source ?? "").match(/Состав:\s*([^.]*)/i);
  return match ? clean(match[1]) : "";
}

export function composeDerlakDescription({ title, sourceDescription, species }) {
  const pet = species === "Кошки" ? "для кошек" : species === "Собаки" ? "для собак" : "";
  const first = sentence(["Лакомство «Деревенские Лакомства»", pet, "—", clean(title).toLocaleLowerCase("ru-RU")].filter(Boolean).join(" "));
  const comp = composition(sourceDescription);
  const second = comp ? sentence("Состав: " + comp) : "";
  return [first, second].filter(Boolean).join(" ");
}
