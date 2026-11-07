const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(input?: string | number | Date | null): Date | null {
  if (input === undefined || input === null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Compact numeric form: 12/09/2026 (DD/MM/YYYY). */
export function formatDateNumeric(input?: string | number | Date | null): string {
  const d = toDate(input);
  if (!d) return '—';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Display form with month name: 12 Sep 2026. */
export function formatDateLong(input?: string | number | Date | null): string {
  const d = toDate(input);
  if (!d) return '—';
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Display form with time: 12 Sep 2026, 21:35. */
export function formatDateTime(input?: string | number | Date | null): string {
  const d = toDate(input);
  if (!d) return '—';
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
