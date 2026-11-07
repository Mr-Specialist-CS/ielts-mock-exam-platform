import React, { useState, useEffect } from 'react';
import { formatDateLong } from '../../utils/formatDate';
import { isRecentRegistration } from '../../utils/retention';
import {
  Calendar,
  RefreshCw,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { ExamRegistrationRequest, CandidateSession, MAX_REGISTRATIONS_PER_DATE } from '../../types';
import { getAdminAuthHeaders } from '../../utils/adminAuth';

interface ExamDateCapacityViewProps {
  /** Full candidate roster — sessions registered directly from Candidates &
   *  Lockdown (no registrationId) count toward the per-date limit. */
  sessions: CandidateSession[];
}

/**
 * Standalone "By Exam Date" dashboard tab: every exam day with the number of
 * ALL users on it — m10 registration requests PLUS admin-registered
 * candidates — against the 125/day limit.
 *
 * Sessions issued by approving a request carry that request's registrationId
 * and are excluded (counting them again would double-count).
 */
export const ExamDateCapacityView: React.FC<ExamDateCapacityViewProps> = ({
  sessions
}) => {
  const [registrations, setRegistrations] = useState<ExamRegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // Exam dates by exam id — backfills registrations saved before their exam
  // was dated (those would otherwise sit forever under "No date").
  const [examDateById, setExamDateById] = useState<Record<string, string>>({});
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/registrations', {
        headers: { ...getAdminAuthHeaders() }
      });
      if (res.ok) {
        const data = await res.json();
        setRegistrations(data);
      }
    } catch (e) {
      console.error('Failed to load registrations:', e);
    } finally {
      setLoading(false);
    }
    try {
      const examsRes = await fetch('/api/exams', { cache: 'no-store' });
      if (examsRes.ok) {
        const examsData = await examsRes.json();
        if (Array.isArray(examsData)) {
          const map: Record<string, string> = {};
          examsData.forEach((e: any) => {
            if (e && e.id && typeof e.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.examDate)) {
              map[e.id] = e.examDate;
            }
          });
          setExamDateById(map);
        }
      }
    } catch (e) {
      console.error('Failed to load exam dates:', e);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Last 7 days only — but bookings for today/future exams always stay
  // (advance bookings must survive). Older history is deleted nightly.
  // Missing exam dates resolve from the exam itself (backfill for bookings
  // made before their exam was dated).
  const examDateOf = (r: ExamRegistrationRequest): string | undefined =>
    r.examDate || examDateById[r.examId] || undefined;
  const recentRegistrations = registrations.filter(r => isRecentRegistration(r.submittedAt, examDateOf(r)));
  const examDateOfSession = (s: CandidateSession): string | undefined =>
    examDateById[s.examId] || undefined;
  const adminSessions = sessions.filter(s => !s.registrationId);

  const groups = new Map<string, { regs: ExamRegistrationRequest[]; admin: CandidateSession[] }>();
  const bucket = (key: string) => {
    if (!groups.has(key)) groups.set(key, { regs: [], admin: [] });
    return groups.get(key)!;
  };
  recentRegistrations.forEach(r => bucket(examDateOf(r) || 'No date').regs.push(r));
  adminSessions.forEach(s => bucket(examDateOfSession(s) || 'No date').admin.push(s));
  const sorted = Array.from(groups.entries()).sort((a, b) => {
    if (a[0] === 'No date') return 1;
    if (b[0] === 'No date') return -1;
    return a[0].localeCompare(b[0]);
  });

  const totalUsers = sorted.reduce(
    (n, [, g]) => n + g.regs.filter(r => r.status !== 'rejected').length + g.admin.length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600 shadow-sm shadow-violet-500/10">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              Users by Exam Date
            </h2>
            <p className="text-xs text-slate-500 max-w-2xl">
              Every exam day with <strong>all</strong> users on it — m10 registration requests <strong>plus</strong> candidates
              registered directly from Candidates &amp; Lockdown — against the limit of{' '}
              <strong>{MAX_REGISTRATIONS_PER_DATE}/day</strong>. Rejected requests free their slot.
            </p>
          </div>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh List</span>
        </button>
      </div>

      {/* Totals ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Exam Days Tracked</span>
          <span className="text-xl font-black text-slate-800 font-mono mt-0.5 block">{sorted.length}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Users (all dates)</span>
          <span className="text-xl font-black text-slate-800 font-mono mt-0.5 block">{totalUsers}</span>
        </div>
        <div className="bg-cyan-50/60 p-4 rounded-xl border border-cyan-200/80 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-cyan-700 block tracking-wider">Admin-Added Candidates</span>
          <span className="text-xl font-black text-cyan-800 font-mono mt-0.5 block">{adminSessions.length}</span>
        </div>
      </div>

      {/* Per-date capacity panel */}
      {sorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
          <Calendar className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-700">No users for any exam date yet</h3>
          <p className="text-xs text-slate-400">Registration requests and admin-registered candidates will appear here grouped by exam day.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-2">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
            Users by Exam Date <span className="normal-case font-medium text-slate-400">(requests + admin-registered candidates · limit {MAX_REGISTRATIONS_PER_DATE}/day)</span>
          </span>
          {sorted.map(([date, g]) => {
            const active = g.regs.filter(r => r.status !== 'rejected').length + g.admin.length;
            const pending = g.regs.filter(r => r.status === 'pending').length;
            const approved = g.regs.filter(r => r.status === 'approved').length;
            const pct = date === 'No date' ? 0 : Math.min(100, Math.round((active / MAX_REGISTRATIONS_PER_DATE) * 100));
            const isFull = date !== 'No date' && active >= MAX_REGISTRATIONS_PER_DATE;
            const expanded = !!expandedDates[date];
            return (
              <div key={date} className="py-2 border-b border-slate-100 last:border-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <button
                    onClick={() => setExpandedDates(prev => ({ ...prev, [date]: !prev[date] }))}
                    className="font-mono text-xs font-bold text-slate-800 sm:w-28 shrink-0 text-left flex items-center gap-1 cursor-pointer hover:text-cyan-700"
                    title="Show users on this date"
                  >
                    {expanded ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                    <span>{date === 'No date' ? date : formatDateLong(date)}</span>
                  </button>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isFull ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-xs font-mono font-bold shrink-0 ${isFull ? 'text-rose-600' : 'text-slate-700'}`}>
                    {date === 'No date' ? `${active} (no cap)` : `${active}/${MAX_REGISTRATIONS_PER_DATE}${isFull ? ' FULL' : ''}`}
                  </span>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    {approved} approved · {pending} pending · {g.admin.length} admin-added
                  </span>
                </div>
                {expanded && (
                  <div className="mt-2 ml-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {g.regs.map(r => (
                      <div key={r.id} className="flex items-center gap-2 text-[11px] bg-slate-50 border border-slate-200/70 rounded-lg px-2 py-1">
                        <span className="font-mono font-bold text-slate-700 truncate">{r.candidateName}</span>
                        <span className="font-mono text-slate-400 shrink-0">{r.id}</span>
                        <span className={`ml-auto font-bold shrink-0 ${r.status === 'approved' ? 'text-emerald-600' : r.status === 'pending' ? 'text-amber-600' : 'text-rose-500'}`}>{r.status}</span>
                      </div>
                    ))}
                    {g.admin.map(s => (
                      <div key={s.candidateId} className="flex items-center gap-2 text-[11px] bg-cyan-50/60 border border-cyan-200/70 rounded-lg px-2 py-1">
                        <span className="font-mono font-bold text-slate-700 truncate">{s.candidateName}</span>
                        <span className="font-mono text-slate-400 shrink-0">{s.candidateId}</span>
                        <span className="ml-auto font-bold text-cyan-700 shrink-0">admin-added</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
