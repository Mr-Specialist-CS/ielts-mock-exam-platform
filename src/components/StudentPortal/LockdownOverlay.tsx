import React, { useEffect, useState } from 'react';
import { ShieldAlert, AlertTriangle, RefreshCw, Lock, CheckCircle2, ShieldCheck, Maximize2, Headphones, Sparkles, User, KeyRound } from 'lucide-react';
import { CandidateSession } from '../../types';
import { CandidateAvatar } from '../CandidateAvatar';

interface LockdownOverlayProps {
  session: CandidateSession;
  onViolationReported: (updatedSession: CandidateSession) => void;
  onCheckStatus: () => Promise<void>;
  isExamActive: boolean;
  isTerminalLocked?: boolean;
  onUnlockTerminal?: () => void;
}

export const LockdownOverlay: React.FC<LockdownOverlayProps> = ({
  session,
  onViolationReported,
  onCheckStatus,
  isExamActive,
  isTerminalLocked = false,
  onUnlockTerminal
}) => {
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [isCheckingUnlock, setIsCheckingUnlock] = useState(false);

  // Detect window blur / tab visibility change
  useEffect(() => {
    if (!isExamActive || session.status === 'completed' || session.status === 'finalized') {
      return;
    }

    let lastViolationTime = 0;

    const handleDefocus = async (reason: string) => {
      const now = Date.now();
      // Debounce events firing within 3 seconds of each other
      if (now - lastViolationTime < 3000) return;
      lastViolationTime = now;

      try {
        const res = await fetch(`/api/sessions/${session.candidateId}/lock-violation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason })
        });
        if (res.ok) {
          const data = await res.json();
          onViolationReported(data.session);

          // NOTE: the count lives on data.session.lockStatus (the production
          // API has no top-level `violations` field) — first strike shows the
          // warning block, second strike is handled by the hard-lock screen.
          const strikes: number = data.session?.lockStatus?.violations ?? 0;
          if (strikes === 1 && !data.isHardLocked) {
            setShowWarningModal(true);
          }
        }
      } catch (err) {
        console.error('Failed to report lock violation:', err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleDefocus('Unauthorized tab or window switch detected (visibility hidden).');
      }
    };

    const handleWindowBlur = () => {
      handleDefocus('Browser focus lost (window blur detected).');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isExamActive, session.candidateId, session.status, onViolationReported]);

  const handleCheckUnlock = async () => {
    setIsCheckingUnlock(true);
    await onCheckStatus();
    setIsCheckingUnlock(false);
  };

  const handleUnlockAndBegin = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.().catch(() => {});
      }
    } catch (e) {
      // Ignored if browser blocks automatic fullscreen
    }
    if (onUnlockTerminal) {
      onUnlockTerminal();
    }
  };

  // State 1: Hard Lockdown Blocker (2nd violation or hard locked by admin)
  if (session.lockStatus.isLocked || session.status === 'hard_locked') {
    return (
      <div className="fixed inset-0 z-[9999] bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white border border-rose-200 rounded-3xl p-6 sm:p-8 shadow-2xl text-center text-slate-800 relative overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="w-16 h-16 mx-auto bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-center text-rose-600 mb-4 shadow-2xs">
            <Lock className="w-8 h-8" />
          </div>

          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold uppercase tracking-wider mb-2">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Hard Lockdown Engaged</span>
          </div>

          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Exam Session Suspended</h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            A second exam integrity violation was detected (unauthorized window or application switch).
            In accordance with IELTS Gate regulations, your exam session has been locked.
          </p>

          <div className="my-5 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left text-xs font-mono text-slate-700 space-y-1.5">
            <div className="flex justify-between border-b border-slate-200/80 pb-1">
              <span className="text-slate-500 font-sans">Candidate Number:</span>
              <span className="font-bold text-slate-900">{session.candidateId}</span>
            </div>
            <div className="flex justify-between border-b border-slate-200/80 pb-1">
              <span className="text-slate-500 font-sans">Candidate Name:</span>
              <span className="font-bold text-slate-900 font-sans">{session.candidateName}</span>
            </div>
            <div className="flex justify-between border-b border-slate-200/80 pb-1">
              <span className="text-slate-500 font-sans">Total Violations:</span>
              <span className="text-rose-600 font-bold">{session.lockStatus.violations} / 2 (Hard Limit Reached)</span>
            </div>
            <div>
              <span className="text-slate-500 block mb-1 font-sans">Violation History:</span>
              <div className="max-h-24 overflow-y-auto space-y-1 text-[11px] text-rose-700 pr-1">
                {session.lockStatus.lockHistory.map((h, i) => (
                  <div key={i} className="bg-rose-50/70 p-1.5 rounded-lg border border-rose-100">
                    <span className="text-slate-500">[{new Date(h.timestamp).toLocaleTimeString()}]</span> {h.reason}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-amber-800 text-xs text-left mb-6">
            <strong>Action Required:</strong> Alert your test proctor or supervisor.
            The test administrator must review your terminal and trigger <em>&quot;Reset Session&quot;</em> from the Admin Command Center to restore your exam. Your answers and timer are securely saved.
          </div>

          <button
            onClick={handleCheckUnlock}
            disabled={isCheckingUnlock}
            className="w-full flex items-center justify-center space-x-2 py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isCheckingUnlock ? 'animate-spin' : ''}`} />
            <span>{isCheckingUnlock ? 'Checking Admin Clearance...' : 'Check If Admin Unlocked Session'}</span>
          </button>
        </div>
      </div>
    );
  }

  // State 2: Automatic Proctored Lock Screen (Active on entry or when manually locked)
  if (isTerminalLocked) {
    const sectionName =
      session.currentSection === 'listening'
        ? 'Listening Module — Section 1 of 4'
        : session.currentSection === 'reading'
        ? 'Reading Module — 3 Academic Passages'
        : session.currentSection === 'writing'
        ? 'Writing Module — Task 1 & Task 2'
        : 'Official Examination';

    return (
      <div className="fixed inset-0 z-[9990] bg-slate-900/30 backdrop-blur-md flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-2xl text-center text-slate-800 animate-in fade-in zoom-in-95 duration-200">
          {/* Top Proctor Badge */}
          <div className="w-16 h-16 mx-auto bg-orange-50 border border-orange-200 rounded-2xl flex items-center justify-center text-orange-600 mb-4 shadow-2xs">
            <Lock className="w-8 h-8" />
          </div>

          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-orange-50 border border-orange-200 text-orange-700 text-xs font-bold uppercase tracking-wider mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Secure Exam Lock Screen</span>
          </div>

          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Exam Session Locked</h2>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            You have entered the proctored test environment. Click below to unlock your terminal and begin your exam session in full-screen mode.
          </p>

          {/* Candidate Dossier */}
          <div className="my-5 bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-left text-xs space-y-2">
            <div className="flex items-center space-x-3 pb-2 border-b border-slate-200/70">
              <CandidateAvatar
                name={session.candidateName}
                photoUrl={session.candidatePhotoUrl}
                className="w-10 h-10 rounded-full border border-slate-200 shadow-2xs"
                textClassName="text-sm"
              />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900 text-sm truncate">{session.candidateName}</div>
                <div className="text-slate-500 text-[11px] flex items-center space-x-1">
                  <span>Candidate No:</span>
                  <span className="font-mono font-bold text-orange-600">{session.candidateId}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
              <div>
                <span className="text-slate-400 block">Exam:</span>
                <span className="font-medium text-slate-800 truncate block">{session.examTitle || 'IELTS Academic'}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Current Stage:</span>
                <span className="font-semibold text-orange-600 truncate block">{sectionName}</span>
              </div>
            </div>

            {/* Security checklist */}
            <div className="pt-2 border-t border-slate-200/70 text-[11px] text-slate-600 space-y-1">
              <div className="flex items-center space-x-1.5 text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Tab defocus and window blur tracking armed</span>
              </div>
              <div className="flex items-center space-x-1.5 text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Full-screen proctored kiosk enforced</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleUnlockAndBegin}
            className="w-full flex items-center justify-center space-x-2 py-3.5 px-4 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold rounded-xl text-sm transition shadow-sm shadow-orange-500/25 cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
            <span>Unlock &amp; Resume Exam</span>
          </button>
        </div>
      </div>
    );
  }

  // State 3: 1st Violation Warning Modal
  if (showWarningModal) {
    return (
      <div className="fixed inset-0 z-[9990] bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-amber-200 rounded-3xl p-6 shadow-2xl text-center text-slate-800 animate-in fade-in zoom-in-95 duration-200">
          <div className="w-14 h-14 mx-auto bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center text-amber-600 mb-4 shadow-2xs">
            <AlertTriangle className="w-7 h-7" />
          </div>

          <span className="inline-flex items-center space-x-1 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold uppercase tracking-wider mb-2">
            Warning 1 of 2
          </span>

          <h3 className="text-xl font-bold text-slate-900">Integrity Warning: Focus Lost</h3>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            You navigated away from the exam window or switched tabs.
            This incident has been recorded on the invigilator dashboard.
          </p>

          <div className="my-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 text-left">
            <strong>CRITICAL:</strong> A second infraction will immediately trigger <strong>HARD LOCKDOWN</strong>, freezing your test and requiring an administrator to physically review and reset your terminal.
          </div>

          <button
            onClick={() => setShowWarningModal(false)}
            className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl text-sm transition shadow-xs cursor-pointer"
          >
            Continue Exam
          </button>
        </div>
      </div>
    );
  }

  return null;
};

