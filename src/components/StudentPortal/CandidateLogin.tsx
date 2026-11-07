import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, ArrowRight, Lock, KeyRound, AlertCircle, Headphones, BookOpen, PenTool, Calendar, Unlock } from 'lucide-react';
import { CandidateSession, Exam, getExamSlotStartMs } from '../../types';
import { formatDateTime } from '../../utils/formatDate';

interface CandidateLoginProps {
  onLoginSuccess: (session: CandidateSession) => void;
  exam?: Exam | null;
  onGoToRegister?: () => void;
  examAccessMode?: 'closed' | 'scheduled' | 'open';
  examScheduledAt?: string | null;
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return '00:00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

export const CandidateLogin: React.FC<CandidateLoginProps> = ({
  onLoginSuccess,
  exam,
  onGoToRegister,
  examAccessMode = 'closed',
  examScheduledAt
}) => {
  const [candidateDigits, setCandidateDigits] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examPrice, setExamPrice] = useState<number | null>(null);

  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [effectiveMode, setEffectiveMode] = useState<'closed' | 'scheduled' | 'open'>(examAccessMode);
  // Slot-2 waiter: candidate verified for the second session before it starts.
  const [pendingSession, setPendingSession] = useState<CandidateSession | null>(null);
  const [slotOpensAt, setSlotOpensAt] = useState<number>(0);
  const [slotSecondsLeft, setSlotSecondsLeft] = useState<number>(0);
  const onLoginSuccessRef = useRef(onLoginSuccess);
  onLoginSuccessRef.current = onLoginSuccess;

  // Slot-2 countdown: ticks every second and lets the candidate in the
  // moment their session opens.
  useEffect(() => {
    if (!pendingSession || !slotOpensAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((slotOpensAt - Date.now()) / 1000));
      setSlotSecondsLeft(left);
      if (left <= 0) {
        const sess = pendingSession;
        setPendingSession(null);
        setSlotOpensAt(0);
        onLoginSuccessRef.current(sess);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [pendingSession, slotOpensAt]);
  // Server clock offset (serverTime - clientTime) so the countdown cannot be
  // skipped by turning the device clock forward. Falls back to client clock.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  useEffect(() => {
    fetch('/api/health', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const t = data && typeof data.time === 'string' ? new Date(data.time).getTime() : NaN;
        if (!isNaN(t)) setClockOffsetMs(t - Date.now());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && typeof data.examPriceAzn === 'number') setExamPrice(data.examPriceAzn);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { setEffectiveMode(examAccessMode); }, [examAccessMode]);

  const computeSecondsLeft = useCallback(() => {
    if (!examScheduledAt) return 0;
    return Math.max(0, Math.floor((new Date(examScheduledAt).getTime() - (Date.now() + clockOffsetMs)) / 1000));
  }, [examScheduledAt, clockOffsetMs]);

  useEffect(() => {
    if (examAccessMode !== 'scheduled' || !examScheduledAt) { setSecondsLeft(0); return; }
    setSecondsLeft(computeSecondsLeft());
    const interval = setInterval(() => {
      const remaining = computeSecondsLeft();
      setSecondsLeft(remaining);
      if (remaining <= 0) { setEffectiveMode('open'); clearInterval(interval); }
    }, 1000);
    return () => clearInterval(interval);
  }, [examAccessMode, examScheduledAt, computeSecondsLeft]);

  const handleLogin = async (idToUse?: string) => {
    let targetId: string;
    if (idToUse) {
      targetId = idToUse.toUpperCase().trim();
    } else {
      // Exact-match gate: the candidate number must be the FULL defined digits.
      // A partial entry (e.g. 34567 for IG-345678) is rejected before any lookup.
      if (!/^\d{6}$/.test(candidateDigits.trim())) {
        setError('Please enter your full 6-digit Candidate Number. Partial numbers are not accepted.');
        return;
      }
      targetId = `IG-${candidateDigits.trim()}`;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${targetId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError(`Candidate ID "${targetId}" was not found. Please verify your Candidate Number or check your registration. Note: candidate records are automatically deleted 180 days (~6 months) after the test.`);
        } else {
          const errData = await res.json().catch(() => null);
          setError(errData?.message || errData?.error || 'Server error during authentication. Please try again.');
        }
        setLoading(false);
        return;
      }
      const session: CandidateSession = await res.json();
      // Entry rule: the exam can only be taken while its own exam is active.
      // Finished sessions (completed/finalized) pass through review-only.
      const isTakingExam =
        session.status === 'registered' ||
        session.status === 'in_progress' ||
        session.status === 'hard_locked';
      if (isTakingExam) {
        if (!exam) {
          setError('There is currently no active exam. Candidate entry is paused until the proctor activates an exam.');
          setLoading(false);
          return;
        }
        if (session.examId !== exam.id) {
          const assigned = session.examTitle || session.examId;
          setError(
            `You are approved for "${assigned}", which is not the currently active exam ("${exam.title}"). ` +
            `Entry is allowed only while your own exam is active and open.`
          );
          setLoading(false);
          return;
        }
        // Two-slot days: slot-2 candidates wait for their own start time and
        // watch a countdown instead of entering early.
        if (session.examSlot === 2 && exam.examTime2) {
          const slot2Start = getExamSlotStartMs(exam, 2);
          if (slot2Start !== null && slot2Start > Date.now()) {
            setPendingSession(session);
            setSlotOpensAt(slot2Start);
            setSlotSecondsLeft(Math.max(0, Math.floor((slot2Start - Date.now()) / 1000)));
            setLoading(false);
            return;
          }
        }
      }
      onLoginSuccess(session);
    } catch {
      setError('Could not connect to exam server. Please check your network connection.');
    } finally {
      setLoading(false);
    }
  };

