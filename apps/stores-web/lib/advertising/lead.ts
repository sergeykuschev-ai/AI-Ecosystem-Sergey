import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import nodemailer from "nodemailer";

export const ADVERTISING_TARIFF_LABELS = {
  consultation: "Нужна консультация",
  start: "Старт — 5 выходов в день · 3 000 ₽ / 30 дней",
  optimum: "Оптимум — 10 выходов в день · 5 000 ₽ / 30 дней",
  maximum: "Максимум — 20 выходов в день · 8 000 ₽ / 30 дней",
} as const;

export type AdvertisingTariff = keyof typeof ADVERTISING_TARIFF_LABELS;

export interface AdvertisingLead {
  id: string;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  tariff: AdvertisingTariff;
  message: string;
  submittedAt: string;
}

export type AdvertisingLeadParseResult =
  | { status: "ok"; lead: AdvertisingLead }
  | { status: "spam" }
  | { status: "invalid"; fields: string[] };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\d\s-]{6,40}$/;

function trimmed(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (!result || result.length > maxLength) return null;
  return result;
}

export function parseAdvertisingLead(input: unknown, now = new Date()): AdvertisingLeadParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { status: "invalid", fields: ["form"] };
  }

  const value = input as Record<string, unknown>;
  const honeypot = typeof value.website === "string" ? value.website.trim() : "";
  if (honeypot) return { status: "spam" };

  const company = trimmed(value.company, 160);
  const contactName = trimmed(value.contactName, 120);
  const phone = trimmed(value.phone, 40);
  const email = trimmed(value.email, 254);
  const message = typeof value.message === "string" ? value.message.trim() : "";
  const tariff = typeof value.tariff === "string" && value.tariff in ADVERTISING_TARIFF_LABELS
    ? value.tariff as AdvertisingTariff
    : null;

  const fields: string[] = [];
  if (!company) fields.push("company");
  if (!contactName) fields.push("contactName");
  if (!phone || !PHONE_PATTERN.test(phone)) fields.push("phone");
  if (!email || !EMAIL_PATTERN.test(email)) fields.push("email");
  if (!tariff) fields.push("tariff");
  if (message.length > 1200) fields.push("message");
  if (value.consent !== true) fields.push("consent");

  if (fields.length) return { status: "invalid", fields };

  return {
    status: "ok",
    lead: {
      id: randomUUID(),
      company: company!,
      contactName: contactName!,
      phone: phone!,
      email: email!,
      tariff: tariff!,
      message,
      submittedAt: now.toISOString(),
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

export function renderAdvertisingLeadEmail(lead: AdvertisingLead) {
  const tariff = ADVERTISING_TARIFF_LABELS[lead.tariff];
  const text = [
    "Новая заявка на аудиорекламу — Амурск Маркет",
    "",
    `Компания: ${lead.company}`,
    `Контакт: ${lead.contactName}`,
    `Телефон: ${lead.phone}`,
    `Email: ${lead.email}`,
    `Тариф: ${tariff}`,
    ...(lead.message ? ["", "Комментарий:", lead.message] : []),
    "",
    `ID заявки: ${lead.id}`,
    `Получена: ${lead.submittedAt}`,
    "Страница: https://amurskmarket.ru/reklama/",
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5">
    <div style="max-width:680px;margin:0 auto;padding:28px 20px">
      <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#64748b">Амурск Маркет · реклама</p>
      <h1 style="font-size:24px;margin:8px 0 22px">Новая заявка на аудиорекламу</h1>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px 0;color:#64748b;width:150px">Компания</td><td style="padding:8px 0"><b>${escapeHtml(lead.company)}</b></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Контакт</td><td style="padding:8px 0">${escapeHtml(lead.contactName)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Телефон</td><td style="padding:8px 0"><a href="tel:${escapeHtml(lead.phone.replace(/[^+\d]/g, ""))}">${escapeHtml(lead.phone)}</a></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Email</td><td style="padding:8px 0"><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Тариф</td><td style="padding:8px 0">${escapeHtml(tariff)}</td></tr>
      </table>
      ${lead.message ? `<div style="margin-top:18px;padding:16px;background:#eef3f8;border-radius:10px"><b>Комментарий</b><br>${escapeHtml(lead.message).replace(/\n/g, "<br>")}</div>` : ""}
      <hr style="border:0;border-top:1px solid #dbe2e8;margin:24px 0">
      <p style="font-size:12px;color:#64748b">ID: ${escapeHtml(lead.id)}<br>Получена: ${escapeHtml(lead.submittedAt)}<br>https://amurskmarket.ru/reklama/</p>
    </div>
  </body></html>`;

  return {
    subject: `[Амурск Маркет] Новая заявка на аудиорекламу — ${lead.company}`,
    text,
    html,
  };
}

async function optionalSecret(envName: string, fileEnvName: string, env: NodeJS.ProcessEnv) {
  const direct = env[envName]?.trim();
  if (direct) return direct;
  const filename = env[fileEnvName]?.trim();
  if (!filename) return undefined;
  const value = (await readFile(filename, "utf8")).trim();
  return value || undefined;
}

export async function sendAdvertisingLeadEmail(lead: AdvertisingLead, env: NodeJS.ProcessEnv = process.env) {
  const host = env.SMTP_HOST?.trim();
  if (!host) throw new Error("ADVERTISING_SMTP_NOT_CONFIGURED");
  const port = Number(env.SMTP_PORT ?? "25");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("ADVERTISING_SMTP_PORT_INVALID");

  const user = env.SMTP_USER?.trim();
  const pass = user ? await optionalSecret("SMTP_PASSWORD", "SMTP_PASSWORD_FILE", env) : undefined;
  if (user && !pass) throw new Error("ADVERTISING_SMTP_PASSWORD_MISSING");

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: env.SMTP_SECURE === "true" || port === 465,
    ignoreTLS: env.SMTP_IGNORE_TLS === "true",
    auth: user && pass ? { user, pass } : undefined,
  });

  const message = renderAdvertisingLeadEmail(lead);
  try {
    await transport.sendMail({
      from: env.ADVERTISING_MAIL_FROM?.trim() || "Амурск Маркет <orders@vozdooh27.ru>",
      to: env.ADVERTISING_LEAD_TO?.trim() || "vozdooh.kms@yandex.ru",
      replyTo: lead.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { "X-Auto-Response-Suppress": "All" },
    });
  } finally {
    transport.close();
  }
}

export function renderArthurAdvertisingLead(lead: AdvertisingLead) {
  const tariff = ADVERTISING_TARIFF_LABELS[lead.tariff];
  return [
    "<b>Амурск Маркет · новая заявка на рекламу</b>",
    "",
    `Компания: <b>${escapeHtml(lead.company)}</b>`,
    `Контакт: ${escapeHtml(lead.contactName)}`,
    `Телефон: ${escapeHtml(lead.phone)}`,
    `Email: ${escapeHtml(lead.email)}`,
    `Тариф: ${escapeHtml(tariff)}`,
    ...(lead.message ? ["", `Комментарий: ${escapeHtml(lead.message)}`] : []),
  ].join("\n");
}

export async function sendAdvertisingLeadToArthur(lead: AdvertisingLead, env: NodeJS.ProcessEnv = process.env) {
  const url = env.ARTHUR_ADVERTISING_LEAD_URL?.trim();
  if (!url) throw new Error("ARTHUR_ADVERTISING_LEAD_NOT_CONFIGURED");
  const secret = await optionalSecret(
    "ARTHUR_ADVERTISING_LEAD_SECRET",
    "ARTHUR_ADVERTISING_LEAD_SECRET_FILE",
    env,
  );
  if (!secret) throw new Error("ARTHUR_ADVERTISING_LEAD_SECRET_MISSING");

  const payload = JSON.stringify({
    eventId: randomUUID(),
    type: "advertising_lead",
    lead: {
      id: lead.id,
      company: lead.company,
      contactName: lead.contactName,
      phone: lead.phone,
      email: lead.email,
      tariff: lead.tariff,
      tariffLabel: ADVERTISING_TARIFF_LABELS[lead.tariff],
      message: lead.message,
      submittedAt: lead.submittedAt,
      sourceUrl: "https://amurskmarket.ru/reklama/",
    },
  });
  const signature = createHmac("sha256", secret).update(payload).digest("hex");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-amurskmarket-signature": signature,
    },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`ARTHUR_ADVERTISING_LEAD_HTTP_${response.status}`);
}
