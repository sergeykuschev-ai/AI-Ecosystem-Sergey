interface CityLabelInput {
  slug: string;
  name: string;
}

export function cityLocationLabel(city: CityLabelInput): string {
  return city.slug === "amursk" ? "Амурске" : `городе ${city.name}`;
}
