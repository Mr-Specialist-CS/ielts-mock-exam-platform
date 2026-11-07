import React, { useState, useEffect } from 'react';
import { formatDateTime } from '../../utils/formatDate';
import { isRecentRegistration } from '../../utils/retention';
import {
  Users,
  PenTool,
  Mic,
  Globe,
  Layers,
  Award,
  ShieldAlert,
  CheckCircle2,
  Clock,
  CreditCard,
  Calendar,
  ShieldCheck,
  LogOut,
  RefreshCw,
  UserCheck,
  Settings,
  Database,
  HardDrive
} from 'lucide-react';
import { CandidateProfileData, CandidateSession, Exam, SpeakingEvaluation, WritingAiEvaluation, WritingComment, MAX_EXAMS } from '../../types';
import { buildBlankExam, sampleExam } from '../../data/sampleExam';
import { CandidateManagement } from './CandidateManagement';
import { WritingGradingView } from './WritingGradingView';
import { SpeakingExaminerRoom } from './SpeakingExaminerRoom';
import { PostGradingReview } from './PostGradingReview';
import { ExamWizard } from './ExamWizard';
import { PostedExamsView } from './PostedExamsView';
import { RegistrationApprovalsView } from './RegistrationApprovalsView';
import { ExamDateCapacityView } from './ExamDateCapacityView';
import { SystemSettingsView } from './SystemSettingsView';
import { getAdminAuthHeaders } from '../../utils/adminAuth';

