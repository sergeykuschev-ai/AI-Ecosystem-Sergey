export type ClaimCategory =
  | "origin"
  | "founding"
  | "founders"
  | "philosophy"
  | "craft"
  | "materials"
  | "awards"
  | "sustainability";

export type ClaimStatus = "verified" | "needs_source";

export type BrandClaim = {
  id: string;
  category: ClaimCategory;
  /** Russian statement. For "verified" it is an assertable, sourced fact.
   *  For "needs_source" it names the topic that lacks a supporting source. */
  statement: string;
  status: ClaimStatus;
  /** Repository artifact that supports the statement. Required when verified. */
  source?: string;
};

export type Brand = {
  slug: string;
  /** Official brand name as used in the catalog. */
  name: string;
  claims: BrandClaim[];
};

export const CLAIM_CATEGORY_LABELS: Record<ClaimCategory, string> = {
  origin: "Происхождение",
  founding: "История и даты",
  founders: "Основатели",
  philosophy: "Философия бренда",
  craft: "Производство",
  materials: "Материалы и ароматы",
  awards: "Награды",
  sustainability: "Устойчивое развитие",
};
