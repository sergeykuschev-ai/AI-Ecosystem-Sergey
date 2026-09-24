export const EKOPROM_BRANDS = {
  "Inspector": { url: "https://ekoprom.org/brands/neoterica/inspector/" },
  "Unitabs": { url: "https://ekoprom.org/brands/neoterica/unitabs/" },
  "Relaxivet": { url: "https://ekoprom.org/brands/neoterica/relaxivet/" },
  "Cliny": { url: "https://ekoprom.org/brands/neoterica/cliny/" },
  "Animal Play": { url: "https://ekoprom.org/brands/ekoprom/animal-play/" },
  "Альпийские луга": { url: "https://ekoprom.org/brands/ekoprom/alpiiskie-luga/" },
  "Green Fort Neo": { url: "https://ekoprom.org/brands/neoterica/greenfort/" },
};

export function getEkopromBrandConfig(brand) {
  const config = EKOPROM_BRANDS[brand];
  if (!config) throw new Error("unsupported Ekoprom brand: " + brand);
  return config;
}
