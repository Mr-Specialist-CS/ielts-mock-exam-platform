import React, { useState } from 'react';
import { formatDateLong } from '../utils/formatDate';

/** Parse DD/MM/YYYY (or D/M/YYYY) into ISO YYYY-MM-DD. Null when invalid. */
export function dmyToIso(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(y, mo - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}`;
}

/** Parse either ISO YYYY-MM-DD or DD/MM/YYYY into ISO. Null when invalid. */
export function anyToIso(input: string): string | null {
  const t = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T00:00:00`);
    return isNaN(d.getTime()) ? null : t;
  }
  return dmyToIso(t);
}

/** ISO YYYY-MM-DD (or DD/MM/YYYY passthrough) → display DD/MM/YYYY. */
export function isoToDmy(input?: string | null): string {
  if (!input) return '';
  const t = input.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const p = (n: string) => n.padStart(2, '0');
    return `${p(dmy[1])}/${p(dmy[2])}/${dmy[3]}`;
  }
  return t;
}

interface DateFieldProps {
  /** Stored value: ISO for exams, DD/MM/YYYY text for profiles. */
  value?: string;
  onChange: (value: string | undefined) => void;
  /** 'iso' stores YYYY-MM-DD (exams); 'dmy' stores DD/MM/YYYY text (profiles). */
  outputFormat?: 'iso' | 'dmy';
  className?: string;
}

/**
 * Date input that always displays and accepts DD/MM/YYYY (never the
 * browser-locale native picker), with a long-form preview (13 Sep 2026).
 */
export const DateField: React.FC<DateFieldProps> = ({
  value,
  onChange,
  outputFormat = 'iso',
  className
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);

  const committed = outputFormat === 'iso' ? isoToDmy(value) : (value || '').trim();
  const shown = draft ?? committed;

  const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

  /** Specific explanation for a rejected value (Feb 29 outside leap years). */
  const rejectionReason = (text: string): string => {
    const m = text.trim().match(/^29\/0?2\/(\d{4})$/);
    if (m && !isLeapYear(parseInt(m[1], 10))) {
      return `29 Feb ${m[1]} does not exist — ${m[1]} is not a leap year (February has 28 days).`;
    }
    return 'Enter a real date as DD/MM/YYYY (e.g. 13/09/2026).';
  };

  const commit = (text: string): boolean => {
    const iso = anyToIso(text);
    if (!iso) return false;
    onChange(outputFormat === 'iso' ? iso : isoToDmy(iso));
    return true;
  };

  const handleChange = (text: string) => {
    // Allow only digits and slashes, max 10 chars (DD/MM/YYYY).
    const cleaned = text.replace(/[^\d/]/g, '').slice(0, 10);
    setDraft(cleaned);
    setInvalidMsg(null);
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
      if (commit(cleaned)) {
        setDraft(null);
      } else {
        setInvalidMsg(rejectionReason(cleaned));
      }
    }
  };

  const handleBlur = () => {
    if (draft === null || draft === '') {
      setDraft(null);
      setInvalidMsg(null);
      if (draft === '') onChange(undefined);
      return;
    }
    if (!commit(draft)) {
      setInvalidMsg(rejectionReason(draft));
      setDraft(null);
    } else {
      setDraft(null);
      setInvalidMsg(null);
    }
  };

  // Long-form preview of the committed value.
  let previewIso: string | null = null;
  if (draft === null && committed) {
    previewIso = outputFormat === 'iso'
      ? (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? (value as string) : null)
      : dmyToIso(committed);
  }

  return (
    <div>
      <input
        type="text"
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        value={shown}
        onChange={e => handleChange(e.target.value)}
        onBlur={handleBlur}
        className={className || 'w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-orange-500'}
      />
      {invalidMsg && (
        <p className="text-[11px] text-rose-600 font-medium mt-1">{invalidMsg}</p>
      )}
      {!invalidMsg && previewIso && (
        <p className="text-[11px] text-slate-500 mt-1">{formatDateLong(`${previewIso}T00:00:00`)}</p>
      )}
    </div>
  );
};
