// Verified owner-supplied data for the VOZDOOH online store (issue #190,
// owner input dated 28.09.2026). Do not add INN, OGRNIP, registration
// address, bank details, delivery prices or timeframes here until the owner
// provides them; expose such gaps explicitly instead of inventing values.

export interface VozdoohMerchant {
  storeName: string;
  legalForm: string;
  fullName: string;
  email: string;
  phone: string;
  phoneHref: string;
  city: string;
  country: string;
}

export const VOZDOOH_MERCHANT: VozdoohMerchant = {
  storeName: "VOZDOOH",
  legalForm: "Индивидуальный предприниматель",
  fullName: "Кущев Сергей Васильевич",
  email: "vozdooh.kms@yandex.ru",
  phone: "+7 924 419-99-90",
  phoneHref: "tel:+79244199990",
  city: "Хабаровск",
  country: "Россия",
};

export const VOZDOOH_LEGAL_NAME = `${VOZDOOH_MERCHANT.legalForm} ${VOZDOOH_MERCHANT.fullName}`;

// Requisites the owner has not supplied yet. They must be published before
// the store starts selling and before Ozon Bank completing compliance review.
export const VOZDOOH_PENDING_REQUISITES = [
  "ИНН",
  "ОГРНИП",
  "Юридический адрес регистрации",
  "Расчётные реквизиты (банк, счёт)",
] as const;

export const VOZDOOH_PENDING_REQUISITES_TEXT =
  "Полные реквизиты продавца (ИНН, ОГРНИП, адрес регистрации, расчётные реквизиты) будут опубликованы на этой странице до начала продаж.";
