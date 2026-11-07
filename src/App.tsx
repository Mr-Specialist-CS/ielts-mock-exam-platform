import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Clock, RefreshCw, LogOut } from 'lucide-react';
import { CandidateSession, Exam, getExamStartMs, isExamPaperReleased } from './types';
import { Navbar } from './components/Navbar';
import { CandidateLogin } from './components/StudentPortal/CandidateLogin';
import { LockdownOverlay } from './components/StudentPortal/LockdownOverlay';
import { ListeningSection } from './components/StudentPortal/ListeningSection';
import { ReadingSection } from './components/StudentPortal/ReadingSection';
import { WritingSection } from './components/StudentPortal/WritingSection';
import { StudentReviewPage } from './components/StudentPortal/StudentReviewPage';
import { AdminDashboard } from './components/Admin/AdminDashboard';
import { AdminLogin } from './components/Admin/AdminLogin';
import { PublicVerificationView } from './components/PublicVerificationView';
import { PublicRegistrationView } from './components/StudentPortal/PublicRegistrationView';
import { TestReportFormModal } from './components/TestReportFormModal';
import { sampleExam } from './data/sampleExam';
import { initialCandidateSessions } from './data/initialCandidates';
import { getAdminAuthHeaders } from './utils/adminAuth';
import { isSessionAllGradesFinalized } from './utils/ieltsScoring';
import { mergeSessionPreferringProgress } from './utils/sessionMerge';

