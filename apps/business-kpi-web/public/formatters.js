'use strict';

const UNAVAILABLE = 'н/д';
const NA_TEXT = 'Недостаточно данных';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
});

const compactMoneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'percent',
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0,
});

function isUnavailable(value) {
  return value === null || value === undefined || Number.isNaN(value);
}

function formatMoney(value, compact = false) {
  if (isUnavailable(value)) return UNAVAILABLE;
  return (compact ? compactMoneyFormatter : moneyFormatter).format(value);
}

function formatMoneyAxis(value) {
  if (isUnavailable(value)) return UNAVAILABLE;
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
  if (value >= 1_000_000) {
    return `${fmt(value / 1_000_000)} млн ₽`;
  }
  if (value >= 1_000) {
    return `${fmt(value / 1_000)} тыс. ₽`;
  }
  return `${fmt(value)} ₽`;
}

function formatNumber(value) {
  if (isUnavailable(value)) return UNAVAILABLE;
  return numberFormatter.format(value);
}

function formatInteger(value) {
  if (isUnavailable(value)) return UNAVAILABLE;
  return integerFormatter.format(value);
}

function formatPercent(value) {
  if (isUnavailable(value)) return UNAVAILABLE;
  return percentFormatter.format(value);
}

function formatDate(value) {
  if (!value) return UNAVAILABLE;
  const parsed = typeof value === 'string' ? value.split('-') : [];
  if (parsed.length === 3) return `${parsed[2]}.${parsed[1]}.${parsed[0]}`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return UNAVAILABLE;
  return date.toLocaleDateString('ru-RU');
}

function formatDateTime(value) {
  if (!value) return UNAVAILABLE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return UNAVAILABLE;
  return date.toLocaleString('ru-RU');
}

const UI_STATUS = Object.freeze({
  NO_DATA: { label: 'Нет данных', tone: 'empty' },
  PARTIAL: { label: 'Частичные данные', tone: 'warn' },
  COMPLETE: { label: 'Полные данные', tone: 'ok' },
});

const MONTH_STATUS = Object.freeze({
  NO_DATA: { label: 'Нет данных', tone: 'empty' },
  IN_PROGRESS: { label: 'Месяц идёт', tone: 'active' },
  CLOSED: { label: 'Закрыт', tone: 'ok' },
});

const IMPORT_STATUS = Object.freeze({
  PENDING: 'В очереди',
  VALIDATING: 'Проверка',
  IMPORTING: 'Импорт',
  RECONCILING: 'Сверка',
  COMPLETED: 'Успешно',
  FAILED: 'Ошибка',
});

function uiDataStatus(status) {
  if (!status || !UI_STATUS[status]) return { label: NA_TEXT, tone: 'empty' };
  return UI_STATUS[status];
}

function uiMonthStatus(status) {
  if (!status || !MONTH_STATUS[status]) return { label: NA_TEXT, tone: 'empty' };
  return MONTH_STATUS[status];
}

function uiImportStatus(status) {
  return IMPORT_STATUS[status] || status || UNAVAILABLE;
}

function sourceLabel(source) {
  if (source === 'excel_import') return 'Импорт из Excel';
  if (source === 'web_manual') return 'Ручной ввод';
  if (source === '1c') return '1С';
  return source || UNAVAILABLE;
}

function shiftKeyLabel(key) {
  if (key === 'morning') return 'Утро';
  if (key === 'evening') return 'Вечер';
  return 'Основная смена';
}

function kpiLabel(score, level) {
  if (isUnavailable(score)) return UNAVAILABLE;
  const levelText = level && level !== 'null' ? ` — ${level}` : '';
  return `${formatNumber(score)}${levelText}`;
}

function shortenFilename(name, maxLength = 32) {
  if (!name) return UNAVAILABLE;
  if (name.length <= maxLength) return name;
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.lastIndexOf('.'));
  const keep = Math.max(1, maxLength - extension.length - 3);
  return `${base.slice(0, keep)}…${extension}`;
}

function moneyInput(value) {
  if (value === null || value === undefined || value === '') return '';
  return Number(value).toFixed(2);
}

function percentInput(value) {
  if (value === null || value === undefined || value === '') return '';
  return Number((Number(value) * 100).toFixed(3));
}

function percentValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return NaN;
  return Math.round((parsed / 100) * 1000000) / 1000000;
}

function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UNAVAILABLE,
    NA_TEXT,
    formatMoney,
    formatMoneyAxis,
    formatNumber,
    formatInteger,
    formatPercent,
    formatDate,
    formatDateTime,
    uiDataStatus,
    uiMonthStatus,
    uiImportStatus,
    sourceLabel,
    shiftKeyLabel,
    kpiLabel,
    shortenFilename,
    moneyInput,
    percentInput,
    percentValue,
    classNames,
    isUnavailable,
  };
}
