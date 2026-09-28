import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import type { Metadata } from "next";
import sitemap from "@/app/sitemap";
import * as requisitesPage from "@/app/rekvizity/page";
import * as paymentPage from "@/app/oplata/page";
import * as deliveryPage from "@/app/dostavka/page";
import * as returnsPage from "@/app/vozvrat/page";
import * as offerPage from "@/app/oferta/page";
import * as userAgreementPage from "@/app/polzovatelskoe-soglashenie/page";
import * as privacyPage from "@/app/politika-konfidencialnosti/page";
import { siteUrl } from "@/lib/seo/metadata";
import { VOZDOOH_LEGAL_NAME, VOZDOOH_MERCHANT, VOZDOOH_PENDING_REQUISITES } from "@/lib/vozdooh/merchant";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function source(...parts: string[]): string {
  return readFileSync(join(projectRoot, ...parts), "utf8");
}

function canonicalHref(metadata: Metadata): string {
  const canonical = metadata.alternates?.canonical;
  assert.ok(canonical instanceof URL, "canonical alternate must be an absolute URL");
  return canonical.href;
}

function robotsFlags(metadata: Metadata): { index?: boolean; follow?: boolean } {
  const robots = metadata.robots;
  if (typeof robots === "string" || robots == null) return {};
  return robots as { index?: boolean; follow?: boolean };
}

const INDEXABLE_CUSTOMER_PAGES = [
  { name: "/rekvizity/", metadata: requisitesPage.metadata },
  { name: "/oplata/", metadata: paymentPage.metadata },
  { name: "/dostavka/", metadata: deliveryPage.metadata },
  { name: "/vozvrat/", metadata: returnsPage.metadata },
];

const LEGAL_DRAFT_PAGES = [
  { name: "/oferta/", metadata: offerPage.metadata },
  { name: "/polzovatelskoe-soglashenie/", metadata: userAgreementPage.metadata },
  { name: "/politika-konfidencialnosti/", metadata: privacyPage.metadata },
];

describe("VOZDOOH merchant data", () => {
  test("merchant record contains only owner-verified facts", () => {
    assert.equal(VOZDOOH_MERCHANT.storeName, "VOZDOOH");
    assert.equal(VOZDOOH_LEGAL_NAME, "Индивидуальный предприниматель Кущев Сергей Васильевич");
    assert.equal(VOZDOOH_MERCHANT.email, "vozdooh.kms@yandex.ru");
    assert.equal(VOZDOOH_MERCHANT.phone, "+7 924 419-99-90");
    assert.equal(VOZDOOH_MERCHANT.phoneHref, "tel:+79244199990");
    assert.equal(VOZDOOH_MERCHANT.city, "Хабаровск");
    assert.equal(VOZDOOH_MERCHANT.country, "Россия");
  });

  test("missing legal requisites stay explicit and are never invented", () => {
    const merchantKeys = Object.keys(VOZDOOH_MERCHANT);
    for (const forbiddenKey of ["inn", "ogrnip", "legalAddress", "bankAccount"]) {
      assert.ok(!merchantKeys.includes(forbiddenKey), `merchant record must not contain ${forbiddenKey}`);
    }
    for (const required of ["ИНН", "ОГРНИП"]) {
      assert.ok(VOZDOOH_PENDING_REQUISITES.includes(required as never), `${required} must be listed as pending owner input`);
    }
    const requisitesSource = source("app", "rekvizity", "page.tsx");
    assert.match(requisitesSource, /VOZDOOH_PENDING_REQUISITES_TEXT/);
  });
});

describe("VOZDOOH compliance pages metadata", () => {
  test("customer pages are indexable and canonicalize their own routes", () => {
    const seen = new Set<string>();
    for (const { name, metadata } of INDEXABLE_CUSTOMER_PAGES) {
      assert.equal(canonicalHref(metadata), new URL(name, siteUrl).href, `canonical for ${name}`);
      assert.equal(robotsFlags(metadata).index, true, `index for ${name}`);
      assert.equal(robotsFlags(metadata).follow, true, `follow for ${name}`);
      assert.ok(metadata.title, `title for ${name}`);
      assert.ok(metadata.description, `description for ${name}`);
      assert.ok(!seen.has(name));
      seen.add(name);
    }
  });

  test("legal drafts stay noindex until the owner approves them", () => {
    for (const { name, metadata } of LEGAL_DRAFT_PAGES) {
      assert.equal(canonicalHref(metadata), new URL(name, siteUrl).href, `canonical for ${name}`);
      assert.equal(robotsFlags(metadata).index, false, `noindex for ${name}`);
      assert.equal(robotsFlags(metadata).follow, false, `nofollow for ${name}`);
    }
  });

  test("sitemap includes indexable customer pages and excludes legal drafts", async () => {
    const urls = new Set((await sitemap()).map((entry) => entry.url));
    for (const { name } of INDEXABLE_CUSTOMER_PAGES) {
      assert.ok(urls.has(new URL(name, siteUrl).href), `sitemap must include ${name}`);
    }
    for (const { name } of LEGAL_DRAFT_PAGES) {
      assert.ok(!urls.has(new URL(name, siteUrl).href), `sitemap must exclude draft ${name}`);
    }
  });
});

describe("VOZDOOH integration wording stays truthful", () => {
  test("payment page describes Ozon Bank acquiring as pending, not live", () => {
    const page = source("app", "oplata", "page.tsx");
    assert.match(page, /Ozon Банк/);
    assert.match(page, /находится на рассмотрении/);
    assert.match(page, /не списывает\s+деньги/);
    assert.match(page, /3-D Secure/);
    assert.match(page, /HTTPS/);
    assert.match(page, /антифрод/i);
    assert.ok(!page.includes("одобрен банком"), "payment page must not claim bank approval");
  });

  test("delivery page describes Ozon Delivery and Yandex delivery as pending or planned", () => {
    const page = source("app", "dostavka", "page.tsx");
    assert.match(page, /Ozon Доставк/);
    assert.match(page, /на рассмотрении/);
    assert.match(page, /Яндекс/);
    assert.match(page, /планируется/i);
    assert.ok(!page.includes("доставка подключена"), "delivery page must not claim a live integration");
  });

  test("requisites page names the seller and the country of registration", () => {
    const page = source("app", "rekvizity", "page.tsx");
    const merchant = source("lib", "vozdooh", "merchant.ts");
    assert.match(page, /VOZDOOH_LEGAL_NAME/);
    assert.match(page, /Страна регистрации/);
    assert.match(merchant, /Кущев Сергей Васильевич/);
  });
});

describe("VOZDOOH page discoverability", () => {
  test("footer links to every compliance page from the site chrome", () => {
    const footer = source("components", "layout", "Footer.tsx");
    for (const path of ["/rekvizity/", "/oplata/", "/dostavka/", "/vozvrat/", "/oferta/", "/polzovatelskoe-soglashenie/"]) {
      assert.ok(footer.includes(`href="${path}"`), `footer must link to ${path}`);
    }
  });

  test("contacts page exposes the VOZDOOH seller block", () => {
    const contacts = source("app", "kontakty", "page.tsx");
    assert.match(contacts, /Интернет-магазин VOZDOOH/);
    assert.match(contacts, /href="\/rekvizity\/"/);
  });
});
