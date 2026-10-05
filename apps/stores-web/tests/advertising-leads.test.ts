import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { POST } from "@/app/api/advertising-leads/route";
import {
  ADVERTISING_TARIFF_LABELS,
  parseAdvertisingLead,
  renderAdvertisingLeadEmail,
  renderArthurAdvertisingLead,
} from "@/lib/advertising/lead";

const validInput = {
  company: "Тестовая компания",
  contactName: "Иван",
  phone: "+7 999 000-00-00",
  email: "lead@example.ru",
  tariff: "optimum",
  message: "Нужен ролик",
  website: "",
  consent: true,
};

describe("advertising lead validation", () => {
  test("accepts a complete lead and normalizes values", () => {
    const result = parseAdvertisingLead(validInput, new Date("2026-10-05T10:00:00.000Z"));
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.lead.company, "Тестовая компания");
    assert.equal(result.lead.tariff, "optimum");
    assert.equal(result.lead.submittedAt, "2026-10-05T10:00:00.000Z");
  });

  test("rejects missing consent and malformed contacts", () => {
    const result = parseAdvertisingLead({
      ...validInput,
      phone: "abc",
      email: "bad-email",
      consent: false,
    });
    assert.equal(result.status, "invalid");
    if (result.status !== "invalid") return;
    assert.ok(result.fields.includes("phone"));
    assert.ok(result.fields.includes("email"));
    assert.ok(result.fields.includes("consent"));
  });

  test("silently classifies honeypot submissions as spam", () => {
    assert.equal(parseAdvertisingLead({ ...validInput, website: "https://spam.test" }).status, "spam");
  });
});

describe("advertising lead messages", () => {
  test("email and Arthur notification contain the actionable lead details", () => {
    const result = parseAdvertisingLead(validInput, new Date("2026-10-05T10:00:00.000Z"));
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;

    const mail = renderAdvertisingLeadEmail(result.lead);
    assert.match(mail.subject, /Тестовая компания/);
    assert.match(mail.text, /lead@example\.ru/);
    assert.ok(mail.text.includes(ADVERTISING_TARIFF_LABELS.optimum));

    const telegram = renderArthurAdvertisingLead(result.lead);
    assert.match(telegram, /новая заявка на рекламу/i);
    assert.match(telegram, /\+7 999 000-00-00/);
  });
});

describe("advertising lead API validation", () => {
  test("returns 422 for invalid form data without attempting delivery", async () => {
    const request = new Request("https://amurskmarket.ru/api/advertising-leads", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://amurskmarket.ru" },
      body: JSON.stringify({ company: "A" }),
    });
    const response = await POST(request);
    assert.equal(response.status, 422);
  });

  test("returns accepted for honeypot spam without attempting delivery", async () => {
    const request = new Request("https://amurskmarket.ru/api/advertising-leads", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://amurskmarket.ru" },
      body: JSON.stringify({ ...validInput, website: "spam" }),
    });
    const response = await POST(request);
    assert.equal(response.status, 202);
  });
});