  // ─── CLOSED ────────────────────────────────────────────────────────────────
  if (effectiveMode === 'closed') {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex flex-col items-center justify-center py-10 px-4">
        <div className="max-w-md w-full text-center space-y-5">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-rose-50 border-2 border-rose-200 text-rose-600 shadow-sm">
            <Lock className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Exam Access Closed</h1>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed max-w-sm mx-auto">
              The examination portal is currently <strong className="text-rose-600">closed</strong>. Access will be granted by the Chief Proctor when the examination session begins.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2 text-left">
            <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
              <Shield className="w-4 h-4 text-orange-500 shrink-0" />
              <span>Please arrive at the exam center and wait for the proctor to open the session.</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
              <KeyRound className="w-4 h-4 text-orange-500 shrink-0" />
              <span>Have your Candidate ID (IG-XXXXXX) and photo ID ready for verification.</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── SCHEDULED / COUNTDOWN ─────────────────────────────────────────────────
  if (effectiveMode === 'scheduled' && secondsLeft > 0) {
    const scheduledDate = examScheduledAt ? new Date(examScheduledAt) : null;
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex flex-col items-center justify-center py-10 px-4">
        <div className="max-w-lg w-full text-center space-y-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-amber-50 border-2 border-amber-200 text-amber-600 shadow-sm">
            <Calendar className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Exam Starts Soon</h1>
            {scheduledDate && (
              <p className="text-sm text-slate-500 mt-1">
                Scheduled for <strong className="text-slate-700">{scheduledDate ? formatDateTime(scheduledDate) : ''}</strong>
              </p>
            )}
          </div>
          <div className="bg-white border-2 border-amber-200 rounded-3xl p-8 shadow-md space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600">Time Until Exam Opens</p>
            <div className="font-mono text-6xl font-black text-slate-900 tracking-tight tabular-nums">
              {formatCountdown(secondsLeft)}
            </div>
            <p className="text-xs text-slate-400">HH : MM : SS</p>
            <div className="flex items-center justify-center gap-1.5 pt-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-[11px] text-amber-700 font-semibold">Gate opens automatically when countdown reaches zero</span>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs text-left space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Shield className="w-4 h-4 text-orange-500 shrink-0" />
              <span>Please be seated and ready at your designated workstation.</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <KeyRound className="w-4 h-4 text-orange-500 shrink-0" />
              <span>Have your Candidate ID ready. The system will open automatically.</span>
            </div>
          </div>
          {onGoToRegister && exam && (
            <div className="bg-gradient-to-r from-cyan-50 via-sky-50 to-blue-50 border border-cyan-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs text-left">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-600 text-white font-black text-sm flex items-center justify-center shadow-xs shrink-0">m10</div>
                <div className="text-xs">
                  <span className="font-bold text-slate-900 block">No Candidate ID yet?</span>
                  <span className="text-slate-500 text-[11px]">Register and pay via m10 before exam day.</span>
                </div>
              </div>
              <button onClick={onGoToRegister} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer shrink-0 text-center">
                Register &amp; Pay via m10 &rarr;
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── SLOT-2 WAITER (verified early for the second session) ───────────────────
  if (pendingSession) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex flex-col items-center justify-center py-10 px-4">
        <div className="max-w-lg w-full text-center space-y-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-violet-50 border-2 border-violet-200 text-violet-600 shadow-sm">
            <Calendar className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Welcome, {pendingSession.candidateName}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              You are registered for <strong className="text-slate-700">Slot 2{exam?.examTime2 ? ` · ${exam.examTime2}` : ''}</strong>.
              Your session opens automatically when the second sitting begins.
            </p>
          </div>
          <div className="bg-white border-2 border-violet-200 rounded-3xl p-8 shadow-md space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-violet-600">Time Until Slot 2 Opens</p>
            <div className="font-mono text-6xl font-black text-slate-900 tracking-tight tabular-nums">
              {formatCountdown(slotSecondsLeft)}
            </div>
            <p className="text-xs text-slate-400">HH : MM : SS</p>
            <div className="flex items-center justify-center gap-1.5 pt-1">
              <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
              <span className="text-[11px] text-violet-700 font-semibold">You will enter automatically — please stay on this page</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setPendingSession(null); setSlotOpensAt(0); }}
            className="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  // ─── OPEN (normal login) ───────────────────────────────────────────────────
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 text-slate-800 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl mx-auto w-full">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-50 border border-orange-200 text-orange-600 mb-4 shadow-sm shadow-orange-500/10">
            <Shield className="w-7 h-7" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">IELTS Gate Examination Entry</h1>

          <div className="mt-3 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold shadow-2xs">
            <Unlock className="w-3.5 h-3.5" />
            <span>Exam session is <strong>OPEN</strong> — you may now enter</span>
          </div>

          {exam ? (
            <div className="mt-3 flex flex-col items-center gap-1.5">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-orange-50 border border-orange-200 text-orange-800 text-xs font-semibold shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
                <span>Active Exam: <strong>{exam.title || 'Official IELTS Simulation'}</strong></span>
                <span className="font-mono text-[10px] bg-orange-200/60 px-1.5 py-0.5 rounded text-orange-900">{exam.code || exam.id}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                <span>🎧 Listening</span><span>•</span><span>📖 Reading</span><span>•</span><span>✍️ Writing</span><span>•</span><span>🎙️ Speaking</span>
              </div>
            </div>
          ) : (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-center space-y-2">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-100 border border-amber-300 text-amber-900 font-bold text-xs shadow-2xs">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>'Currently, there is not an active exam'</span>
              </div>
              <p className="text-xs text-amber-800 max-w-md mx-auto leading-relaxed">
                There is currently no mock examination active. Candidate entry is temporarily paused.
              </p>
            </div>
          )}

          <p className="text-sm text-slate-600 mt-3 max-w-md mx-auto">
            Please enter your unique <strong>6-digit Candidate Number</strong>. The prefix <code>IG-</code> is automatically locked and applied.
          </p>
        </div>

        {onGoToRegister && exam && (
          <div className="mb-4 bg-gradient-to-r from-cyan-50 via-sky-50 to-blue-50 border border-cyan-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-600 text-white font-black text-sm flex items-center justify-center shadow-xs shrink-0">m10</div>
              <div className="text-left text-xs">
                <span className="font-bold text-slate-900 block">Don&apos;t have an official Candidate ID yet?</span>
                <span className="text-slate-500 text-[11px]">Fill in your candidate details, transfer {examPrice != null ? `${examPrice} AZN ` : ''}via m10, and receive instant ID confirmation.</span>
              </div>
            </div>
            <button onClick={onGoToRegister} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer shrink-0 text-center">
              Register &amp; Pay via m10 &rarr;
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm">
          <form onSubmit={e => { e.preventDefault(); handleLogin(); }} className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700">Candidate Number (Numbers Only)</label>
                <span className="text-[11px] text-orange-600 font-semibold">Fixed prefix: IG-</span>
              </div>
              <div className="relative flex rounded-xl border border-slate-300 overflow-hidden shadow-2xs focus-within:ring-4 focus-within:ring-orange-500/10 focus-within:border-orange-500 transition">
                <div className="bg-orange-50 border-r border-orange-200 px-3.5 flex items-center text-orange-700 font-mono font-bold text-base select-none shrink-0">IG-</div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={candidateDigits}
                  onChange={e => {
                    const cleanDigits = e.target.value.replace(/^ig-?/i, '').replace(/[^0-9]/g, '');
                    setCandidateDigits(cleanDigits);
                    if (error) setError(null);
                  }}
                  placeholder="123456"
                  className="w-full px-4 py-3 bg-white text-slate-900 font-mono text-base placeholder:text-slate-400 focus:outline-none"
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">Type the 6 digits only. Pasting <code>IG-XXXXXX</code> will automatically sanitize to digits.</p>
            </div>

            {error && (
              <div className="flex items-start space-x-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !exam}
              className="w-full flex items-center justify-center space-x-2 py-3.5 px-4 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold rounded-xl text-sm transition shadow-sm shadow-orange-500/25 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <span>{loading ? 'Authenticating Candidate...' : !exam ? '\'Currently, there is not an active exam\'' : 'Enter Secure Exam Session'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-3 gap-2 text-center text-[11px] text-slate-600">
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
              <Headphones className="w-4 h-4 mx-auto text-orange-600 mb-1" />
              <span className="font-medium">Audio Check</span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
              <BookOpen className="w-4 h-4 mx-auto text-amber-600 mb-1" />
              <span className="font-medium">Reading Split</span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
              <PenTool className="w-4 h-4 mx-auto text-emerald-600 mb-1" />
              <span className="font-medium">Word Counter</span>
            </div>
          </div>
          <p className="mt-4 text-center text-[11px] text-slate-400">
            Results stay available for 6 months (180 days) after your test, then records are automatically deleted.
          </p>
        </div>
      </div>
    </div>
  );
};