// fetch() never times out on its own — a hung request would leave the
// candidate staring at a dead screen with locks held forever. Bound every
// exam-critical save so hangs turn into a visible retryable error instead.
async function fetchWithTimeout(url: string, init: RequestInit, ms = 25000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Server gate rejections echo the session status they saw — surface it so a
// screenshot of the message is enough to diagnose entry problems.
function withServerDetail(base: string, errJson: any): string {
  const st = errJson?.detail?.status;
  return st ? `${base} [server sees session: ${st}]` : base;
}

export default function App() {
  const [currentView, setCurrentView] = useState<'student' | 'admin' | 'verify' | 'register'>('student');
  const [exams, setExams] = useState<Exam[]>([sampleExam]);
  const [selectedExamId, setSelectedExamId] = useState<string>(sampleExam.id);
  const [activeExamId, setActiveExamId] = useState<string | null>(sampleExam.id);

  const [sessions, setSessions] = useState<CandidateSession[]>([]);
  const [activeSession, setActiveSession] = useState<CandidateSession | null>(null);

  // IDs saved/updated locally but not yet confirmed present by the backend.
  // Only these may survive a backend refresh — everything else on the server
  // is the source of truth (in particular, admin-deleted exams must NOT be
  // re-added from stale local state after a refresh).
  const pendingExamIds = React.useRef<Set<string>>(new Set());

  // Save ordering guard: every session save gets a monotonic number and only
  // the newest save's server response is applied. Without this, a slow
  // in-flight save (e.g. a 60s timer sync) landing AFTER the section-finish
  // save overwrites the fresh currentSection with the stale one — the
  // candidate bounces back to the previous section, looks frozen, and has to
  // hammer Finish several times to get through.
  const syncSeqRef = React.useRef(0);
  // Blocks stacked Finish clicks from opening competing transitions.
  const transitioningRef = React.useRef(false);

  // (mergeSessionPreferringProgress is imported from utils/sessionMerge so
  // the mount-once refresh callback can use it too.)

  // Authoritative 1 active exam for candidates (or null if no exam is active)
  const activeExam = useMemo(() => {
    if (activeExamId === null || activeExamId === '' || activeExamId === 'none') {
      return null;
    }
    return exams.find(e => e.id === activeExamId) || null;
  }, [exams, activeExamId]);

  const exam = (activeSession?.examId ? exams.find(e => e.id === activeSession.examId) : null) || activeExam || exams.find(e => e.id === selectedExamId) || exams[0] || sampleExam;

  // Entry gate is driven by the ACTIVE exam's own date/time — no global switch.
  // No active exam → closed. Dated exam in the future → scheduled countdown.
  // Otherwise (undated, or start time reached) → open, automatically.
  const activeExamStartMs = activeExam ? getExamStartMs(activeExam) : null;
  const derivedAccessMode: 'closed' | 'scheduled' | 'open' = !activeExam
    ? 'closed'
    : (activeExamStartMs !== null && activeExamStartMs > Date.now() ? 'scheduled' : 'open');
  const derivedScheduledAt: string | null =
    activeExamStartMs !== null && activeExamStartMs > Date.now()
      ? new Date(activeExamStartMs).toISOString()
      : null;
  const [isTerminalLocked, setIsTerminalLocked] = useState(false);
  const [showTrfModal, setShowTrfModal] = useState(false);
  const [trfModalSession, setTrfModalSession] = useState<CandidateSession | null>(null);
  const [loading, setLoading] = useState(true);
  // Effective gate — decided ONLY by the posted exam's own date & time
  // (set by the admin in the Exam Wizard). Future start → countdown;
  // reached/undated → open; no active exam → closed. While the first
  // backend sync is still in flight, force closed so the entry form can never
  // flash open on refresh (and no entry can slip through before the countdown).
  const dateDemandsWait = derivedAccessMode === 'scheduled';
  const gatedAccessMode: 'closed' | 'scheduled' | 'open' = loading
    ? 'closed'
    : (!activeExam
      ? 'closed'
      : (dateDemandsWait
        ? 'scheduled'
        : 'open'));
  const gatedScheduledAt: string | null = derivedScheduledAt;

  // Admin Authentication State
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return Boolean(sessionStorage.getItem('ielts_admin_token') || localStorage.getItem('ielts_admin_token'));
    }
    return false;
  });
  const [adminUsername, setAdminUsername] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('ielts_admin_user') || '';
    }
    return '';
  });

  // Verify Admin Token with backend on mount
  useEffect(() => {
    const token = sessionStorage.getItem('ielts_admin_token') || localStorage.getItem('ielts_admin_token');
    if (token) {
      fetch('/api/admin/verify', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => {
          if (res.ok) {
            setIsAdminAuthenticated(true);
          } else {
            sessionStorage.removeItem('ielts_admin_token');
            sessionStorage.removeItem('ielts_admin_user');
            localStorage.removeItem('ielts_admin_token');
            setIsAdminAuthenticated(false);
          }
        })
        .catch(() => {
          // If offline or error, preserve existing state
        });
    }
  }, []);

  const handleLogoutAdmin = async () => {
    const token = sessionStorage.getItem('ielts_admin_token') || localStorage.getItem('ielts_admin_token');
    if (token) {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch {}
    }
    sessionStorage.removeItem('ielts_admin_token');
    sessionStorage.removeItem('ielts_admin_user');
    localStorage.removeItem('ielts_admin_token');
    setIsAdminAuthenticated(false);
    setCurrentView('student');
    try {
      window.history.pushState(null, '', '/');
    } catch {}
  };

  // Synchronize view selection with browser URL history
  const handleSelectView = (view: 'student' | 'admin' | 'verify' | 'register') => {
    setCurrentView(view);
    try {
      if (view === 'admin') {
        window.history.pushState(null, '', '/IAManadmin');
      } else if (view === 'register') {
        window.history.pushState(null, '', '/register');
      } else if (view === 'verify') {
        window.history.pushState(null, '', '/verify');
      } else {
        window.history.pushState(null, '', '/');
      }
    } catch {}
    refreshBackendData();
  };

  // Check URL path for direct verification, registration, or hidden admin gateway: e.g. /IAManadmin or /verify/IG-623018 or /register
  useEffect(() => {
    const syncViewFromUrl = () => {
      const rawPath = window.location.pathname.replace(/\/+$/, '');
      const lower = rawPath.toLowerCase();

      if (lower === '/iamanadmin' || rawPath === '/IAManadmin') {
        setCurrentView('admin');
      } else if (rawPath.startsWith('/verify')) {
        setCurrentView('verify');
      } else if (rawPath.startsWith('/register')) {
        setCurrentView('register');
      }
    };

    syncViewFromUrl();
    window.addEventListener('popstate', syncViewFromUrl);
    return () => window.removeEventListener('popstate', syncViewFromUrl);
  }, []);

  // Fetch initial exams & sessions from backend.
  // Returns true when the cohort (sessions) refreshed, false when the admin
  // session is no longer valid or the backend is unreachable — callers
  // surface this instead of failing silently.
  const refreshBackendData = useCallback(async (): Promise<boolean> => {
    try {
      const [examsRes, sessRes, settingsRes] = await Promise.all([
        fetch('/api/exams', { cache: 'no-store' }),
        fetch('/api/sessions', { headers: getAdminAuthHeaders(), cache: 'no-store' }),
        fetch('/api/settings', { cache: 'no-store' })
      ]);

      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData && settingsData.activeExamId !== undefined) {
          setActiveExamId(settingsData.activeExamId);
        }
      }

      if (examsRes.ok) {
        const examsData = await examsRes.json();
        if (Array.isArray(examsData)) {
          const serverIds = new Set<string>();
          setExams(prev => {
            const pendingSnapshot = prev;
            const uniqueMap = new Map<string, Exam>();
            // Server catalog is authoritative (deleted exams stay deleted).
            examsData.forEach((e: Exam) => {
              if (e && e.id) {
                uniqueMap.set(e.id, e);
                serverIds.add(e.id);
              }
            });
            // Preserve ONLY locally saved exams the backend hasn't echoed yet.
            pendingExamIds.current.forEach(id => {
              if (!serverIds.has(id)) {
                const local = pendingSnapshot.find(e => e && e.id === id);
                if (local) uniqueMap.set(id, local);
              }
            });
            // Drop pending flags the server has now confirmed (or rejected).
            pendingExamIds.current.forEach(id => {
              if (serverIds.has(id)) pendingExamIds.current.delete(id);
            });
            return Array.from(uniqueMap.values());
          });
          setSelectedExamId(prev => {
            if (prev && serverIds.has(prev)) return prev;
            return examsData[0]?.id || '';
          });
        }
      }

      if (sessRes.ok) {
        const sessData = await sessRes.json();
        setSessions(sessData);

        // If candidate logged in, keep active session in sync — but never
        // drag a live candidate back to an earlier section with stale data.
        setActiveSession(prev => {
          if (!prev) return null;
          const fresh = sessData.find((s: CandidateSession) => s.candidateId === prev.candidateId) || null;
          return mergeSessionPreferringProgress(prev, fresh);
        });
      }
      return sessRes.ok && examsRes.ok;
    } catch (err) {
      console.info('Backend sync info, using local state:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBackendData();
  }, [refreshBackendData]);

  // Handlers for Exam Management
  // Returns true when the backend confirmed the save, false otherwise
  // (callers surface the failure instead of showing a silent success).
  const handleSaveExam = async (updated: Exam): Promise<boolean> => {
    // Mark as pending so a racing backend refresh can't drop it before the POST lands.
    if (updated && updated.id) pendingExamIds.current.add(updated.id);
    // 1. Optimistically update local state immediately so it appears instantly in the catalog
    setExams(prev => {
      const idx = prev.findIndex(e => e.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [...prev, updated];
    });
    setSelectedExamId(updated.id);

    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminAuthHeaders()
        },
        body: JSON.stringify(updated),
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        const savedExam = data.exam || updated;
        setExams(prev => {
          const idx = prev.findIndex(e => e.id === savedExam.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = savedExam;
            return next;
          }
          return [...prev, savedExam];
        });
        setSelectedExamId(savedExam.id);
        await refreshBackendData();
        return true;
      } else {
        const errJson = await res.json().catch(() => null);
        console.warn('Backend rejected exam save:', errJson);
        await refreshBackendData();
        return false;
      }
    } catch (e) {
      console.error('Failed to save exam to backend:', e);
      return false;
    }
  };

  const handleDeleteExam = async (examId: string) => {
    try {
      const res = await fetch(`/api/exams/${examId}`, {
        method: 'DELETE',
        headers: getAdminAuthHeaders()
      });
      if (res.ok) {
        pendingExamIds.current.delete(examId);
        setExams(prev => prev.filter(e => e.id !== examId));
        setSelectedExamId(prev => {
          if (prev === examId) {
            const remaining = exams.filter(e => e.id !== examId);
            return remaining[0]?.id || '';
          }
          return prev;
        });
        // A deleted exam can no longer be the active one — clear it locally
        // and on the backend so refresh can never resurrect it that way either.
        if (activeExamId === examId) {
          setActiveExamId(null);
          try {
            await fetch('/api/admin/active-exam', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
              body: JSON.stringify({ activeExamId: 'none' }),
              cache: 'no-store'
            });
          } catch {}
        }
        await refreshBackendData();
      } else {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Server rejected exam deletion (status ${res.status}).`);
      }
    } catch (e) {
      console.error('Failed to delete exam:', e);
      throw e;
    }
  };

  // Sync candidate state to server
  const handleSyncSession = async (partial: Partial<CandidateSession>) => {
    if (!activeSession) return;
    const mySeq = ++syncSeqRef.current;
    const isTransition = partial.currentSection !== undefined;

    // Optimistic local update
    const updated = { ...activeSession, ...partial, lastSavedAt: new Date().toISOString() };
    setActiveSession(updated);

    try {
      const res = await fetchWithTimeout(`/api/sessions/${activeSession.candidateId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial)
      });
      if (res.ok) {
        const data = await res.json();
        // Apply only if no newer save was issued since — stale responses
        // must never drag the candidate back to a previous section.
        if (mySeq === syncSeqRef.current) {
          setActiveSession(data.session);
        }
      } else if (isTransition) {
        // A failed section change used to die silently, leaving the
        // candidate staring at a seemingly frozen screen.
        const errJson = await res.json().catch(() => null);
        alert(withServerDetail(errJson?.error || `Could not move to the next section (server ${res.status}). Your answers are saved — please try again.`, errJson));
      }
    } catch (e) {
      console.error('Failed to sync session to server:', e);
      if (isTransition) {
        const timedOut = e instanceof Error && e.name === 'AbortError';
        alert(
          timedOut
            ? 'The server is taking too long to respond. Your answers are saved — please try again.'
            : 'Network error while moving to the next section. Your answers are saved — please try again.'
        );
      }
    }
  };

  // Section Progressions — each finish is a SINGLE authoritative save carrying
  // the section's very latest input (passed up by the section itself), so no
  // stale throttled snapshot can revert the transition server-side.
  const handleCompleteListening = async (freshAnswers?: Record<string, string>) => {
    if (!activeSession || transitioningRef.current) return;
    transitioningRef.current = true;
    try {
      await handleSyncSession({
        currentSection: 'reading',
        listeningState: {
          ...activeSession.listeningState,
          answers: freshAnswers || activeSession.listeningState.answers,
          completed: true
        }
      });
    } finally {
      transitioningRef.current = false;
    }
  };

  const handleCompleteReading = async (freshAnswers?: Record<string, string>) => {
    if (!activeSession || transitioningRef.current) return;
    transitioningRef.current = true;
    try {
      await handleSyncSession({
        currentSection: 'writing',
        readingState: {
          ...activeSession.readingState,
          answers: freshAnswers || activeSession.readingState.answers,
          completed: true
        }
      });
    } finally {
      transitioningRef.current = false;
    }
  };

  const handleSubmitFinalExam = async (freshResponses?: { task1Response?: string; task2Response?: string }) => {
    if (!activeSession) return;
    // Persist the latest essay text BEFORE submitting, otherwise the final
    // keystrokes live only in the (now unmounted) section.
    await handleSyncSession({
      writingState: {
        ...activeSession.writingState,
        task1Response: freshResponses?.task1Response ?? activeSession.writingState.task1Response,
        task2Response: freshResponses?.task2Response ?? activeSession.writingState.task2Response,
        completed: true
      }
    });
    try {
      // Retire any older in-flight saves so their late responses cannot
      // overwrite the submit result below.
      syncSeqRef.current++;
      const res = await fetchWithTimeout(`/api/sessions/${activeSession.candidateId}/submit`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setActiveSession(data.session);
        await refreshBackendData();
      } else {
        const errJson = await res.json().catch(() => null);
        if (errJson?.code === 'EXAM_NOT_OPEN') {
          alert(withServerDetail(errJson.error || 'Exam access is not open yet. Your answers are kept — please wait for the countdown to finish and submit again.', errJson));
        } else {
          alert(withServerDetail(errJson?.error || `Submit failed (server ${res.status}). Your answers are saved — please try again.`, errJson));
        }
      }
    } catch (e) {
      console.error('Failed to submit exam:', e);
      const timedOut = e instanceof Error && e.name === 'AbortError';
      alert(
        timedOut
          ? 'The server is taking too long to respond. Your answers are saved — please try again.'
          : 'Network error while submitting. Your answers are saved — please try again.'
      );
    }
  };

  const handleOpenTrf = (sessionToDisplay?: CandidateSession) => {
    const target = sessionToDisplay || activeSession;
    if (!target || !isSessionAllGradesFinalized(target)) return;
    // Two-slot days: the certified paper stays sealed until release, same as
    // the review page (a fast same-day finalization must not leak slot 2).
    const paperExam = target.examId ? exams.find(e => e.id === target.examId) : undefined;
    if (paperExam && !isExamPaperReleased(paperExam)) {
      alert('This Test Report Form is sealed until all sessions of the exam day finish. Please check back later.');
      return;
    }
    setTrfModalSession(target);
    setShowTrfModal(true);
  };

  const handleSetActiveExam = async (examId: string | null) => {
    const token = sessionStorage.getItem('ielts_admin_token') || localStorage.getItem('ielts_admin_token');
    try {
      const res = await fetch('/api/admin/active-exam', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ activeExamId: examId === null ? 'none' : examId })
      });
      if (res.ok) {
        setActiveExamId(examId);
        if (examId) setSelectedExamId(examId);
        await refreshBackendData();
      }
    } catch (e) {
      console.error('Failed to update active exam:', e);
    }
  };

  const isExamInProgress =
    activeSession !== null &&
    (activeSession.currentSection === 'listening' ||
      activeSession.currentSection === 'reading' ||
      activeSession.currentSection === 'writing') &&
    (activeSession.status === 'in_progress' || activeSession.status === 'registered');

  const isHardLocked =
    activeSession !== null &&
    (activeSession.lockStatus.isLocked || activeSession.status === 'hard_locked');

  // Student "Check If Admin Unlocked Session" must work without admin rights:
  // reload this candidate's own session so a reset resumes from saved state.
  const handleCheckUnlockStatus = useCallback(async () => {
    if (!activeSession) {
      await refreshBackendData();
      return;
    }
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(activeSession.candidateId)}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const fresh: CandidateSession = await res.json();
        setActiveSession(prev => mergeSessionPreferringProgress(prev, fresh));
      }
    } catch (e) {
      console.warn('Unlock status check failed:', e);
    } finally {
      await refreshBackendData();
    }
  }, [activeSession, refreshBackendData]);

  const handleUnlockExamTerminal = async () => {
    setIsTerminalLocked(false);
    if (activeSession && activeSession.status === 'registered') {
      const updated: CandidateSession = {
        ...activeSession,
        status: 'in_progress'
      };
      setActiveSession(updated);
      handleSyncSession(updated);
    }
  };

  // Entry rule: the exam can only be taken while its own exam is active
  // (e.g. approved for Exam 5 while Exam 4 is active must wait).
  // Finished sessions (completed/finalized) stay review-only and pass through.
  // Crucially, a candidate already IN the exam (in_progress) NEVER waits:
  // yanking them to the waiting room mid-section (e.g. after an admin exam
  // switch) looks exactly like being "pushed back" and blocks progress.
  const isWaitingForOwnExam =
    activeSession !== null &&
    (activeSession.status === 'registered' ||
      activeSession.status === 'hard_locked') &&
    (!activeExam || activeSession.examId !== activeExam.id);

  // While waiting, poll so entry opens automatically once the proctor
  // activates the candidate's exam.
  useEffect(() => {
    if (!isWaitingForOwnExam || currentView !== 'student') return;
    const t = setInterval(() => {
      handleCheckUnlockStatus();
    }, 20000);
    return () => clearInterval(t);
  }, [isWaitingForOwnExam, currentView, handleCheckUnlockStatus]);

  return (
    loading ? (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center py-10 px-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-orange-500 text-white flex items-center justify-center font-black">IG</div>
          <div>
            <p className="text-sm font-bold text-slate-900">Connecting to exam server…</p>
            <p className="text-xs text-slate-500">Verifying exam schedule before entry.</p>
          </div>
        </div>
      </div>
    ) : (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-orange-500/20 selection:text-orange-900">
      {/* Top Proctored Navigation */}
      <Navbar
        currentView={currentView}
        onSelectView={handleSelectView}
        activeSession={activeSession}
        onLogoutSession={() => {
          setActiveSession(null);
          setIsTerminalLocked(false);
        }}
        isAdminAuthenticated={isAdminAuthenticated}
        adminUsername={adminUsername}
        onLogoutAdmin={handleLogoutAdmin}
      />

      {/* Lockdown Proctor Guard (Active when student takes exam) */}
      {activeSession && currentView === 'student' && (
        <LockdownOverlay
          session={activeSession}
          onViolationReported={updated => setActiveSession(prev => mergeSessionPreferringProgress(prev, updated))}
          onCheckStatus={handleCheckUnlockStatus}
          isExamActive={isExamInProgress}
          isTerminalLocked={isTerminalLocked}
          onUnlockTerminal={handleUnlockExamTerminal}
        />
      )}

      {/* Main Container */}
      <main className="flex-1">
        {/* VIEW 1: STUDENT EXAMINATION PORTAL */}
        {currentView === 'student' && (
          <>
            {!activeSession ? (
              <CandidateLogin
                exam={activeExam}
                onGoToRegister={() => setCurrentView('register')}
                examAccessMode={gatedAccessMode}
                examScheduledAt={gatedScheduledAt}
                onLoginSuccess={session => {
                  setActiveSession(session);
                  if (session.examId) {
                    const matchedExam = exams.find(e => e.id === session.examId);
                    if (matchedExam) setSelectedExamId(matchedExam.id);
                  }
                  // When student enters exam session, automatically it should be in lock screen
                  if (
                    session.currentSection === 'listening' ||
                    session.currentSection === 'reading' ||
                    session.currentSection === 'writing'
                  ) {
                    setIsTerminalLocked(true);
                  }
                  refreshBackendData();
                }}
              />
            ) : isWaitingForOwnExam ? (
              <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex flex-col items-center justify-center py-10 px-4">
                <div className="max-w-md w-full text-center space-y-5">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-amber-50 border-2 border-amber-200 text-amber-600 shadow-sm">
                    <Clock className="w-10 h-10" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">Waiting for Your Exam</h1>
                    <p className="text-sm text-slate-500 mt-2 leading-relaxed max-w-sm mx-auto">
                      You are approved for <strong className="text-slate-800">{activeSession.examTitle || activeSession.examId}</strong>, which is
                      not currently active. Your test will open automatically once the proctor activates it.
                    </p>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2 text-left">
                    <div className="flex justify-between text-xs border-b border-slate-200/80 pb-1">
                      <span className="text-slate-500">Your exam:</span>
                      <span className="font-bold text-slate-900">{activeSession.examTitle || activeSession.examId}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Currently active:</span>
                      <span className="font-bold text-orange-600">{activeExam ? activeExam.title : 'No active exam'}</span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={handleCheckUnlockStatus}
                      className="flex-1 flex items-center justify-center space-x-2 py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition shadow-sm cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Check Again</span>
                    </button>
                    <button
                      onClick={() => {
                        setActiveSession(null);
                        setIsTerminalLocked(false);
                      }}
                      className="flex-1 flex items-center justify-center space-x-2 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-sm font-semibold transition cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Leave</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">This page refreshes automatically every 20 seconds.</p>
                </div>
              </div>
            ) : (
              <>
                {/* Listening Module */}
                {activeSession.currentSection === 'listening' && (
                  <ListeningSection
                    session={activeSession}
                    exam={exam}
                    onSyncSession={handleSyncSession}
                    onCompleteSection={handleCompleteListening}
                    onLockTerminal={() => setIsTerminalLocked(true)}
                    isFrozen={isHardLocked}
                  />
                )}

                {/* Reading Module */}
                {activeSession.currentSection === 'reading' && (
                  <ReadingSection
                    session={activeSession}
                    exam={exam}
                    onSyncSession={handleSyncSession}
                    onCompleteSection={handleCompleteReading}
                    onLockTerminal={() => setIsTerminalLocked(true)}
                    isFrozen={isHardLocked}
                  />
                )}

                {/* Writing Module */}
                {activeSession.currentSection === 'writing' && (
                  <WritingSection
                    session={activeSession}
                    exam={exam}
                    onSyncSession={handleSyncSession}
                    onSubmitFinalExam={handleSubmitFinalExam}
                    onLockTerminal={() => setIsTerminalLocked(true)}
                    isFrozen={isHardLocked}
                  />
                )}

                {/* Post-Grading Review / Finalized Score View */}
                {(activeSession.currentSection === 'review' || activeSession.currentSection === 'completed' || activeSession.status === 'completed' || activeSession.status === 'finalized') && (
                  <StudentReviewPage
                    session={activeSession}
                    exam={exam}
                    onOpenTrfModal={() => handleOpenTrf(activeSession)}
                  />
                )}
              </>
            )}
          </>
        )}

        {/* VIEW 2: ADMIN COMMAND CENTER (RESTRICTED TO AUTHENTICATED PROCTORS) */}
        {currentView === 'admin' && (
          !isAdminAuthenticated ? (
            <AdminLogin
              onLoginSuccess={(token, user) => {
                setIsAdminAuthenticated(true);
                setAdminUsername(user);
              }}
              onBackToStudent={() => handleSelectView('student')}
            />
          ) : (
            <AdminDashboard
              exam={activeExam || exams.find(e => e.id === selectedExamId) || exams[0] || sampleExam}
              exams={exams}
              sessions={sessions}
              activeExamId={activeExamId}
              onSetActiveExam={handleSetActiveExam}
              onSelectExam={setSelectedExamId}
              onRefreshData={refreshBackendData}
              onSaveExam={handleSaveExam}
              onDeleteExam={handleDeleteExam}
              onOpenTrf={handleOpenTrf}
              adminUsername={adminUsername}
              onLogoutAdmin={handleLogoutAdmin}
            />
          )
        )}

        {/* VIEW 3: PUBLIC TRF CERTIFICATE VERIFICATION */}
        {currentView === 'verify' && (
          <PublicVerificationView
            initialCandidateId={activeSession?.candidateId || ''}
          />
        )}

        {/* VIEW 4: PUBLIC EXAM REGISTRATION & m10 PAYMENT */}
        {currentView === 'register' && (
          <PublicRegistrationView
            exam={activeExam}
            exams={exams}
            activeExamId={activeExamId}
            examAccessMode={gatedAccessMode}
            examScheduledAt={gatedScheduledAt}
            onStartExam={session => {
              setActiveSession(session);
              if (session.examId) {
                const matchedExam = exams.find(e => e.id === session.examId);
                if (matchedExam) setSelectedExamId(matchedExam.id);
              }
              setCurrentView('student');
              if (
                session.currentSection === 'listening' ||
                session.currentSection === 'reading' ||
                session.currentSection === 'writing'
              ) {
                setIsTerminalLocked(true);
              }
              refreshBackendData();
            }}
            onGoToLogin={() => setCurrentView('student')}
          />
        )}
      </main>

      {/* Official TRF Printable Modal */}
      {showTrfModal && trfModalSession && isSessionAllGradesFinalized(trfModalSession) && (
        <TestReportFormModal
          session={trfModalSession}
          onClose={() => setShowTrfModal(false)}
        />
      )}
    </div>
    )
  );
}
