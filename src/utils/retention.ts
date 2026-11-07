/** Registrations live for this many days, then the nightly cleanup deletes
 *  them (mirrors REGISTRATION_RETENTION_DAYS in src/server/apiHandler.ts —
 *  keep the two in sync). Live bookings are always exempt (see below). */
export const REGISTRATION_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function examDayStart(examDate?: string | null): number | null {
  if (!examDate) return null;
  const t = examDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!t) return null;
  const ms = new Date(parseInt(t[1], 10), parseInt(t[2], 10) - 1, parseInt(t[3], 10)).getTime();
  return isNaN(ms) ? null : ms;
}

/**
 * True when a registration must be kept visible (and kept in the database).
 * - Bookings for today/future exams are ALWAYS live, however long ago they
 *   were submitted (advance bookings must survive).
 * - Otherwise the 7-day window applies: submitted within the last 7 days, or
 *   exam date within the last 7 days.
 * - Rows with no usable dates stay visible; the purge additionally requires a
 *   valid old date before deleting anything.
 */
export function isRecentRegistration(
  submittedAt?: string | null,
  examDate?: string | null,
  nowMs = Date.now()
): boolean {
  const examDay = examDayStart(examDate);
  if (examDay !== null) {
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    if (examDay >= today.getTime()) return true; // today/future exam: live booking
    if (nowMs - examDay < REGISTRATION_WINDOW_DAYS * DAY_MS) return true; // recent exam history
    return false;
  }
  if (!submittedAt) return true;
  const s = new Date(submittedAt).getTime();
  if (isNaN(s)) return true;
  return nowMs - s < REGISTRATION_WINDOW_DAYS * DAY_MS;
}
