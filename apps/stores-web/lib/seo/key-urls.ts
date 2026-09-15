import { AMPER_SEO_CATEGORY_PATHS } from "@/lib/amper/seo-categories";

export const KEY_RECRAWL_PATHS = [
  "/",
  "/stores/amursk/",
  "/amper/",
  ...AMPER_SEO_CATEGORY_PATHS,
  "/ventil/",
  "/metiz-market/",
  "/miska/",
  "/kontakty/",
] as const;
