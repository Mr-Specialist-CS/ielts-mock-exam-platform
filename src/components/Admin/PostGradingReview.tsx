import React, { useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Globe, Search, AlertCircle, Edit3, Check, Filter } from 'lucide-react';
import { CandidateSession, Exam } from '../../types';
import { scoreQuestionMarks } from '../../utils/ieltsScoring';

interface PostGradingReviewProps {
  exam?: Exam | null;
  candidates: CandidateSession[];
  onGlobalAnswerEdit: (questionId: string, newAcceptedAnswers: string[]) => Promise<{ affectedCount: number; message: string }>;
  onOverrideCandidateQuestion: (candidateId: string, module: 'listening' | 'reading', questionId: string, isCorrect: boolean) => Promise<void>;
  onRefreshData: () => Promise<void>;
}

export const PostGradingReview: React.FC<PostGradingReviewProps> = ({
  exam,
  candidates,
  onGlobalAnswerEdit,
  onOverrideCandidateQuestion,
  onRefreshData
}) => {
  const [activeModule, setActiveModule] = useState<'listening' | 'reading'>('listening');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>('l-q1');
  const [newKeyInput, setNewKeyInput] = useState('');
  const [isApplyingGlobal, setIsApplyingGlobal] = useState(false);
  const [globalSuccessMsg, setGlobalSuccessMsg] = useState<string | null>(null);
  const [globalErrorMsg, setGlobalErrorMsg] = useState<string | null>(null);
  const [isOverriding, setIsOverriding] = useState<string | null>(null);

  const listeningQuestions = exam?.listening?.sections?.flatMap(s => s.questions) || [];
  const readingQuestions = exam?.reading?.passages?.flatMap(p => p.questions) || [];
  const activeQuestions = activeModule === 'listening' ? listeningQuestions : readingQuestions;

  // Cohort of THIS exam only — other exams' candidates are graded against
  // their own keys and must not be shown or implied here.
  const cohort = candidates.filter(c => c.examId === exam?.id);

  const currentQ = activeQuestions.find(q => q.id === selectedQuestionId) || activeQuestions[0];

  const handleApplyGlobalAnswer = async () => {
    if (!currentQ) return;
    const items = newKeyInput.split(',').map(s => s.trim()).filter(Boolean);
    if (items.length === 0) return;

    setIsApplyingGlobal(true);
    setGlobalSuccessMsg(null);
    setGlobalErrorMsg(null);

    try {
      const res = await onGlobalAnswerEdit(currentQ.id, items);
      setGlobalSuccessMsg(`Global key updated! Recalculated ${res.affectedCount} candidate session(s). ${cohort.length} shown below.`);
      await onRefreshData();
    } catch (e: any) {
      setGlobalErrorMsg(e?.message || 'Global answer edit failed. No changes applied.');
    } finally {
      setIsApplyingGlobal(false);
    }
  };

  const handleSelectQuestion = (qId: string) => {
    setSelectedQuestionId(qId);
    const targetQ = activeQuestions.find(q => q.id === qId);
    if (targetQ) {
      setNewKeyInput(targetQ.acceptedAnswers.join(', '));
    }
  };

  // Sync initial input when module changes
  React.useEffect(() => {
    if (activeQuestions[0]) {
      handleSelectQuestion(activeQuestions[0].id);
    }
  }, [activeModule]);

  // Empty catalog: no sample content — prompt to create a real exam first.
  if (!exam) {
    return (
      <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center space-y-3">
        <Globe className="w-10 h-10 text-slate-300 mx-auto" />
        <h3 className="text-base font-bold text-slate-900">No exam to review</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">Create an exam form in the Exam Authoring Wizard first — answer keys and regrading will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Post-Grading Review &amp; Global Answer Key Editor</h2>
            <p className="text-xs text-slate-500">
              Update accepted answer keys globally to retroactively recalculate all candidate raw scores and band scores across the cohort.
            </p>
          </div>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => setActiveModule('listening')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeModule === 'listening'
                ? 'bg-orange-500 text-white shadow-xs font-bold'
                : 'bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Listening Questions ({listeningQuestions.length})
          </button>
          <button
            onClick={() => setActiveModule('reading')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeModule === 'reading'
                ? 'bg-orange-500 text-white shadow-xs font-bold'
                : 'bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Reading Questions ({readingQuestions.length})
          </button>
        </div>
      </div>

      {/* Two-Column Tool */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Question Selection & Global Edit Form (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                1. Select Question to Audit
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {activeModule.toUpperCase()}
              </span>
            </div>

            {/* Questions Picker Grid */}
            <div className="grid grid-cols-5 gap-2 max-h-48 overflow-y-auto pr-1">
              {activeQuestions.map(q => (
                <button
                  key={q.id}
                  onClick={() => handleSelectQuestion(q.id)}
                  className={`py-2 rounded-xl text-xs font-mono font-bold transition border cursor-pointer ${
                    selectedQuestionId === q.id
                      ? 'bg-orange-500 border-orange-500 text-white shadow-2xs font-bold'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Q{q.number}
                </button>
              ))}
            </div>

            {/* Current Question Inspector */}
            {currentQ && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Prompt:</span>
                  <div className="text-slate-800 font-medium mt-0.5">{currentQ.prompt}</div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Current Accepted Answer Keys:</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {currentQ.acceptedAnswers.map((ans, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-mono text-[11px]"
                      >
                        &quot;{ans}&quot;
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Global Answer Edit Form */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-orange-700 uppercase tracking-wider">
                <Edit3 className="w-4 h-4" />
                <span>Global Answer Key Revision</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                Enter comma-separated valid variations. Applying this will instantly regrade all candidate submissions for this question.
              </p>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                  Accepted Answer Keys (Comma-separated)
                </label>
                <textarea
                  rows={2}
                  value={newKeyInput}
                  onChange={e => setNewKeyInput(e.target.value)}
                  placeholder="e.g. wind turbine, wind turbines, wind-turbines"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>

              <button
                onClick={handleApplyGlobalAnswer}
                disabled={isApplyingGlobal}
                className="w-full py-2.5 px-4 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold rounded-xl text-xs transition shadow-sm shadow-orange-500/25 flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isApplyingGlobal ? 'animate-spin' : ''}`} />
                <span>{isApplyingGlobal ? 'Recalculating Cohort Scores...' : 'Apply & Retroactively Recalculate All'}</span>
              </button>

              {globalSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{globalSuccessMsg}</span>
                </div>
              )}
              {globalErrorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{globalErrorMsg}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Candidate Cohort Answers for Selected Question (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                2. Cohort Answers for Question {currentQ?.number}
              </h3>
              <span className="text-xs text-slate-500">
                {cohort.length} Candidate Submissions
              </span>
            </div>

            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {cohort.map(cand => {
                const candAnswer = activeModule === 'listening'
                  ? cand.listeningState.answers[currentQ?.id || '']
                  : cand.readingState.answers[currentQ?.id || ''];

                const overrides = activeModule === 'listening'
                  ? cand.grading.listeningScore?.overrides
                  : cand.grading.readingScore?.overrides;

                // Per-letter marks for multi (e.g. 1/2); record override = full/zero.
                const marks = currentQ
                  ? scoreQuestionMarks(currentQ, candAnswer, overrides?.[currentQ.id])
                  : { earned: 0, total: 1 };
                const isCorrect = marks.earned === marks.total;
                const isPartial = marks.earned > 0 && marks.earned < marks.total;

                return (
                  <div
                    key={cand.candidateId}
                    className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-900">{cand.candidateName}</span>
                        <span className="font-mono text-slate-400 text-[11px]">({cand.candidateId})</span>
                      </div>
                      <div className="text-slate-700">
                        Candidate Input: <strong className={isCorrect ? 'text-emerald-700' : 'text-rose-600'}>
                          &quot;{candAnswer || '(No Answer)'}&quot;
                        </strong>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0">
                      {isCorrect ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Correct{marks.total > 1 ? ` ${marks.earned}/${marks.total}` : ''}</span>
                        </span>
                      ) : isPartial ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Partial {marks.earned}/{marks.total}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[11px]">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Incorrect</span>
                        </span>
                      )}

                      {/* Manual Override Action */}
                      <button
                        onClick={async () => {
                          setIsOverriding(cand.candidateId);
                          await onOverrideCandidateQuestion(cand.candidateId, activeModule, currentQ.id, !isCorrect);
                          setIsOverriding(null);
                        }}
                        disabled={isOverriding === cand.candidateId}
                        className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 font-medium text-[11px] transition cursor-pointer"
                        title="Override this question specifically for this student"
                      >
                        {isCorrect ? 'Mark Incorrect' : 'Mark Correct'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
