import { AMPER_SEO_CATEGORY_PATHS } from "@/lib/amper/seo-categories";
import { METIZ_SEO_CATEGORY_PATHS } from "@/lib/metiz-market/seo-categories";
import { MISKA_SEO_CATEGORY_PATHS } from "@/lib/miska/seo-categories";
import { VENTIL_SEO_CATEGORY_PATHS } from "@/lib/ventil/seo-categories";
import { KEY_RECRAWL_PATHS } from "@/lib/seo/key-urls";

export const SEO_RECRAWL_PATHS = [
  ...KEY_RECRAWL_PATHS,
  ...AMPER_SEO_CATEGORY_PATHS,
  ...VENTIL_SEO_CATEGORY_PATHS,
  ...METIZ_SEO_CATEGORY_PATHS,
  ...MISKA_SEO_CATEGORY_PATHS,
] as const;
