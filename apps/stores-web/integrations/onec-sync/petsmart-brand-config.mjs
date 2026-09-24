export const PETSMART_BRANDS = {
  "Savanna": {
    pages: [
      "https://petsmart.ru/xabarovsk/brands/209-savanna",
      "https://petsmart.ru/xabarovsk/brands/209-savanna?page=2",
    ],
  },
  "Мистер Напкин": {
    pages: [
      "https://petsmart.ru/xabarovsk/brands/368-mister-napkin",
      "https://petsmart.ru/xabarovsk/brands/368-mister-napkin?page=2",
    ],
  },
};

export function getPetsmartBrandConfig(brand) {
  const config = PETSMART_BRANDS[brand];
  if (!config) throw new Error("unsupported Petsmart brand: " + brand);
  return config;
}
