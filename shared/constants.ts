// Спільні константи для сервера та інтерфейсу.

export const REQUEST_STATUS = {
  NEW: 'Нова',
  IN_PROGRESS: 'В роботі',
  DONE: 'Виконано',
  REWORK: 'На доопрацюванні',
  CANCELLED: 'Скасовано',
} as const;
export type RequestStatus = keyof typeof REQUEST_STATUS;

export const ITEM_STATUS = {
  IN_PROGRESS: 'В роботі',
  IN_TRANSIT: 'В дорозі',
  DONE: 'Виконано',
} as const;
export type ItemStatus = keyof typeof ITEM_STATUS;

export const REQUEST_TYPE = {
  PLANNED: 'Планова',
  URGENT: 'Термінова',
} as const;
export type RequestType = keyof typeof REQUEST_TYPE;

export const TRANSPORT_STATUS = {
  NEW: 'Нова',
  IN_PROGRESS: 'В роботі',
  CAR_ASSIGNED: 'Авто призначено',
  LOADED: 'Завантажено',
  DONE: 'Виконано',
  REWORK: 'На доопрацюванні',
  CANCELLED: 'Скасовано',
} as const;
export type TransportStatus = keyof typeof TRANSPORT_STATUS;

/** '2026-11-20T09:30' → '20.11.2026 09:30' */
export function formatLocalDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return String(s);
  return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

/** Поточний локальний час у форматі datetime-local: 'YYYY-MM-DDTHH:mm'. */
export function localNow(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const UNITS =['шт', 'упак', 'рулон', 'пара', 'л', 'кг', 'м', 'мішок', 'комплект', 'ящик'];

const MONTHS = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];

/** '2026-11' → 'Листопад 2026' */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${MONTHS[m - 1]} ${y}`;
}

/** Поточний місяць + 12 наступних. */
export function monthOptions(from = new Date()): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i <= 12; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: monthLabel(value) });
  }
  return out;
}

export const PHONE_RE = /^\+380\d{9}$/;

export function formatPhone(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.length !== 12) return p;
  return `+${d.slice(0, 3)} (${d.slice(3, 5)}) ${d.slice(5, 8)}-${d.slice(8, 10)}-${d.slice(10, 12)}`;
}