interface AdminDashboardProps {
  exam: Exam;
  exams?: Exam[];
  sessions: CandidateSession[];
  activeExamId?: string | null;
  onSetActiveExam?: (examId: string | null) => Promise<void>;
  onRefreshData: () => Promise<boolean | void>;
  onSaveExam: (updatedExam: Exam) => Promise<boolean | void>;
  onSelectExam?: (examId: string) => void;
  onDeleteExam?: (examId: string) => Promise<void>;
  onOpenTrf?: (session: CandidateSession) => void;
  adminUsername?: string;
  onLogoutAdmin?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  exam,
  exams = [exam],
  sessions,
  activeExamId,
  onSetActiveExam,
  onRefreshData,
  onSaveExam,
  onSelectExam,
  onDeleteExam,
  onOpenTrf,
  adminUsername = 'Admin',
  onLogoutAdmin
}) => {
  const [activeTab, setActiveTab] = useState<'candidates' | 'exams' | 'registrations' | 'exam-dates' | 'writing' | 'speaking' | 'post_grading' | 'wizard' | 'settings'>('candidates');
  // Real catalog exam, or undefined when the catalog is empty. Grading and
  // review views render an empty state for undefined instead of falling back
  // to sample content.
  const catalogExam: Exam | undefined = (exams || []).some(x => x && exam && x.id === exam.id)
    ? exam
    : (exams || []).find(x => x && x.id === activeExamId) || undefined;
  // Blank starter used whenever there is no real exam to edit (empty
  // catalog) — the wizard must open empty, never with sample content.
  const freshBlankExam = (): Exam => {
    const ts = Date.now().toString().slice(-4);
    return buildBlankExam({
      id: `exam-ielts-${Date.now()}`,
      title: '',
      code: `IELTS-AC-${new Date().getFullYear()}-${ts}`,
      type: 'academic',
      description: ''
    });
  };
  const examIsInCatalog = (e?: Exam | null): boolean =>
    !!e && (exams || []).some(x => x && x.id === e.id);
  const [wizardExam, setWizardExam] = useState<Exam>(() => (examIsInCatalog(exam) ? exam : freshBlankExam()));
  const [wizardIsNew, setWizardIsNew] = useState<boolean>(() => !examIsInCatalog(exam));
  const wizardExamRef = React.useRef(wizardExam);
  wizardExamRef.current = wizardExam;
  // If the catalog loads (or becomes) empty while the wizard still shows the
  // built-in sample fallback, swap it for a blank form. Real drafts (any
  // other id) are never touched.
  useEffect(() => {
    if ((exams || []).length === 0 && wizardExamRef.current?.id === sampleExam.id) {
      setWizardExam(freshBlankExam());
      setWizardIsNew(true);
    }
  }, [exams]);
  const [pendingRegCount, setPendingRegCount] = useState<number>(0);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
    sessions[0]?.candidateId || ''
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const handleRefreshCohort = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const ok = (await onRefreshData()) !== false;
      await loadStorageStats();
      if (ok) {
        setRefreshMsg(`Cohort refreshed at ${new Date().toLocaleTimeString()}.`);
      } else {
        setRefreshMsg('Refresh incomplete — admin session may have expired. Please log out and back in.');
      }
    } catch {
      setRefreshMsg('Refresh failed — cannot reach the server. Check your connection.');
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 8000);
    }
  };

  // Poll or check pending registrations
  useEffect(() => {
    fetch('/api/registrations', { headers: getAdminAuthHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        if (Array.isArray(list)) {
          setPendingRegCount(list.filter((r: any) => r.status === 'pending' && isRecentRegistration(r.submittedAt, r.examDate)).length);
        }
      })
      .catch(() => {});
  }, [sessions]);

  // Platform capacity + retention stats (Free-tier envelope)
  const [storageStats, setStorageStats] = useState<{
    stats: { exams: number; sessions: number; registrations: number; files: number; r2Bytes: number };
    limits: { throughputPerDay: number; historyUsers: number; retentionDays: number; retentionMonths: number };
    retentionLastRun: string | null;
    retentionLastDeleted: { sessions: number; registrations: number; files: number } | null;
  } | null>(null);

  const loadStorageStats = async () => {
    try {
      const res = await fetch('/api/admin/storage-stats', { headers: getAdminAuthHeaders(), cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data?.success) setStorageStats(data);
      }
    } catch {}
  };

  useEffect(() => { loadStorageStats(); }, []);

  const handleOpenWizard = (examToEdit?: Exam, isNew?: boolean) => {
    if (isNew) {
      const ts = Date.now().toString().slice(-4);
      const newExam: Exam = {
        id: `exam-ielts-${Date.now()}`,
        code: `IELTS-AC-${new Date().getFullYear()}-${ts}`,
        title: `IELTS Academic Practice Test ${exams.length + 1}`,
        type: 'academic',
        description: 'Authentic 4-module official IELTS Academic examination simulation form.',
        centreNumber: 'GB120 - London Official IELTS Test Center',
        listening: JSON.parse(JSON.stringify(exam.listening)),
        reading: JSON.parse(JSON.stringify(exam.reading)),
        writing: JSON.parse(JSON.stringify(exam.writing)),
        speaking: exam.speaking
          ? JSON.parse(JSON.stringify(exam.speaking))
          : {
              title: 'Live Examiner Speaking Interview',
              part1: { topics: ['Work and studies', 'Hometown & neighbourhood', 'Free time & technology'] },
              part2: { cueCardTopic: 'Describe an important environmental or educational initiative you admire.' },
              part3: { discussionPrompts: ['Individual responsibility vs government regulation', 'Technological impact on future society'] }
            }
      };
      setWizardExam(newExam);
      setWizardIsNew(true);
    } else if (examToEdit) {
      setWizardExam(examToEdit);
      setWizardIsNew(false);
    } else if (examIsInCatalog(exam)) {
      setWizardExam(exam);
      setWizardIsNew(false);
    } else {
      setWizardExam(freshBlankExam());
      setWizardIsNew(true);
    }
    setActiveTab('wizard');
  };

  // Cancel in the wizard: throw the draft away and present a clean blank
  // form in place (the same reset as after Save & Deploy). New id forces a
  // full remount, so no draft state can survive.
  const handleCancelWizard = () => {
    setWizardExam(freshBlankExam());
    setWizardIsNew(true);
  };

  const handleSaveExamAndSwitch = async (updatedExam: Exam) => {    const result = await onSaveExam(updatedExam);
    // Stay in the wizard on failure so the error banner remains visible.
    if (result === false) return;
    if (onSelectExam) {
      onSelectExam(updatedExam.id);
    }
    // Reset the wizard in place to a blank form: after deploying, the admin
    // stays in the wizard on a clean slate ready to create the next exam
    // (the exam selector effect in ExamWizard picks the blank up, jumps back
    // to Step 1 and clears all per-exam editors).
    const ts = Date.now().toString().slice(-4);
    setWizardExam(buildBlankExam({
      id: `exam-ielts-${Date.now()}`,
      title: '',
      code: `IELTS-AC-${new Date().getFullYear()}-${ts}`,
      type: 'academic',
      description: ''
    }));
    setWizardIsNew(true);
  };

  const handleDuplicateExam = async (examToDuplicate: Exam) => {
    const ts = Date.now().toString().slice(-4);
    const duplicatedExam: Exam = {
      ...JSON.parse(JSON.stringify(examToDuplicate)),
      id: `exam-ielts-${Date.now()}`,
      code: `${examToDuplicate.code || 'IELTS-AC'}-COPY-${ts}`,
      title: `${examToDuplicate.title} (Copy)`
    };
    const result = await onSaveExam(duplicatedExam);
    if (result === false) {
      alert(`Cannot duplicate: the exam catalog is full (${MAX_EXAMS}/${MAX_EXAMS}). Delete an exam first.`);
      return;
    }
    if (onSelectExam) {
      onSelectExam(duplicatedExam.id);
    }
  };

  // Statistics
  const totalCount = sessions.length;
  const lockedCount = sessions.filter(s => s.lockStatus.isLocked || s.status === 'hard_locked').length;
  const awaitingGradingCount = sessions.filter(s => s.status === 'completed' && !s.grading.isFinalized).length;
  const finalizedCount = sessions.filter(s => s.grading.isFinalized).length;

  // Handlers
  const handleResetSession = async (candidateId: string) => {
    try {
      const res = await fetch(`/api/sessions/${candidateId}/reset-session`, {
        method: 'POST',
        headers: getAdminAuthHeaders()
      });
      if (res.ok) {
        await onRefreshData();
      }
    } catch (e) {
      console.error('Failed to reset session:', e);
    }
  };

  const handleCreateCandidate = async (profileData: CandidateProfileData) => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminAuthHeaders()
        },
        body: JSON.stringify({
          ...profileData,
          examId: profileData.examId || exam.id
        })
      });
      if (res.ok) {
        await onRefreshData();
      }
    } catch (e) {
      console.error('Failed to create candidate:', e);
    }
  };

  const handleUpdateCandidateProfile = async (candidateId: string, profileData: Partial<CandidateProfileData>) => {
    try {
      const res = await fetch(`/api/sessions/${candidateId}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminAuthHeaders()
        },
        body: JSON.stringify(profileData)
      });
      if (res.ok) {
        await onRefreshData();
      }
    } catch (e) {
      console.error('Failed to update candidate profile:', e);
    }
  };

  const handleRunAiEvaluation = async (candidateId: string): Promise<WritingAiEvaluation> => {
    const res = await fetch(`/api/grading/${candidateId}/writing-ai`, {
      method: 'POST',
      headers: getAdminAuthHeaders()
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      throw new Error(errData?.error || `AI grading failed (server ${res.status}).`);
    }
    const data = await res.json();
    await onRefreshData();
    return data.aiEvaluation;
  };

  const handleSaveWritingGrade = async (
    candidateId: string,
    overallBand: number,
    task1Band: { ta_tr: number; cc: number; lr: number; gra: number; overall: number },
    task2Band: { ta_tr: number; cc: number; lr: number; gra: number; overall: number },
    examinerFeedback: string,
    comments: WritingComment[]
  ) => {
    await fetch(`/api/grading/${candidateId}/writing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAdminAuthHeaders()
      },
      body: JSON.stringify({
        overallBand,
        task1Band,
        task2Band,
        examinerFeedback,
        comments
      })
    });
    await onRefreshData();
  };

  const handleSaveSpeakingGrade = async (candidateId: string, evaluation: SpeakingEvaluation) => {
    await fetch(`/api/grading/${candidateId}/speaking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAdminAuthHeaders()
      },
      body: JSON.stringify(evaluation)
    });
    await onRefreshData();
  };

  const handleGlobalAnswerEdit = async (questionId: string, newAcceptedAnswers: string[]) => {
    const res = await fetch(`/api/exams/${exam.id}/global-answer-edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAdminAuthHeaders()
      },
      body: JSON.stringify({ questionId, newAcceptedAnswers })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.success === false) {
      throw new Error(data?.error || `Server rejected the global answer edit (status ${res.status}). No changes applied.`);
    }
    await onRefreshData();
    return {
      affectedCount: data.affectedCandidatesCount ?? data.affectedCandidateCount ?? 0,
      message: data.message || 'Answer key updated and cohort recalculated.'
    };
  };

  const handleOverrideCandidateQuestion = async (
    candidateId: string,
    module: 'listening' | 'reading',
    questionId: string,
    isCorrect: boolean
  ) => {
    await fetch(`/api/grading/${candidateId}/override-question`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAdminAuthHeaders()
      },
      body: JSON.stringify({ module, questionId, isCorrect })
    });
    await onRefreshData();
  };

  const handleFinalizeCandidateExam = async (candidateId: string) => {
    try {
      const res = await fetch(`/api/sessions/${candidateId}/finalize-exam`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminAuthHeaders()
        }
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success !== false) {
        await onRefreshData();
      } else {
        const missing = Array.isArray(data?.missing) ? data.missing.join(', ') : null;
        alert(
          `Cannot finalize ${candidateId}: ${data?.error || 'server rejected the request.'}` +
          (missing ? `\nPending: ${missing}` : '')
        );
      }
    } catch (e) {
      console.error('Failed to finalize candidate exam:', e);
      alert(`Cannot finalize ${candidateId}: network or server error.`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Admin Top Session Security Bar */}
      <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-slate-900/10 border border-slate-800">
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm tracking-tight text-white">IELTS Gate Examination Authority</span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Authorized Admin Session
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 flex-wrap">
              <span>Invigilator:</span>
              <span className="font-mono font-bold text-orange-400 bg-orange-950/60 px-2 py-0.5 rounded border border-orange-500/30">
                {adminUsername}
              </span>
              <span>• Chief Proctor &amp; Senior Examiner</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 self-start sm:self-auto">
          <button
            onClick={handleRefreshCohort}
            disabled={refreshing}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-200 border border-slate-700 transition cursor-pointer"
            title="Refresh All Cohort Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh Cohort'}</span>
          </button>

          {onLogoutAdmin && (
            <button
              onClick={onLogoutAdmin}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/40 transition cursor-pointer"
              title="Lock Admin Console & Log Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          )}
        </div>
      </div>
      {refreshMsg && (
        <div className={`rounded-xl border px-3.5 py-2 text-xs font-medium ${
          refreshMsg.startsWith('Cohort refreshed')
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          {refreshMsg}
        </div>
      )}

      {/* Top Admin Metric Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Cohort Roster</span>
            <span className="text-xl font-black text-slate-900 font-mono">{totalCount} Candidates</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Lockdown Alerts</span>
            <span className="text-xl font-black text-rose-600 font-mono">{lockedCount} Hard Locked</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Pending Review</span>
            <span className="text-xl font-black text-amber-700 font-mono">{awaitingGradingCount} Awaiting</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">TRFs Finalized</span>
            <span className="text-xl font-black text-emerald-700 font-mono">{finalizedCount} Certified</span>
          </div>
        </div>
      </div>

      {/* Platform Capacity & Data Retention (Free-tier envelope) */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Platform Capacity &amp; Data Retention</h3>
              <p className="text-[11px] text-slate-500">Candidate results are kept for 6 months (180 days), then auto-deleted. Speaking voice memos are kept 7 days.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Automatic nightly cleanup · 02:00 UTC</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Throughput</span>
            <span className="text-lg font-black text-slate-900 font-mono">~{storageStats?.limits.throughputPerDay || 125}/day</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">History Capacity</span>
            <span className="text-lg font-black text-slate-900 font-mono">~{((storageStats?.limits.historyUsers || 38000) / 1000).toFixed(0)}K users</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Retention</span>
            <span className="text-lg font-black text-slate-900 font-mono">{storageStats?.limits.retentionDays || 180} days</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3" title="Photos, receipts, audio and diagrams stored in the file bucket">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block flex items-center justify-center gap-1">
              <HardDrive className="w-3 h-3" /> R2 File Storage
            </span>
            <span className="text-lg font-black text-slate-900 font-mono">
              {storageStats
                ? `${(storageStats.stats.r2Bytes / 1048576).toFixed(1)} MB · ${storageStats.stats.files} files`
                : '—'}
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-slate-500">
          <span>
            {storageStats
              ? `${storageStats.stats.exams} exams · ${storageStats.stats.sessions} candidate sessions · ${storageStats.stats.registrations} registrations`
              : 'Loading storage figures…'}
          </span>
          <span>
            Last auto-cleanup:{' '}
            <strong className="text-slate-700">
              {storageStats?.retentionLastRun
                ? `${formatDateTime(storageStats.retentionLastRun)} (sessions ${storageStats.retentionLastDeleted?.sessions || 0}, registrations ${storageStats.retentionLastDeleted?.registrations || 0}, files ${storageStats.retentionLastDeleted?.files || 0})`
                : 'not run yet — daily at 02:00 UTC'}
            </strong>
          </span>
        </div>
      </div>

      {/* Main Admin Navigation Tabs */}
      <div className="flex space-x-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('candidates')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'candidates'
              ? 'bg-orange-500 text-white shadow-xs font-bold'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Candidates &amp; Lockdown</span>
        </button>

        <button
          onClick={() => setActiveTab('exams')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'exams'
              ? 'bg-orange-500 text-white shadow-xs font-bold'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Posted Exams</span>
        </button>

        <button
          onClick={() => setActiveTab('registrations')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'registrations'
              ? 'bg-cyan-600 text-white shadow-xs font-bold'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <CreditCard className="w-4 h-4 text-cyan-600" />
          <span>m10 Registrations</span>
          {pendingRegCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-amber-400 text-amber-950">
              {pendingRegCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('exam-dates')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'exam-dates'
              ? 'bg-violet-600 text-white shadow-xs font-bold'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>By Exam Date</span>
        </button>

        <button
          onClick={() => setActiveTab('wizard')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'wizard'
              ? 'bg-orange-500 text-white shadow-xs font-bold'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <PenTool className="w-4 h-4" />
          <span>Exam Authoring Wizard</span>
        </button>

        <button
          onClick={() => setActiveTab('writing')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'writing'
              ? 'bg-orange-500 text-white shadow-xs font-bold'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <PenTool className="w-4 h-4" />
          <span>Writing (AI + Override)</span>
        </button>

        <button
          onClick={() => setActiveTab('speaking')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'speaking'
              ? 'bg-orange-500 text-white shadow-xs font-bold'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Mic className="w-4 h-4" />
          <span>Live Speaking Room</span>
        </button>

        <button
          onClick={() => setActiveTab('post_grading')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'post_grading'
              ? 'bg-orange-500 text-white shadow-xs font-bold'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>Post-Grading &amp; Global Recalculate</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-cyan-600 text-white shadow-xs font-bold'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Exam Price &amp; m10 Settings</span>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'candidates' && (
        <CandidateManagement
          sessions={sessions}
          exams={exams}
          activeExamId={activeExamId}
          onSelectCandidate={id => {
            setSelectedCandidateId(id);
            setActiveTab('writing');
          }}
          onResetSession={handleResetSession}
          onCreateCandidate={handleCreateCandidate}
          onUpdateCandidateProfile={handleUpdateCandidateProfile}
          onFinalizeExam={handleFinalizeCandidateExam}
          onOpenTrf={onOpenTrf}
          onRefreshSessions={async () => { await onRefreshData(); }}
        />
      )}

      {activeTab === 'exams' && (
        <PostedExamsView
          exam={exam}
          exams={exams}
          sessions={sessions}
          activeExamId={activeExamId}
          onSetActiveExam={onSetActiveExam}
          onRefreshExams={async () => { await onRefreshData(); }}
          onSaveExam={onSaveExam}
          onDuplicateExam={handleDuplicateExam}
          onSelectExam={id => {
            if (onSelectExam) onSelectExam(id);
          }}
          onOpenWizard={handleOpenWizard}
          onOpenGrading={examForGrading => {
            if (examForGrading && onSelectExam) onSelectExam(examForGrading.id);
            setActiveTab('post_grading');
          }}
          onOpenCandidates={examId => {
            setActiveTab('candidates');
          }}
          onDeleteExam={onDeleteExam}
        />
      )}

      {activeTab === 'registrations' && (
        <RegistrationApprovalsView
          onRefreshSessions={async () => { await onRefreshData(); }}
          onSelectCandidate={id => {
            setSelectedCandidateId(id);
            setActiveTab('candidates');
          }}
        />
      )}

      {activeTab === 'exam-dates' && (
        <ExamDateCapacityView sessions={sessions} />
      )}

      {activeTab === 'writing' && (
        <WritingGradingView
          candidates={sessions}
          selectedCandidateId={selectedCandidateId}
          exam={catalogExam}
          onSelectCandidate={setSelectedCandidateId}
          onSaveWritingGrade={handleSaveWritingGrade}
          onRunAiEvaluation={handleRunAiEvaluation}
        />
      )}

      {activeTab === 'speaking' && (
        <SpeakingExaminerRoom
          candidates={sessions}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={setSelectedCandidateId}
          onSaveSpeakingGrade={handleSaveSpeakingGrade}
        />
      )}

      {activeTab === 'post_grading' && (
        <PostGradingReview
          exam={catalogExam}
          candidates={sessions}
          onGlobalAnswerEdit={handleGlobalAnswerEdit}
          onOverrideCandidateQuestion={handleOverrideCandidateQuestion}
          onRefreshData={async () => { await onRefreshData(); }}
        />
      )}

      {activeTab === 'wizard' && (
        <ExamWizard
          key={wizardExam.id}
          currentExam={wizardExam}
          onSaveExam={handleSaveExamAndSwitch}
          onCancel={handleCancelWizard}
          onBackToList={() => setActiveTab('exams')}
          isNewExam={wizardIsNew}
        />
      )}

      {activeTab === 'settings' && (
        <SystemSettingsView />
      )}
    </div>
  );
};
