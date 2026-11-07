import React, { useState, useMemo } from 'react';
import { Sparkles, PenTool, CheckCircle2, AlertTriangle, MessageSquare, Plus, Trash2, Sliders, ShieldCheck, RefreshCw, Eye, Image as ImageIcon, X, Search } from 'lucide-react';
import { CandidateSession, WritingAiEvaluation, WritingComment, Exam } from '../../types';
import { Task1Chart } from '../Task1Chart';

interface WritingGradingViewProps {
  candidates: CandidateSession[];
  selectedCandidateId: string;
  exam?: Exam;
  onSelectCandidate: (id: string) => void;
  onSaveWritingGrade: (
    candidateId: string,
    overallBand: number,
    task1Band: { ta_tr: number; cc: number; lr: number; gra: number; overall: number },
    task2Band: { ta_tr: number; cc: number; lr: number; gra: number; overall: number },
    examinerFeedback: string,
    comments: WritingComment[]
  ) => Promise<void>;
  onRunAiEvaluation: (candidateId: string) => Promise<WritingAiEvaluation>;
}

export const WritingGradingView: React.FC<WritingGradingViewProps> = ({
  candidates,
  selectedCandidateId,
  exam,
  onSelectCandidate,
  onSaveWritingGrade,
  onRunAiEvaluation
}) => {
  const currentCandidate = candidates.find(c => c.candidateId === selectedCandidateId) || candidates[0];
  const [zoomedDiagram, setZoomedDiagram] = useState<string | null>(null);

  const existingEval = currentCandidate?.grading.writingAdminEvaluation || currentCandidate?.grading.writingAiEvaluation;

  // Band states
  const [t1TA, setT1TA] = useState(existingEval?.task1Band?.ta_tr || 7.0);
  const [t1CC, setT1CC] = useState(existingEval?.task1Band?.cc || 7.0);
  const [t1LR, setT1LR] = useState(existingEval?.task1Band?.lr || 7.5);
  const [t1GRA, setT1GRA] = useState(existingEval?.task1Band?.gra || 7.0);

  const [t2TR, setT2TR] = useState(existingEval?.task2Band?.ta_tr || 7.5);
  const [t2CC, setT2CC] = useState(existingEval?.task2Band?.cc || 8.0);
  const [t2LR, setT2LR] = useState(existingEval?.task2Band?.lr || 8.0);
  const [t2GRA, setT2GRA] = useState(existingEval?.task2Band?.gra || 7.5);

  const [comments, setComments] = useState<WritingComment[]>(
    currentCandidate?.grading.writingAdminEvaluation?.comments || []
  );

  const [examinerFeedback, setExaminerFeedback] = useState(
    currentCandidate?.grading.writingAdminEvaluation?.examinerFeedback ||
    existingEval?.examinerFeedback ||
    'Strong command of academic vocabulary and logical paragraphing. Minor prepositions in Task 1 require attention.'
  );

  const [newStickyNote, setNewStickyNote] = useState('');
  const [selectedTextSnippet, setSelectedTextSnippet] = useState('');
  const [activeTaskForNote, setActiveTaskForNote] = useState<1 | 2>(2);
  const [candidateSearchQuery, setCandidateSearchQuery] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync state when candidate changes
  React.useEffect(() => {
    const evalData = currentCandidate?.grading.writingAdminEvaluation || currentCandidate?.grading.writingAiEvaluation;
    setT1TA(evalData?.task1Band?.ta_tr || 7.0);
    setT1CC(evalData?.task1Band?.cc || 7.0);
    setT1LR(evalData?.task1Band?.lr || 7.5);
    setT1GRA(evalData?.task1Band?.gra || 7.0);

    setT2TR(evalData?.task2Band?.ta_tr || 7.5);
    setT2CC(evalData?.task2Band?.cc || 8.0);
    setT2LR(evalData?.task2Band?.lr || 8.0);
    setT2GRA(evalData?.task2Band?.gra || 7.5);

    setComments(currentCandidate?.grading.writingAdminEvaluation?.comments || []);
    setExaminerFeedback(
      currentCandidate?.grading.writingAdminEvaluation?.examinerFeedback ||
      evalData?.examinerFeedback ||
      currentCandidate?.grading.writingAiEvaluation?.feedbackSummary ||
      'Strong command of academic vocabulary and logical paragraphing. Minor prepositions in Task 1 require attention.'
    );
  }, [currentCandidate?.candidateId]);

  // Derived Overall calculation (Task 2 has 2x weight of Task 1 in IELTS)
  const calcT1 = (t1TA + t1CC + t1LR + t1GRA) / 4;
  const calcT2 = (t2TR + t2CC + t2LR + t2GRA) / 4;
  const weightedWritingScore = (calcT1 + 2 * calcT2) / 3;
  // Round to nearest 0.5
  const roundedWritingBand = Math.round(weightedWritingScore * 2) / 2;

  const [aiError, setAiError] = useState<string | null>(null);

  // Candidate search: filter dropdown by ID or name, Search button jumps to first match
  const filteredCandidates = useMemo(() => {
    const q = candidateSearchQuery.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      c =>
        c.candidateId.toLowerCase().includes(q) ||
        c.candidateName.toLowerCase().includes(q)
    );
  }, [candidates, candidateSearchQuery]);

  const visibleCandidates = useMemo(() => {
    if (!currentCandidate) return filteredCandidates;
    if (filteredCandidates.some(c => c.candidateId === currentCandidate.candidateId)) {
      return filteredCandidates;
    }
    return [currentCandidate, ...filteredCandidates];
  }, [filteredCandidates, currentCandidate]);

  const handleCandidateSearch = () => {
    if (filteredCandidates.length > 0) {
      onSelectCandidate(filteredCandidates[0].candidateId);
    }
  };

  const handleRunAi = async () => {
    if (!currentCandidate) return;
    setIsAiLoading(true);
    setAiError(null);
    try {
      const aiResult = await onRunAiEvaluation(currentCandidate.candidateId);
      if (aiResult) {
        setT1TA(aiResult.task1Band.ta_tr);
        setT1CC(aiResult.task1Band.cc);
        setT1LR(aiResult.task1Band.lr);
        setT1GRA(aiResult.task1Band.gra);

        setT2TR(aiResult.task2Band.ta_tr);
        setT2CC(aiResult.task2Band.cc);
        setT2LR(aiResult.task2Band.lr);
        setT2GRA(aiResult.task2Band.gra);

        setExaminerFeedback(aiResult.examinerFeedback || aiResult.feedbackSummary || '');
      }
    } catch (e) {
      console.error(e);
      setAiError(e instanceof Error ? e.message : 'AI evaluation failed. Please try again.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleCaptureText = (taskNum: 1 | 2) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      setSelectedTextSnippet(sel.toString().trim());
      setActiveTaskForNote(taskNum);
    }
  };

  const handleAddStickyNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStickyNote.trim()) return;

    const noteItem: WritingComment = {
      id: `note-${Date.now()}`,
      task: activeTaskForNote,
      selectedText: selectedTextSnippet || `Task ${activeTaskForNote} passage`,
      note: newStickyNote.trim(),
      author: 'Senior Invigilator',
      timestamp: new Date().toISOString()
    };

    setComments([...comments, noteItem]);
    setNewStickyNote('');
    setSelectedTextSnippet('');
  };

  const handleDeleteComment = (id: string) => {
    setComments(comments.filter(c => c.id !== id));
  };

  const handleSaveFinalGrade = async () => {
    if (!currentCandidate) return;
    setIsSaving(true);
    setSaveSuccess(false);

    const task1Obj = {
      ta_tr: t1TA,
      cc: t1CC,
      lr: t1LR,
      gra: t1GRA,
      overall: Math.round(calcT1 * 2) / 2
    };

    const task2Obj = {
      ta_tr: t2TR,
      cc: t2CC,
      lr: t2LR,
      gra: t2GRA,
      overall: Math.round(calcT2 * 2) / 2
    };

    await onSaveWritingGrade(
      currentCandidate.candidateId,
      roundedWritingBand,
      task1Obj,
      task2Obj,
      examinerFeedback,
      comments
    );

    setIsSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const adjustScore = (setter: React.Dispatch<React.SetStateAction<number>>, val: number, delta: number) => {
    const next = Math.max(0, Math.min(9, Math.round((val + delta) * 2) / 2));
    setter(next);
  };

  // Empty catalog: no sample content — prompt to create a real exam first.
  if (!exam) {
    return (
      <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center space-y-3">
        <PenTool className="w-10 h-10 text-slate-300 mx-auto" />
        <h3 className="text-base font-bold text-slate-900">No exam to grade</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">Create an exam form in the Exam Authoring Wizard first — candidate writing responses and AI grading will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Candidate Selector & AI Trigger Header */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Writing Assessment &amp; AI Copilot</h2>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold uppercase">
              Human-In-The-Loop
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Gemini 1.5 Pro drafted rubric scores with full manual band override and interactive sticky notes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Candidate Search + Dropdown */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={candidateSearchQuery}
                onChange={e => setCandidateSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCandidateSearch();
                  }
                }}
                placeholder="Search ID or name..."
                aria-label="Search candidates"
                className="pl-8 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 w-44"
              />
              {candidateSearchQuery && (
                <button
                  type="button"
                  onClick={() => setCandidateSearchQuery('')}
                  aria-label="Clear candidate search"
                  className="absolute right-1.5 top-1.5 p-1 text-slate-400 hover:text-slate-600 rounded-md cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleCandidateSearch}
              disabled={filteredCandidates.length === 0}
              title={filteredCandidates.length > 0 ? `Jump to ${filteredCandidates[0].candidateId} — ${filteredCandidates[0].candidateName}` : 'No matching candidate'}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-700 active:bg-slate-800 text-white rounded-xl text-xs font-semibold transition shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search</span>
            </button>
          </div>
          <select
            value={currentCandidate?.candidateId}
            onChange={e => onSelectCandidate(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono max-w-[260px]"
            title={candidateSearchQuery ? `${filteredCandidates.length} of ${candidates.length} candidates match "${candidateSearchQuery}"` : `${candidates.length} candidates`}
          >
            {visibleCandidates.map(c => (
              <option key={c.candidateId} value={c.candidateId}>
                {c.candidateId} — {c.candidateName}
              </option>
            ))}
            {visibleCandidates.length === 0 && (
              <option disabled value="">
                No matching candidate
              </option>
            )}
          </select>

          {/* AI Trigger */}
          <button
            onClick={handleRunAi}
            disabled={isAiLoading}
            className="flex items-center space-x-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-xl text-xs font-semibold transition shadow-sm shadow-orange-500/25 disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isAiLoading ? 'animate-spin' : ''}`} />
            <span>{isAiLoading ? 'AI Grading Essay...' : 'Run Gemini AI Evaluation'}</span>
          </button>
          {aiError && (
            <div className="flex items-start space-x-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{aiError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Student Submissions with Sticky Notes (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Student Responses (Select text to anchor sticky note)
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {currentCandidate?.candidateName} ({currentCandidate?.candidateId})
              </span>
            </div>

            {/* Task 1 Reference Visual Diagram (Uploaded Picture or Built-in Summary) */}
            {exam?.writing?.task1 && (
              <div className="p-3.5 bg-orange-50/40 border border-orange-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ImageIcon className="w-4 h-4 text-orange-600" />
                    <span className="text-xs font-bold text-slate-900">Task 1 Material: {exam.writing.task1.title}</span>
                  </div>
                  {exam.writing.task1.imageUrl && (
                    <button
                      type="button"
                      onClick={() => setZoomedDiagram(exam.writing.task1.imageUrl!)}
                      className="flex items-center space-x-1 px-2 py-0.5 bg-white hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-md text-[11px] font-semibold cursor-pointer transition shadow-2xs"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Enlarge Diagram</span>
                    </button>
                  )}
                </div>

                {exam.writing.task1.imageUrl ? (
                  <div className="flex items-center space-x-3 bg-white p-2.5 rounded-lg border border-orange-100">
                    <img
                      src={exam.writing.task1.imageUrl}
                      alt="Task 1 Prompt Diagram"
                      className="w-24 h-16 object-contain rounded border border-slate-200 cursor-pointer hover:opacity-90 transition"
                      onClick={() => setZoomedDiagram(exam.writing.task1.imageUrl!)}
                    />
                    <div className="text-[11px] text-slate-600 space-y-0.5">
                      <p className="font-semibold text-slate-800 line-clamp-1">{exam.writing.task1.imageFileName || 'Task 1 Prompt Diagram'}</p>
                      <p className="line-clamp-2 text-slate-500">{exam.writing.task1.prompt}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-600 bg-white p-2.5 rounded-lg border border-orange-100 space-y-2">
                    <span className="font-semibold text-slate-800 block mb-0.5">{exam.writing.task1.chartDescription}</span>
                    <Task1Chart task1={exam.writing.task1} />
                    <p className="text-slate-500">{exam.writing.task1.chartDataSummary}</p>
                  </div>
                )}
              </div>
            )}

            {/* Task 1 Box */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-orange-600 uppercase text-[10px]">Writing Task 1 Response</span>
                <span className="text-[11px] text-slate-400">
                  {currentCandidate?.writingState.task1Response?.trim().split(/\s+/).filter(Boolean).length || 0} words
                </span>
              </div>
              <div
                onMouseUp={() => handleCaptureText(1)}
                className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap font-sans selection:bg-amber-100"
              >
                {currentCandidate?.writingState.task1Response || '(No response submitted)'}
              </div>
            </div>

            {/* Task 2 Box */}
            <div className="space-y-2 pt-2">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-orange-600 uppercase text-[10px]">Writing Task 2 Response</span>
                <span className="text-[11px] text-slate-400">
                  {currentCandidate?.writingState.task2Response?.trim().split(/\s+/).filter(Boolean).length || 0} words
                </span>
              </div>
              <div
                onMouseUp={() => handleCaptureText(2)}
                className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap font-sans selection:bg-amber-100"
              >
                {currentCandidate?.writingState.task2Response || '(No response submitted)'}
              </div>
            </div>

            {/* Anchor Sticky Note Form */}
            <form onSubmit={handleAddStickyNote} className="pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center space-x-2 text-xs text-amber-700 font-semibold">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Add Sticky Note Feedback:</span>
                {selectedTextSnippet ? (
                  <span className="text-[11px] text-slate-500 truncate max-w-[260px] italic">
                    &quot;{selectedTextSnippet}&quot; (Task {activeTaskForNote})
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400 italic">
                    (Tip: Highlight text above first or add general note)
                  </span>
                )}
              </div>

              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newStickyNote}
                  onChange={e => setNewStickyNote(e.target.value)}
                  placeholder="Type examiner comment/correction note..."
                  className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-xl text-xs transition cursor-pointer"
                >
                  Anchor Note
                </button>
              </div>
            </form>

            {/* Active Comments List */}
            {comments.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Active Sticky Notes ({comments.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {comments.map(c => (
                    <div
                      key={c.id}
                      className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex justify-between items-start gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="text-[10px] text-amber-800 font-mono font-semibold">
                          Task {c.task} • &quot;<span className="underline">{c.selectedText}</span>&quot;
                        </div>
                        <div className="italic text-[11px] text-slate-700">{c.note}</div>
                      </div>
                      <button
                        onClick={() => handleDeleteComment(c.id)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI Identified Grammar & Lexicon Errors Banner */}
          {(() => {
            const aiEval = currentCandidate?.grading.writingAiEvaluation;
            const errors = aiEval?.errors || [];
            const flags = (aiEval as any)?.flags || [];
            const items = errors.length > 0 ? errors.map((err, i) => ({
              id: `err-${i}`,
              task: err.task,
              category: err.errorType,
              originalSnippet: err.snippet,
              suggestedFix: err.suggestion,
              explanation: err.explanation
            })) : flags;

            if (!items || items.length === 0) return null;

            return (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center space-x-2 text-indigo-700 text-xs font-bold uppercase tracking-wider">
                    <Sparkles className="w-4 h-4" />
                    <span>Gemini AI Flagged Linguistic Observations ({items.length})</span>
                  </div>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {items.map((f: any, idx: number) => (
                    <div key={f.id || idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {(f.category || f.errorType || 'grammar').replace('_', ' ')}
                        </span>
                        <span className="text-slate-400 font-mono text-[10px]">Task {f.task}</span>
                      </div>
                      <div className="text-slate-800">
                        Original: <span className="line-through text-rose-600">{f.originalSnippet || f.snippet}</span> → Suggestion:{' '}
                        <strong className="text-emerald-700">{f.suggestedFix || f.suggestion}</strong>
                      </div>
                      {f.explanation && <div className="text-[11px] text-slate-500 italic">{f.explanation}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Right Column: Rubric Steppers & Human Override (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Official IELTS Rubric Override</h3>
              <div className="bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-xl text-center">
                <span className="text-[9px] uppercase font-bold text-emerald-700 block">Final Band</span>
                <span className="text-xl font-black text-emerald-700 font-mono">{roundedWritingBand.toFixed(1)}</span>
              </div>
            </div>

            {/* Task 1 Criteria */}
            <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider text-orange-700">
                  Task 1 (Report) • Sub-Band: {(calcT1).toFixed(1)}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                {/* TA */}
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium">Task Achievement:</span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => adjustScore(setT1TA, t1TA, -0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-slate-900">{t1TA.toFixed(1)}</span>
                    <button
                      onClick={() => adjustScore(setT1TA, t1TA, 0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* CC */}
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium">Coherence &amp; Cohesion:</span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => adjustScore(setT1CC, t1CC, -0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-slate-900">{t1CC.toFixed(1)}</span>
                    <button
                      onClick={() => adjustScore(setT1CC, t1CC, 0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* LR */}
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium">Lexical Resource:</span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => adjustScore(setT1LR, t1LR, -0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-slate-900">{t1LR.toFixed(1)}</span>
                    <button
                      onClick={() => adjustScore(setT1LR, t1LR, 0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* GRA */}
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium">Grammatical Accuracy:</span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => adjustScore(setT1GRA, t1GRA, -0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-slate-900">{t1GRA.toFixed(1)}</span>
                    <button
                      onClick={() => adjustScore(setT1GRA, t1GRA, 0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Task 2 Criteria */}
            <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider text-orange-700">
                  Task 2 (Essay) • Sub-Band: {(calcT2).toFixed(1)}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                {/* TR */}
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium">Task Response:</span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => adjustScore(setT2TR, t2TR, -0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-slate-900">{t2TR.toFixed(1)}</span>
                    <button
                      onClick={() => adjustScore(setT2TR, t2TR, 0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* CC */}
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium">Coherence &amp; Cohesion:</span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => adjustScore(setT2CC, t2CC, -0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-slate-900">{t2CC.toFixed(1)}</span>
                    <button
                      onClick={() => adjustScore(setT2CC, t2CC, 0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* LR */}
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium">Lexical Resource:</span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => adjustScore(setT2LR, t2LR, -0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-slate-900">{t2LR.toFixed(1)}</span>
                    <button
                      onClick={() => adjustScore(setT2LR, t2LR, 0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* GRA */}
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium">Grammatical Accuracy:</span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => adjustScore(setT2GRA, t2GRA, -0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-slate-900">{t2GRA.toFixed(1)}</span>
                    <button
                      onClick={() => adjustScore(setT2GRA, t2GRA, 0.5)}
                      className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Examiner Overall Feedback */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Official Examiner Commentary
              </label>
              <textarea
                value={examinerFeedback}
                onChange={e => setExaminerFeedback(e.target.value)}
                rows={3}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-sans leading-relaxed"
                placeholder="Enter feedback shown on candidate review..."
              />
            </div>

            {/* Save & Finalize Button */}
            <div className="pt-2">
              <button
                onClick={handleSaveFinalGrade}
                disabled={isSaving}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold rounded-xl text-xs transition shadow-xs flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSaving ? 'Finalizing Writing Band...' : 'Save & Finalize Writing Scores'}</span>
              </button>

              {saveSuccess && (
                <div className="mt-2 text-center text-xs text-emerald-700 font-medium">
                  ✓ Writing evaluation and sticky notes successfully finalized!
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Diagram Lightbox Modal */}
      {zoomedDiagram && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl p-2 shadow-2xl overflow-hidden flex flex-col items-center">
            <button
              onClick={() => setZoomedDiagram(null)}
              className="absolute top-4 right-4 p-2 bg-slate-900/70 hover:bg-slate-900 text-white rounded-full transition shadow-md cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={zoomedDiagram}
              alt="Zoomed Task 1 Diagram"
              className="max-h-[85vh] max-w-full object-contain rounded-xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
