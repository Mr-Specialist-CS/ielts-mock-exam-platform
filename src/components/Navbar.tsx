import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, Maximize2, Minimize2, GraduationCap, Settings, CheckCircle2, User, RefreshCw, CreditCard, LogOut, Lock } from 'lucide-react';
import { CandidateSession } from '../types';

interface NavbarProps {
  currentView: 'student' | 'admin' | 'verify' | 'register';
  onSelectView: (view: 'student' | 'admin' | 'verify' | 'register') => void;
  activeSession: CandidateSession | null;
  onLogoutSession: () => void;
  isAdminAuthenticated?: boolean;
  adminUsername?: string;
  onLogoutAdmin?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onSelectView,
  activeSession,
  onLogoutSession,
  isAdminAuthenticated,
  adminUsername = 'IAManadmin',
  onLogoutAdmin
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const checkFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', checkFullscreen);
    return () => document.removeEventListener('fullscreenchange', checkFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
    }
  };

  // Lockdown mode: while a candidate session is open in the student view,
  // the portal navigation must disappear — lock screen, waiting room,
  // sections and review alike. Only candidate identity + exam controls stay.
  // (Status-independent: a registered candidate at the lock screen is
  // already in exam mode.)
  const inExam = activeSession !== null && currentView === 'student';

  return (
    <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 text-slate-800 sticky top-0 z-50 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 min-h-16 flex items-center justify-between gap-2 sm:gap-4">
        {/* Logo & Brand */}
        <div
          className={`flex items-center space-x-2.5 sm:space-x-3 shrink-0 select-none py-1 ${inExam ? '' : 'cursor-pointer'}`}
          onClick={() => { if (!inExam) onSelectView('student'); }}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 via-orange-600 to-amber-500 flex items-center justify-center font-black text-white text-base tracking-wider shadow-md shadow-orange-500/25 shrink-0">
            IG
          </div>
          <div className="flex flex-col justify-center min-w-0">
            <div className="flex items-center space-x-2 flex-nowrap">
              <span className="font-extrabold text-base sm:text-lg tracking-tight text-slate-900 whitespace-nowrap">
                IELTS Gate
              </span>
              <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 whitespace-nowrap shrink-0 hidden sm:inline-block">
                PROCTOR LOCK
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-medium whitespace-nowrap hidden lg:block leading-tight mt-0.5">
              Official Standard Mock Exam Environment
            </p>
          </div>
        </div>

        {/* Center View Switcher — hidden once the exam has started */}
        {!inExam && (
        <div className="hidden md:flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 shrink-0">
          <button
            onClick={() => onSelectView('student')}
            className={`flex items-center space-x-1.5 px-2.5 lg:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
              currentView === 'student'
                ? 'bg-white text-orange-600 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <GraduationCap className="w-4 h-4 shrink-0" />
            <span className="hidden xl:inline">Student Exam Portal</span>
            <span className="xl:hidden">Portal</span>
          </button>
          <button
            onClick={() => onSelectView('register')}
            className={`flex items-center space-x-1.5 px-2.5 lg:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
              currentView === 'register'
                ? 'bg-white text-cyan-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <CreditCard className="w-4 h-4 text-cyan-600 shrink-0" />
            <span className="hidden xl:inline">Register &amp; Pay (m10)</span>
            <span className="xl:hidden">Register</span>
          </button>
          {/* Admin panel link is hidden from public view; only visible to authenticated admins or when accessed via /IAManadmin */}
          {(isAdminAuthenticated || currentView === 'admin') && (
            <button
              onClick={() => onSelectView('admin')}
              className={`flex items-center space-x-1.5 px-2.5 lg:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                currentView === 'admin'
                  ? 'bg-white text-orange-600 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span className="hidden xl:inline">Admin Control &amp; Grading</span>
              <span className="xl:hidden">Admin</span>
            </button>
          )}
          <button
            onClick={() => onSelectView('verify')}
            className={`flex items-center space-x-1.5 px-2.5 lg:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
              currentView === 'verify'
                ? 'bg-white text-orange-600 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="hidden xl:inline">TRF Verification</span>
            <span className="xl:hidden">Verify</span>
          </button>
        </div>
        )}

        {/* Right Status Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
          {activeSession && currentView === 'student' && (
            <div className="flex items-center space-x-1.5 sm:space-x-2 bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs text-slate-700 shadow-xs shrink-0">
              <User className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              <span className="font-mono font-bold text-orange-600 whitespace-nowrap">{activeSession.candidateId}</span>
              <span className="text-slate-300 hidden sm:inline">|</span>
              <span className="text-slate-700 truncate max-w-[90px] sm:max-w-[120px] font-medium hidden sm:inline">{activeSession.candidateName}</span>

              {activeSession.lockStatus.isLocked ? (
                <span className="inline-flex items-center space-x-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                  <ShieldAlert className="w-3 h-3" />
                  <span>LOCKED</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                  <Shield className="w-3 h-3" />
                  <span>SECURE</span>
                </span>
              )}

              <button
                onClick={onLogoutSession}
                title="Exit candidate session"
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 p-1 rounded-lg transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Admin Logged-In Badge in Header */}
          {isAdminAuthenticated && currentView === 'admin' && (
            <div className="hidden sm:flex items-center space-x-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-xs text-white shadow-xs shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-[11px] text-slate-400 font-medium">Admin:</span>
              <span className="font-mono font-bold text-orange-400">{adminUsername}</span>
              {onLogoutAdmin && (
                <button
                  onClick={onLogoutAdmin}
                  title="Log out Administrator"
                  className="text-slate-400 hover:text-rose-400 hover:bg-slate-800 p-1 rounded-lg transition ml-1 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className={`flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-xs shrink-0 cursor-pointer ${
              isFullscreen
                ? 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                : 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100'
            }`}
            title="Toggle Strict Fullscreen Mode"
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Exit Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Lockdown Fullscreen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Sub-Navigation Bar — hidden once the exam has started */}
      {!inExam && (
      <div className="flex md:hidden border-t border-slate-200 px-3 py-2 bg-slate-50 justify-around text-xs">
        <button
          onClick={() => onSelectView('student')}
          className={`py-1 px-2 rounded-lg font-medium transition ${currentView === 'student' ? 'bg-white text-orange-600 font-bold shadow-xs' : 'text-slate-600'}`}
        >
          Student Portal
        </button>
        {/* Hidden from public in mobile navigation unless authenticated or currently on /IAManadmin */}
        {(isAdminAuthenticated || currentView === 'admin') && (
          <button
            onClick={() => onSelectView('admin')}
            className={`py-1 px-2 rounded-lg font-medium transition ${currentView === 'admin' ? 'bg-white text-orange-600 font-bold shadow-xs' : 'text-slate-600'}`}
          >
            Admin Dashboard
          </button>
        )}
        <button
          onClick={() => onSelectView('verify')}
          className={`py-1 px-2 rounded-lg font-medium transition ${currentView === 'verify' ? 'bg-white text-orange-600 font-bold shadow-xs' : 'text-slate-600'}`}
        >
          Verify TRF
        </button>
      </div>
      )}
    </header>
  );
};
