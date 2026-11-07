import React, { useState, useEffect } from 'react';
import {
  Layers,
  Headphones,
  BookOpen,
  PenTool,
  Mic,
  Clock,
  CheckCircle2,
  Users,
  Edit3,
  ChevronRight,
  Sparkles,
  FileText,
  Eye,
  BarChart3,
  ShieldCheck,
  Plus,
  Trash2,
  Search,
  Filter,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  Copy,
  X
} from 'lucide-react';
import { Exam, CandidateSession, MAX_EXAMS, getExamResultsReleaseMs, isExamPaperReleased } from '../../types';
import { countQuestionSlots } from '../../utils/ieltsScoring';
import { buildBlankExam } from '../../data/sampleExam';
import { ExamPreviewModal } from './ExamPreviewModal';

interface PostedExamsViewProps {
  exam: Exam;
  exams?: Exam[];
  sessions: CandidateSession[];
  activeExamId?: string | null;
  onSetActiveExam?: (examId: string | null) => Promise<void>;
  onOpenWizard: (examToEdit?: Exam, isNew?: boolean) => void;
  onOpenGrading: (exam?: Exam) => void;
  onOpenCandidates: (examId?: string) => void;
  onSelectExam?: (examId: string) => void;
  onDeleteExam?: (examId: string) => Promise<void>;
  onDuplicateExam?: (exam: Exam) => Promise<void>;
  onSaveExam?: (newExam: Exam) => Promise<boolean | void>;
  onRefreshExams?: () => Promise<void>;
}

