export const VALTA_BRANDS = {
  "AWARD": { sitemapUrl: "https://awardpetfood.ru/sitemap/product.xml" },
  "Мнямс": { sitemapUrl: "https://mnyams.ru/sitemap/product.xml" },
  "Craftia": { sitemapUrl: "https://craftia.pet/sitemap/product.xml" },
  "Cat's Choice": { sitemapUrl: "https://catschoice.ru/sitemap/product.xml" },
  "Mr.Kranch": { sitemapUrl: "https://mrkranch.ru/sitemap/product.xml" },
};

export function getValtaBrandConfig(brand) {
  const config = VALTA_BRANDS[brand];
  if (!config) throw new Error(`unsupported official source brand: ${brand}`);
  return config;
}
