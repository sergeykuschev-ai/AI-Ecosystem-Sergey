export const VALTA_SITE_BRANDS = {
  "FIORY": { urlTokens: ["fiory-"] },
  "Bambini Pets": { urlTokens: ["bambini-pets", "bambini-"] },
  "Flexi": { urlTokens: ["flexi-"] },
  "ISB": { urlTokens: ["isb-", "iv-san-bernard"] },
  "Titbit": { urlTokens: ["titbit-"] },
  "Tetra": { urlTokens: ["tetra"] },
  "Ranova": { urlTokens: ["ranova"] },
  "Protexin": { urlTokens: ["protexin"] },
};

export function getValtaSiteBrandConfig(brand) {
  const config = VALTA_SITE_BRANDS[brand];
  if (!config) throw new Error("unsupported Valta site brand: " + brand);
  return config;
}