export const PostedExamsView: React.FC<PostedExamsViewProps> = ({
  exam,
  exams,
  sessions,
  activeExamId,
  onSetActiveExam,
  onOpenWizard,
  onOpenGrading,
  onOpenCandidates,
  onSelectExam,
  onDeleteExam,
  onDuplicateExam,
  onSaveExam,
  onRefreshExams
}) => {
  const [selectedSection, setSelectedSection] = useState<'all' | 'listening' | 'reading' | 'writing' | 'speaking'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'academic' | 'general_training'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [previewExam, setPreviewExam] = useState<Exam | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveExams, setLiveExams] = useState<Exam[]>(exams || []);

  // Quick Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newExamTitle, setNewExamTitle] = useState('');
  const [newExamCode, setNewExamCode] = useState('');
  const [newExamType, setNewExamType] = useState<'academic' | 'general_training'>('academic');
  const [newExamDescription, setNewExamDescription] = useState('');
  const [newExamTemplate, setNewExamTemplate] = useState<'active' | 'clean'>('active');
  const [isCreatingExam, setIsCreatingExam] = useState(false);
  const [createSuccessMsg, setCreateSuccessMsg] = useState<string | null>(null);
  const [catalogErrorMsg, setCatalogErrorMsg] = useState<string | null>(null);

  const refreshList = async () => {
    setIsRefreshing(true);
    try {
      if (onRefreshExams) await onRefreshExams();
      const res = await fetch('/api/exams', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        // Sync even when empty — otherwise a deleted last exam stays visible.
        if (Array.isArray(data)) {
          setLiveExams(data);
        }
      }
    } catch (e) {
      console.warn('Failed to refresh exams:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // Sync even when empty — otherwise a deleted last exam stays visible.
    setLiveExams(exams || []);
  }, [exams]);

  // Determine full, deduplicated list of exams (merging props + live state)
  const allExams = React.useMemo(() => {
    const map = new Map<string, Exam>();
    // Primary authoritative source: props from parent state
    (exams || []).forEach(e => {
      if (e && e.id) map.set(e.id, e);
    });
    // Secondary source: fetched live exams
    (liveExams || []).forEach(e => {
      if (e && e.id && !map.has(e.id)) map.set(e.id, e);
    });
    // Ensure inspected exam is included — but only if it is actually in the
    // catalog. Never inject fallbacks (e.g. sample content) as ghost entries.
    if (exam && exam.id && map.has(exam.id)) {
      map.set(exam.id, exam);
    }
    return Array.from(map.values());
  }, [exams, liveExams, exam]);

  // Compute the 1 active exam, or null if no exam is active
  const currentActiveExam: Exam | null = React.useMemo(() => {
    if (activeExamId === null || activeExamId === '' || activeExamId === 'none') {
      return null;
    }
    if (activeExamId) {
      const match = allExams.find(e => e.id === activeExamId);
      if (match) return match;
      // Stale id (exam was deleted) — nothing is genuinely active.
      return null;
    }
    return exam || allExams[0] || null;
  }, [activeExamId, allExams, exam]);

  const inspectedExam: Exam | undefined =
    (exam && allExams.find(e => e.id === exam.id)) || currentActiveExam || allExams[0];
  const activeExam: Exam | undefined = inspectedExam;

  const handleOpenCreateModal = () => {
    // Intentionally blank — no default texts. Admin fills in everything.
    setNewExamTitle('');
    setNewExamCode('');
    setNewExamType('academic');
    setNewExamDescription('');
    setNewExamTemplate('clean');
    setShowCreateModal(true);
  };

  const atExamLimit = allExams.length >= MAX_EXAMS;

  const handleCreateExamSubmit = async (openWizardAfter = false) => {
    if (!newExamTitle.trim()) return;
    setCatalogErrorMsg(null);
    if (allExams.length >= MAX_EXAMS) {
      setCatalogErrorMsg(`Exam catalog is full (${MAX_EXAMS}/${MAX_EXAMS}). Delete an existing exam before creating a new one.`);
      return;
    }
    setIsCreatingExam(true);
    try {
      const ts = Date.now().toString().slice(-4);
      const newExamId = `exam-ielts-${Date.now()}`;
      const codeToUse = newExamCode.trim() || `IELTS-${newExamType === 'general_training' ? 'GT' : 'AC'}-${new Date().getFullYear()}-${ts}`;

      let newExam: Exam;
      if (newExamTemplate === 'clean') {
        // Start blank: empty sections, passages and prompts — nothing copied.
        newExam = buildBlankExam({
          id: newExamId,
          title: newExamTitle.trim(),
          code: codeToUse,
          type: newExamType,
          description: newExamDescription.trim()
        });
      } else {
        const templateToUse = currentActiveExam || inspectedExam;
        if (!templateToUse) {
          // No source exam exists (empty catalog) — fall back to blank.
          newExam = buildBlankExam({
            id: newExamId,
            title: newExamTitle.trim(),
            code: codeToUse,
            type: newExamType,
            description: newExamDescription.trim()
          });
        } else {
          newExam = {
            ...JSON.parse(JSON.stringify(templateToUse)),
            id: newExamId,
            code: codeToUse,
            title: newExamTitle.trim(),
            type: newExamType,
            description: newExamDescription.trim() || 'Official IELTS Simulation Form',
            centreNumber: templateToUse?.centreNumber || 'AZ001 - Baku Official IELTS Test Center'
          };
        }
      }

      // 1. Immediately update local state
      setLiveExams(prev => [newExam, ...prev.filter(e => e.id !== newExam.id)]);

      // 2. Persist via parent handler (updates App.tsx state & saves to backend)
      if (onSaveExam) {
        const result = await onSaveExam(newExam);
        if (result === false) {
          setCatalogErrorMsg(`Could not create "${newExam.title}": the server rejected the save (the catalog may be full at ${MAX_EXAMS}/${MAX_EXAMS}).`);
          setIsCreatingExam(false);
          return;
        }
      }

      // 3. Select as active exam
      if (onSelectExam) {
        onSelectExam(newExam.id);
      }

      setCreateSuccessMsg(`"${newExam.title}" was successfully created and published in the Exam Forms Catalog!`);
      setShowCreateModal(false);
      setTimeout(() => setCreateSuccessMsg(null), 5000);

      if (openWizardAfter) {
        onOpenWizard(newExam, false);
      }
    } catch (e: any) {
      console.error('Failed to create new exam:', e);
      setCatalogErrorMsg('Failed to create the exam. Please try again.');
    } finally {
      setIsCreatingExam(false);
    }
  };

  const handleDuplicate = async (ex: Exam) => {
    if (!onDuplicateExam) return;
    setCatalogErrorMsg(null);
    if (allExams.length >= MAX_EXAMS) {
      setCatalogErrorMsg(`Exam catalog is full (${MAX_EXAMS}/${MAX_EXAMS}). Delete an existing exam before duplicating.`);
      return;
    }
    setDuplicatingId(ex.id);
    try {
      await onDuplicateExam(ex);
      setCreateSuccessMsg(`Exam "${ex.title}" duplicated and added to catalog!`);
      setTimeout(() => setCreateSuccessMsg(null), 4000);
    } finally {
      setDuplicatingId(null);
    }
  };

  // Filtered exams for catalog view
  const filteredExams = allExams.filter(e => {
    const matchesSearch =
      (e.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.code || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.id || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'all' || e.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const enrolledCount = sessions.filter(s => s.examId === activeExam?.id || !s.examId).length;
  const completedCount = sessions.filter(
    s => (s.examId === activeExam?.id || !s.examId) && (s.status === 'completed' || s.status === 'finalized')
  ).length;

  const listeningSections = activeExam?.listening?.sections || [];
  const listeningQCount = countQuestionSlots(listeningSections.flatMap(s => s.questions || []));
  const readingPassages = activeExam?.reading?.passages || [];
  const readingQCount = countQuestionSlots(readingPassages.flatMap(p => p.questions || []));

  const handleDelete = async (eId: string, eTitle: string) => {
    if (!onDeleteExam) return;
    const isLast = allExams.length <= 1;
    if (confirm(
      `Are you sure you want to delete "${eTitle}"? This will permanently remove this exam and its files.` +
      (isLast ? ' This is the last exam — candidate entry will stay closed until a new exam is created.' : '')
    )) {
      setDeletingId(eId);
      setCatalogErrorMsg(null);
      try {
        await onDeleteExam(eId);
        // If the deleted exam was the active one, clear the stale active id.
        if (currentActiveExam?.id === eId && onSetActiveExam) {
          try { await onSetActiveExam(null); } catch {}
        }
      } catch (e) {
        setCatalogErrorMsg(`Could not delete "${eTitle}": ${e instanceof Error ? e.message : 'unknown error'}`);
      } finally {
        setDeletingId(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5 mb-1.5">
            <div className="w-8 h-8 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
              <Layers className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">Posted &amp; Active Examinations</h2>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              {allExams.length}/{MAX_EXAMS} Published Test{allExams.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="text-xs text-slate-500 max-w-2xl">
            View, inspect, and manage exams available for candidates on IELTS Gate. You can edit exam questions, media recordings, and answer keys anytime using the Exam Authoring Wizard.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshList}
            disabled={isRefreshing}
            className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer"
            title="Refresh exam forms from database"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh ({allExams.length})</span>
          </button>
          <button
            onClick={handleOpenCreateModal}
            disabled={atExamLimit}
            title={atExamLimit ? `Catalog is full (${MAX_EXAMS}/${MAX_EXAMS}). Delete an exam to create a new one.` : 'Create a new exam form'}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white transition shadow-sm shadow-orange-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create New Exam</span>
          </button>
        </div>
      </div>

      {createSuccessMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center justify-between shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{createSuccessMsg}</span>
          </div>
          <button onClick={() => setCreateSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {catalogErrorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-center justify-between shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{catalogErrorMsg}</span>
          </div>
          <button onClick={() => setCatalogErrorMsg(null)} className="text-rose-700 hover:text-rose-900 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Exam Catalog & Switcher Ribbon */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Exam Forms Catalog</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {filteredExams.length} of {allExams.length}
            </span>
            {currentActiveExam ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Active: {currentActiveExam.title}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
                <AlertCircle className="w-3 h-3 text-amber-600" />
                <span>No Active Exam</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search posted exams..."
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Type Filter */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px] font-semibold text-slate-600">
              <button
                onClick={() => setTypeFilter('all')}
                className={`px-2.5 py-1 rounded-md transition cursor-pointer ${typeFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
              >
                All
              </button>
              <button
                onClick={() => setTypeFilter('academic')}
                className={`px-2.5 py-1 rounded-md transition cursor-pointer ${typeFilter === 'academic' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
              >
                Academic
              </button>
              <button
                onClick={() => setTypeFilter('general_training')}
                className={`px-2.5 py-1 rounded-md transition cursor-pointer ${typeFilter === 'general_training' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
              >
                General
              </button>
            </div>
          </div>
        </div>

        {/* Exam Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredExams.map(ex => {
            const isCurrent = ex.id === currentActiveExam?.id;
            const exEnrolled = sessions.filter(s => s.examId === ex.id || (!s.examId && ex.id === allExams[0]?.id)).length;
            const exCompleted = sessions.filter(
              s => (s.examId === ex.id || (!s.examId && ex.id === allExams[0]?.id)) && (s.status === 'completed' || s.status === 'finalized')
            ).length;
            const exListeningCount = countQuestionSlots((ex.listening?.sections || []).flatMap(s => s.questions || []));
            const exReadingCount = countQuestionSlots((ex.reading?.passages || []).flatMap(p => p.questions || []));

            return (
              <div
                key={ex.id}
                className={`border rounded-xl p-4 transition flex flex-col justify-between ${
                  isCurrent
                    ? 'border-orange-400 bg-orange-50/20 shadow-xs ring-1 ring-orange-400/30'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[10px] font-black px-2 py-0.5 rounded-md bg-orange-100 text-orange-800 border border-orange-200">
                        {ex.code || ex.id}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {ex.type === 'general_training' ? 'General Training' : 'Academic'}
                      </span>
                    </div>

                    {isCurrent ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          Active
                        </span>
                        {onSetActiveExam && (
                          <button
                            type="button"
                            onClick={() => onSetActiveExam(null)}
                            className="text-[10px] text-slate-400 hover:text-rose-600 underline cursor-pointer"
                            title="Deactivate this exam"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    ) : onSetActiveExam ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (exListeningCount + exReadingCount === 0 && !window.confirm(
                            `"${ex.title}" has no questions yet. Candidates who enter will find empty sections. Activate anyway?`
                          )) return;
                          onSetActiveExam(ex.id);
                        }}
                        className="text-[10px] font-bold text-orange-600 hover:text-orange-700 hover:underline cursor-pointer flex items-center gap-1"
                        title="Make this the 1 active exam for candidates"
                      >
                        <ShieldCheck className="w-3 h-3" />
                        <span>Make Active</span>
                      </button>
                    ) : null}
                  </div>

                  <div>
                    <h4 className="font-bold text-sm text-slate-900 leading-snug">{ex.title}</h4>
                    <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                      {ex.description || 'Official IELTS Simulation Form'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-500 pt-1 font-mono">
                    <span className="bg-slate-50 px-2 py-1 rounded border border-slate-100">
                      🎧 {exListeningCount}Q Listening
                    </span>
                    <span className="bg-slate-50 px-2 py-1 rounded border border-slate-100">
                      📖 {exReadingCount}Q Reading
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 text-xs">
                  <span className="text-[11px] text-slate-500 font-mono">
                    {exEnrolled} Cand. • {exCompleted} TRFs
                  </span>

                  <div className="flex items-center gap-1">
                    {onSelectExam && !isCurrent && (
                      <button
                        onClick={() => onSelectExam(ex.id)}
                        className="px-2 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md cursor-pointer transition"
                      >
                        Inspect
                      </button>
                    )}
                    {onDuplicateExam && (
                      <button
                        onClick={() => handleDuplicate(ex)}
                        disabled={duplicatingId === ex.id || atExamLimit}
                        className="px-2 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md cursor-pointer transition flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={atExamLimit ? `Catalog is full (${MAX_EXAMS}/${MAX_EXAMS})` : 'Duplicate Exam'}
                      >
                        <Copy className="w-3 h-3 text-slate-500" />
                        <span>{duplicatingId === ex.id ? '...' : 'Duplicate'}</span>
                      </button>
                    )}
                    <button
                      onClick={() => setPreviewExam(ex)}
                      className="px-2 py-1 text-[11px] font-semibold bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-md cursor-pointer transition flex items-center gap-1"
                      title="Preview as candidates will see it (with answer keys)"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Preview</span>
                    </button>
                    <button
                      onClick={() => onOpenWizard(ex, false)}
                      className="px-2 py-1 text-[11px] font-bold bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-md cursor-pointer transition flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                    {onDeleteExam && (
                      <button
                        onClick={() => handleDelete(ex.id, ex.title)}
                        disabled={deletingId === ex.id}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer transition"
                        title="Delete Exam"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredExams.length === 0 && (
          <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
            <Layers className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs font-semibold text-slate-700">No matching examinations found</p>
            <p className="text-[11px] text-slate-500">Create a new test or adjust your search filter above.</p>
            <button
              onClick={handleOpenCreateModal}
              className="mt-2 inline-flex items-center space-x-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold cursor-pointer transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Mock Exam</span>
            </button>
          </div>
        )}
      </div>

      {/* Selected Exam Deep Module Inspector */}
      {activeExam ? (
      <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
        {/* Top Card Header */}
        <div className="bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent p-6 border-b border-slate-200/80">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-orange-100 text-orange-800 border border-orange-200">
                  {activeExam?.code || activeExam?.id}
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  {activeExam?.type === 'general_training' ? 'IELTS General Training' : 'IELTS Academic'}
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  Full 4-Module Simulation
                </span>
              </div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">{activeExam?.title}</h3>
              <p className="text-xs text-slate-500 mt-1 font-mono">Exam ID: {activeExam?.id}</p>
              {activeExam?.examTime2 && (() => {
                if (activeExam?.resultsReleased) {
                  return <p className="text-[11px] font-bold text-emerald-700 mt-1">Results released — candidates of both slots can see their papers.</p>;
                }
                const rel = getExamResultsReleaseMs(activeExam);
                return (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Two sessions this day ({activeExam?.examTime} + {activeExam?.examTime2}) — candidate papers unlock{' '}
                    {rel ? <>automatically around <strong className="text-slate-700">{new Date(rel).toLocaleString()}</strong></> : 'after the second session'}
                    {isExamPaperReleased(activeExam) ? <strong className="text-emerald-700"> (unlocked now)</strong> : null}.
                  </p>
                );
              })()}
            </div>

            {/* Quick Metrics */}
            <div className="flex items-center gap-3">
              <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-200/90 shadow-2xs text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Duration</span>
                <span className="text-sm font-black text-slate-800 font-mono">~175 Mins</span>
              </div>
              <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-200/90 shadow-2xs text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Candidates</span>
                <span className="text-sm font-black text-orange-600 font-mono">{enrolledCount} Active</span>
              </div>
              <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-200/90 shadow-2xs text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Completed</span>
                <span className="text-sm font-black text-emerald-600 font-mono">{completedCount} TRFs</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section Filter Pills */}
        <div className="px-6 py-3 bg-slate-50/70 border-b border-slate-200/80 flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-2">Module View:</span>
          <button
            onClick={() => setSelectedSection('all')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
              selectedSection === 'all'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            All Modules (4)
          </button>
          <button
            onClick={() => setSelectedSection('listening')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              selectedSection === 'listening'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>Listening ({listeningQCount}Q)</span>
          </button>
          <button
            onClick={() => setSelectedSection('reading')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              selectedSection === 'reading'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Reading ({readingQCount}Q)</span>
          </button>
          <button
            onClick={() => setSelectedSection('writing')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              selectedSection === 'writing'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Writing (2 Tasks)</span>
          </button>
          <button
            onClick={() => setSelectedSection('speaking')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              selectedSection === 'speaking'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Speaking (3 Parts)</span>
          </button>
        </div>

        {/* Modules Content Cards */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. LISTENING MODULE CARD */}
          {(selectedSection === 'all' || selectedSection === 'listening') && (
            <div className="border border-slate-200 rounded-xl p-5 bg-white hover:border-orange-200 hover:shadow-xs transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                    <Headphones className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">{activeExam?.listening?.title || 'Listening Module'}</h4>
                    <span className="text-[11px] text-slate-500">{listeningSections.length} Sections • 30 Mins + Transfer</span>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {listeningQCount} Questions
                </span>
              </div>

              <div className="space-y-2 mt-4">
                {listeningSections.length > 0 ? (
                  listeningSections.map(sec => (
                    <div key={sec.id} className="text-xs bg-slate-50 rounded-lg p-2.5 border border-slate-200/80">
                      <div className="flex items-center justify-between font-semibold text-slate-800">
                        <span>{sec.title}</span>
                        <span className="text-[10px] font-mono text-orange-600 font-bold">{sec.questions?.length || 0} Qs</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                        {sec.audioUrl ? (
                          <span className="text-emerald-600 font-medium">🎧 {sec.audioSourceType === 'youtube' ? 'YouTube Audio Linked' : 'Audio File / Recording Uploaded'}</span>
                        ) : sec.audioScriptSnippet && sec.audioScriptSnippet.trim() ? (
                          <span className="text-amber-600 font-medium">🗣️ TTS Voice Script Fallback</span>
                        ) : (
                          <span className="text-slate-400 font-medium">🔇 No audio (silent)</span>
                        )}
                        <span>•</span>
                        <span>~{sec.audioDurationSeconds || 45}s test stream</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-500 text-xs">
                    No listening sections added yet. Click &quot;Edit in Wizard&quot; to configure.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. READING MODULE CARD */}
          {(selectedSection === 'all' || selectedSection === 'reading') && (
            <div className="border border-slate-200 rounded-xl p-5 bg-white hover:border-orange-200 hover:shadow-xs transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">{exam.reading.title}</h4>
                    <span className="text-[11px] text-slate-500">{exam.reading.passages.length} Academic Passages • {exam.reading.durationMinutes || 60} Mins</span>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {readingQCount} Questions
                </span>
              </div>

              <div className="space-y-2 mt-4">
                {readingPassages.length > 0 ? (
                  readingPassages.map(pas => (
                    <div key={pas.id} className="text-xs bg-slate-50 rounded-lg p-2.5 border border-slate-200/80">
                      <div className="flex items-center justify-between font-semibold text-slate-800">
                        <span>{pas.title}</span>
                        <span className="text-[10px] font-mono text-orange-600 font-bold">{pas.questions?.length || 0} Qs</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">
                        {(pas.text || (pas as any).content || '').slice(0, 90)}...
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-500 text-xs">
                    No reading passages added yet. Click &quot;Edit in Wizard&quot; to configure.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. WRITING MODULE CARD */}
          {(selectedSection === 'all' || selectedSection === 'writing') && (
            <div className="border border-slate-200 rounded-xl p-5 bg-white hover:border-orange-200 hover:shadow-xs transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                    <PenTool className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">{activeExam?.writing?.title || 'Writing Module'}</h4>
                    <span className="text-[11px] text-slate-500">Task 1 (Report) + Task 2 (Essay) • {activeExam?.writing?.durationMinutes || 60} Mins</span>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                  AI Evaluator Ready
                </span>
              </div>

              <div className="space-y-2.5 mt-4">
                <div className="text-xs bg-slate-50 rounded-lg p-2.5 border border-slate-200/80">
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span>{activeExam?.writing?.task1?.title || 'Task 1: Academic Report'}</span>
                    <span className="text-[10px] text-slate-500">Min {activeExam?.writing?.task1?.minWords || 150} words</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-600">
                    {(activeExam?.writing?.task1?.visualMode === 'upload' || (activeExam?.writing?.task1?.visualMode as any) === 'image') && activeExam?.writing?.task1?.imageUrl ? (
                      <span className="text-orange-600 font-semibold flex items-center gap-1">
                        🖼️ Custom Diagram / Image Uploaded
                      </span>
                    ) : (
                      <span className="text-slate-600 flex items-center gap-1">
                        📊 Built-in Chart &amp; Data Summary
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">{activeExam?.writing?.task1?.prompt || 'Summarize the chart information.'}</p>
                </div>

                <div className="text-xs bg-slate-50 rounded-lg p-2.5 border border-slate-200/80">
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span>{activeExam?.writing?.task2?.title || 'Task 2: Discursive Essay'}</span>
                    <span className="text-[10px] text-slate-500">Min {activeExam?.writing?.task2?.minWords || 250} words</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">{activeExam?.writing?.task2?.prompt || 'Write an essay discussing the given topic.'}</p>
                </div>
              </div>
            </div>
          )}

          {/* 4. SPEAKING MODULE CARD */}
          {(selectedSection === 'all' || selectedSection === 'speaking') && (
            <div className="border border-slate-200 rounded-xl p-5 bg-white hover:border-orange-200 hover:shadow-xs transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                    <Mic className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">{activeExam?.speaking?.title || 'Speaking Module'}</h4>
                    <span className="text-[11px] text-slate-500">3 Structured Parts • 11–14 Mins</span>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Examiner Room
                </span>
              </div>

              <div className="space-y-2 mt-4">
                <div className="text-xs bg-slate-50 rounded-lg p-2.5 border border-slate-200/80">
                  <div className="font-semibold text-slate-800">Part 1: Introduction &amp; Familiar Topics</div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {activeExam?.speaking?.part1?.topics ? activeExam.speaking.part1.topics.join(', ') : 'Personal background, hobbies, work/study'}
                  </p>
                </div>
                <div className="text-xs bg-slate-50 rounded-lg p-2.5 border border-slate-200/80">
                  <div className="font-semibold text-slate-800">Part 2: Individual Long Turn (Cue Card)</div>
                  <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                    {activeExam?.speaking?.part2?.cueCardTopic || 'Describe a notable experience or achievement.'}
                  </p>
                </div>
                <div className="text-xs bg-slate-50 rounded-lg p-2.5 border border-slate-200/80">
                  <div className="font-semibold text-slate-800">Part 3: Two-Way Discussion</div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {activeExam?.speaking?.part3?.discussionPrompts?.length || 0} Discussion Prompts
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Card Footer Actions */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Standardized CEFR A1–C2 / IELTS Band 0.0–9.0 rubrics applied.</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {activeExam?.examTime2 && !activeExam?.resultsReleased && (
              <button
                onClick={async () => {
                  if (!activeExam || !onSaveExam) return;
                  if (!window.confirm(`Release results for "${activeExam.title}" now? Candidates of both time slots will immediately see questions, answers and scores.`)) return;
                  const result = await onSaveExam({ ...activeExam, resultsReleased: true });
                  if (result === false) {
                    setCatalogErrorMsg(`Could not release results for "${activeExam.title}": the server rejected the save.`);
                  } else {
                    await refreshList();
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white transition shadow-2xs cursor-pointer flex items-center gap-1.5"
                title="Candidates currently see a 'results pending' screen — release immediately instead of waiting for the automatic moment"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Release Results Now</span>
              </button>
            )}
            <button
              onClick={() => activeExam && onOpenGrading(activeExam)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            >
              Inspect Answer Keys &amp; Regrade
            </button>
            <button
              onClick={() => activeExam && onOpenCandidates(activeExam.id)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            >
              View Enrolled Candidates ({enrolledCount})
            </button>
            <button
              onClick={() => activeExam && setPreviewExam(activeExam)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-violet-200 text-violet-700 hover:bg-violet-50 transition cursor-pointer flex items-center gap-1.5"
              title="Preview as candidates will see it (with answer keys)"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview Exam</span>
            </button>
            <button
              onClick={() => activeExam && onOpenWizard(activeExam, false)}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white transition shadow-2xs cursor-pointer flex items-center gap-1.5"
            >
              <span>Edit in Exam Wizard</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
      ) : (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center space-y-3">
          <Layers className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-900">No exams in the catalog</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">The catalog is empty. Create a new exam form to get started — candidate entry stays closed until an exam exists and is active.</p>
          <button
            onClick={handleOpenCreateModal}
            className="mt-1 inline-flex items-center space-x-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Exam</span>
          </button>
        </div>
      )}

      {/* Quick Create Exam Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">Create New IELTS Mock Exam</h3>
                  <p className="text-xs text-slate-500">Add an exam form directly to the active catalog.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Exam Title *
                </label>
                <input
                  type="text"
                  value={newExamTitle}
                  onChange={e => setNewExamTitle(e.target.value)}
                  placeholder="e.g. IELTS Academic Practice Test 3"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                    Exam Code *
                  </label>
                  <input
                    type="text"
                    value={newExamCode}
                    onChange={e => setNewExamCode(e.target.value)}
                    placeholder="Auto-generated if left empty"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-orange-500 uppercase"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                    Exam Format *
                  </label>
                  <select
                    value={newExamType}
                    onChange={e => setNewExamType(e.target.value as any)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="academic">IELTS Academic</option>
                    <option value="general_training">IELTS General Training</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Description / Subtitle
                </label>
                <input
                  type="text"
                  value={newExamDescription}
                  onChange={e => setNewExamDescription(e.target.value)}
                  placeholder="Brief description for candidate portal"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Starting Point
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewExamTemplate('clean')}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      newExamTemplate === 'clean'
                        ? 'border-orange-500 bg-orange-50/50 text-orange-950 font-bold ring-1 ring-orange-500/30'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="block text-xs">Start Blank</span>
                    <span className="text-[10px] font-normal text-slate-500 block mt-0.5">Empty sections — add your own questions</span>
                  </button>
                  {(!currentActiveExam && !inspectedExam) ? null : (
                  <button
                    type="button"
                    onClick={() => setNewExamTemplate('active')}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      newExamTemplate === 'active'
                        ? 'border-orange-500 bg-orange-50/50 text-orange-950 font-bold ring-1 ring-orange-500/30'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="block text-xs">Clone Active Test</span>
                    <span className="text-[10px] font-normal text-slate-500 block mt-0.5">Includes full 4-module questions &amp; audio</span>
                  </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isCreatingExam || !newExamTitle.trim()}
                onClick={() => handleCreateExamSubmit(true)}
                className="w-full sm:w-auto px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold cursor-pointer transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Create &amp; Edit in Wizard</span>
              </button>
              <button
                type="button"
                disabled={isCreatingExam || !newExamTitle.trim()}
                onClick={() => handleCreateExamSubmit(false)}
                className="w-full sm:w-auto px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-xs transition shadow-sm shadow-orange-500/25 cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isCreatingExam ? (
                  <span>Creating &amp; Publishing...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Create &amp; Add to Catalog</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Candidate-view exam preview (admin-only, answer keys visible) */}
      {previewExam && (
        <ExamPreviewModal exam={previewExam} onClose={() => setPreviewExam(null)} />
      )}
    </div>
  );
};
