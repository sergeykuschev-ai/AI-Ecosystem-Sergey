"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

type SubmitState = "idle" | "submitting" | "success" | "error";

export function AdvertisingLeadForm() {
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting") return;

    const form = event.currentTarget;
    const values = new FormData(form);
    setState("submitting");
    setErrorMessage("");

    try {
      const response = await fetch("/api/advertising-leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company: values.get("company"),
          contactName: values.get("contactName"),
          phone: values.get("phone"),
          email: values.get("email"),
          tariff: values.get("tariff"),
          message: values.get("message"),
          website: values.get("website"),
          consent: values.get("consent") === "on",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || "Не удалось отправить заявку. Попробуйте ещё раз.");
      }

      form.reset();
      setState("success");
      trackEvent("advertising_lead_submit", { source: "reklama_page" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось отправить заявку. Попробуйте ещё раз.");
      setState("error");
    }
  }

  return (
    <section className="advertising-lead" id="advertising-lead" aria-labelledby="advertising-lead-title">
      <div className="advertising-lead__intro">
        <p className="eyebrow">Заявка на размещение</p>
        <h2 id="advertising-lead-title">Запустим рекламу вашего бизнеса</h2>
        <p>
          Оставьте контакты и выберите тариф. Мы свяжемся, уточним даты и поможем с роликом.
        </p>
        <p className="advertising-lead__email">
          Можно написать напрямую:{" "}
          <a href="mailto:vozdooh.kms@yandex.ru">vozdooh.kms@yandex.ru</a>
        </p>
      </div>

      <form className="advertising-lead__form" onSubmit={handleSubmit}>
        <div className="advertising-form-grid">
          <label>
            <span>Компания или проект</span>
            <input
              name="company"
              type="text"
              maxLength={160}
              autoComplete="organization"
              required
              placeholder="Например, Автосервис Север"
            />
          </label>
          <label>
            <span>Контактное лицо</span>
            <input
              name="contactName"
              type="text"
              maxLength={120}
              autoComplete="name"
              required
              placeholder="Как к вам обращаться"
            />
          </label>
          <label>
            <span>Телефон</span>
            <input
              name="phone"
              type="tel"
              maxLength={40}
              autoComplete="tel"
              required
              inputMode="tel"
              placeholder="+7 999 000-00-00"
            />
          </label>
          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              maxLength={254}
              autoComplete="email"
              required
              placeholder="name@example.ru"
            />
          </label>
        </div>

        <label>
          <span>Тариф</span>
          <select name="tariff" defaultValue="consultation" required>
            <option value="consultation">Нужна консультация</option>
            <option value="start">Старт — 5 выходов в день · 3 000 ₽ / 30 дней</option>
            <option value="optimum">Оптимум — 10 выходов в день · 5 000 ₽ / 30 дней</option>
            <option value="maximum">Максимум — 20 выходов в день · 8 000 ₽ / 30 дней</option>
          </select>
        </label>

        <label>
          <span>Комментарий</span>
          <textarea
            name="message"
            maxLength={1200}
            rows={5}
            placeholder="Расскажите, что рекламируем, есть ли готовый ролик и когда хотите начать."
          />
        </label>

        <label className="advertising-form-honeypot" aria-hidden="true">
          <span>Сайт</span>
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>

        <label className="advertising-form-consent">
          <input name="consent" type="checkbox" required />
          <span>
            Согласен на{" "}
            <Link href="/soglasie-na-obrabotku-dannyh/" target="_blank" rel="noopener noreferrer">
              обработку персональных данных
            </Link>{" "}
            в соответствии с{" "}
            <Link href="/politika-konfidencialnosti/" target="_blank" rel="noopener noreferrer">
              политикой конфиденциальности
            </Link>.
          </span>
        </label>

        <div className="advertising-form-actions">
          <button className="button button--primary" type="submit" disabled={state === "submitting"}>
            {state === "submitting" ? "Отправляем…" : "Отправить заявку"}
          </button>
          <span>Ответим по указанным контактам.</span>
        </div>

        <div className="advertising-form-status" aria-live="polite">
          {state === "success" ? (
            <p className="advertising-form-status--success">
              Заявка отправлена. Мы получили ваши контакты и свяжемся с вами.
            </p>
          ) : null}
          {state === "error" ? (
            <p className="advertising-form-status--error">
              {errorMessage} Если ошибка повторяется, напишите на{" "}
              <a href="mailto:vozdooh.kms@yandex.ru">vozdooh.kms@yandex.ru</a>.
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
