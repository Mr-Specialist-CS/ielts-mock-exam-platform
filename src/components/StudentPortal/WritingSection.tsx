import React, { useState, useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import { CandidateSession, Exam } from '../../types';
import { useThrottledSync } from '../../utils/useThrottledSync';
import { IdpTopBar, IdpHelpModal, mmss } from './idpShell';
import { Task1Chart } from '../Task1Chart';

interface WritingSectionProps {
  session: CandidateSession;
  exam: Exam;
  onSyncSession: (partial: Partial<CandidateSession>) => void;
  onSubmitFinalExam: (freshResponses?: { task1Response?: string; task2Response?: string }) => void;
  onLockTerminal?: () => void;
  isFrozen?: boolean;
}

const HELP_LINES = [
  'Task 1 and Task 2 are shown as tabs. Spend about 20 minutes on Task 1 and 40 minutes on Task 2.',
  'Write at least 150 words for Task 1 and at least 250 words for Task 2.',
  'Your text saves automatically. The word count is shown above each answer area.',
  'Use Hide text to conceal the task materials. The timer keeps running.',
  'Press Submit in the top bar when both tasks are complete. You cannot return after submitting.'
];

export const WritingSection: React.FC<WritingSectionProps> = ({
  session,
  exam,
  onSyncSession,
  onSubmitFinalExam,
  onLockTerminal,
  isFrozen = false
}) => {
  const [activeTask, setActiveTask] = useState<1 | 2>(1);
  const [task1Text, setTask1Text] = useState(session.writingState.task1Response || '');
  const [task2Text, setTask2Text] = useState(session.writingState.task2Response || '');
  const [timeRemaining, setTimeRemaining] = useState(session.writingState.timeRemainingSeconds || 3600);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  // One-click submit: immediate visual feedback + disabled while the submit
  // is in flight, so repeated clicks can't stack competing submits.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showImageZoom, setShowImageZoom] = useState(false);
  const [task1VisualTab, setTask1VisualTab] = useState<'image' | 'chart'>(
    exam.writing.task1.imageUrl ? 'image' : 'chart'
  );

  // IDP chrome state
  const [showHelp, setShowHelp] = useState(false);
  const [materialsHidden, setMaterialsHidden] = useState(false);

  // Refs for callbacks and session
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onSyncSessionRef = useRef(onSyncSession);
  onSyncSessionRef.current = onSyncSession;
  const onSubmitFinalExamRef = useRef(onSubmitFinalExam);
  onSubmitFinalExamRef.current = onSubmitFinalExam;
  const timeRemainingRef = useRef(timeRemaining);
  timeRemainingRef.current = timeRemaining;
  const task1Ref = useRef(task1Text);
  task1Ref.current = task1Text;
  const task2Ref = useRef(task2Text);
  task2Ref.current = task2Text;

  // Keystrokes are coalesced to at most one save per 10 s.
  const throttledSync = useThrottledSync(onSyncSession);

  // Global 60-minute countdown timer — frozen while hard-locked.
  useEffect(() => {
    if (isFrozen) return;
    const timer = setInterval(() => {
      setTimeRemaining(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [isFrozen]);

  // Snapshot exact position the moment the lock engages.
  useEffect(() => {
    if (!isFrozen) return;
    onSyncSessionRef.current({
      writingState: {
        ...sessionRef.current.writingState,
        timeRemainingSeconds: timeRemainingRef.current,
        task1Response: task1Ref.current,
        task2Response: task2Ref.current
      }
    });
  }, [isFrozen]);

  // Timer side effects (remaining-time persisted every 60 s — plenty for resume)
  useEffect(() => {
    if (isFrozen) return;
    if (timeRemaining === 0) {
      throttledSync.consumePending();
      onSubmitFinalExamRef.current({ task1Response: task1Ref.current, task2Response: task2Ref.current });
    } else if (timeRemaining % 60 === 0) {
      onSyncSessionRef.current({
        writingState: {
          ...sessionRef.current.writingState,
          timeRemainingSeconds: timeRemaining
        }
      });
    }
  }, [timeRemaining, isFrozen]);

  // Submit with ONE authoritative save: disarm the throttled queue first so no
  // stale snapshot can land after the submit, and hand the very latest text
  // to the submitter.
  const submitWithLatest = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      throttledSync.consumePending();
      await onSubmitFinalExam({ task1Response: task1Ref.current, task2Response: task2Ref.current });
    } finally {
      setIsSubmitting(false);
    }
  };

  const countWords = (text: string) => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  const t1Words = countWords(task1Text);
  const t2Words = countWords(task2Text);

  const handleTask1Change = (val: string) => {
    if (isFrozen) return;
    setTask1Text(val);
    throttledSync.queueSync({
      writingState: {
        ...sessionRef.current.writingState,
        task1Response: val
      }
    });
  };

  const handleTask2Change = (val: string) => {
    if (isFrozen) return;
    setTask2Text(val);
    throttledSync.queueSync({
      writingState: {
        ...sessionRef.current.writingState,
        task2Response: val
      }
    });
  };

  const renderMaterials = () => {
    if (materialsHidden) {
      return (
        <p className="text-[12px] text-slate-500 italic border border-dashed border-slate-400 rounded-sm p-6 text-center">
          Materials hidden. Use Hide text again to reveal them. The timer keeps running.
        </p>
      );
    }
    if (activeTask === 1) {
      return (
        <>
          <h2 className="text-[14px] font-bold text-slate-900 border-b border-slate-200 pb-2">{exam.writing.task1.title}</h2>
          <p className="text-[13px] text-slate-800 leading-relaxed whitespace-pre-line">{exam.writing.task1.prompt}</p>
          {exam.writing.task1.imageUrl && (
            <div className="flex gap-1 border-b border-slate-200 pb-2">
              <button
                type="button"
                onClick={() => setTask1VisualTab('image')}
                className={`px-3 h-7 text-[11px] font-bold border rounded-sm transition cursor-pointer ${
                  task1VisualTab === 'image' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'
                }`}
              >
                Diagram
              </button>
              <button
                type="button"
                onClick={() => setTask1VisualTab('chart')}
                className={`px-3 h-7 text-[11px] font-bold border rounded-sm transition cursor-pointer ${
                  task1VisualTab === 'chart' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'
                }`}
              >
                Data
              </button>
            </div>
          )}
          {exam.writing.task1.imageUrl && task1VisualTab === 'image' && (
            <div className="border border-slate-300 rounded-sm p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-800">{exam.writing.task1.chartDescription || 'Visual material'}</span>
                <button
                  type="button"
                  onClick={() => setShowImageZoom(true)}
                  className="text-[11px] font-semibold text-blue-800 hover:underline cursor-pointer"
                >
                  Enlarge
                </button>
              </div>
              <button type="button" onClick={() => setShowImageZoom(true)} className="block w-full cursor-zoom-in" title="Enlarge diagram">
                <img
                  src={exam.writing.task1.imageUrl}
                  alt={exam.writing.task1.title}
                  className="max-h-[320px] w-auto object-contain mx-auto"
                />
              </button>
              {exam.writing.task1.chartDataSummary && (
                <p className="text-[12px] text-slate-700 border-t border-slate-200 pt-2">
                  <strong>Summary:</strong> {exam.writing.task1.chartDataSummary}
                </p>
              )}
            </div>
          )}
          {(!exam.writing.task1.imageUrl || task1VisualTab === 'chart') && (
            <div className="border border-slate-300 rounded-sm p-2">
              <p className="text-[12px] font-bold text-slate-800">{exam.writing.task1.chartDescription}</p>
              <Task1Chart task1={exam.writing.task1} />
              {exam.writing.task1.chartDataSummary && (
                <p className="text-[12px] text-slate-700 border-t border-slate-200 pt-2 mt-2">
                  <strong>Summary:</strong> {exam.writing.task1.chartDataSummary}
                </p>
              )}
            </div>
          )}
        </>
      );
    }
    return (
      <>
        <h2 className="text-[14px] font-bold text-slate-900 border-b border-slate-200 pb-2">{exam.writing.task2.title}</h2>
        <p className="text-[13px] text-slate-800 leading-relaxed whitespace-pre-line">{exam.writing.task2.prompt}</p>
        <div className="border border-slate-300 rounded-sm p-3 text-[12px] text-slate-700 space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Guidance</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Address all parts of the question fully.</li>
            <li>Organise ideas into clear paragraphs.</li>
            <li>Support points with reasons and examples.</li>
            <li>Write at least 250 words.</li>
          </ul>
        </div>
      </>
    );
  };

  const editorValue = activeTask === 1 ? task1Text : task2Text;
  const editorWords = activeTask === 1 ? t1Words : t2Words;
  const editorMin = activeTask === 1 ? 150 : 250;

  return (
    <div className="bg-gray-100 min-h-[calc(100vh-4rem)] flex flex-col">
      <IdpTopBar
        left="Writing"
        sub={`Task 1 (150 words min) · Task 2 (250 words min) · ${session.candidateId}`}
        timerText={mmss(timeRemaining)}
        urgent={timeRemaining < 300}
        timerNote="Writing time remaining"
        onHelp={() => setShowHelp(true)}
        hideToggle={{ hidden: materialsHidden, onToggle: () => setMaterialsHidden(v => !v) }}
        extra={
          <>
            {onLockTerminal && (
              <button
                type="button"
                onClick={onLockTerminal}
                title="Lock screen"
                className="px-2 h-7 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 border border-slate-600 rounded-sm transition cursor-pointer"
              >
                Lock
              </button>
            )}
            <button
              type="button"
              onClick={() => { if (!isSubmitting) setShowConfirmModal(true); }}
              disabled={isSubmitting}
              title="Submit full exam"
              className="px-2 h-7 text-[11px] font-bold bg-blue-800 hover:bg-blue-700 border border-blue-900 text-white rounded-sm transition cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              {isSubmitting ? 'Submitting…' : 'Submit'}
            </button>
          </>
        }
      />
      {showHelp && <IdpHelpModal title="Writing — Help" lines={HELP_LINES} onClose={() => setShowHelp(false)} />}

      <div className="max-w-[1400px] w-full mx-auto px-3 py-3 flex-1 flex flex-col min-h-0">
        <div className="flex gap-1 border-b-2 border-slate-900 pb-0 mb-3" role="tablist" aria-label="Writing tasks">
          {([1, 2] as const).map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeTask === t}
              onClick={() => setActiveTask(t)}
              className={`px-4 h-8 text-[12px] font-bold whitespace-nowrap border border-b-0 rounded-t-sm transition cursor-pointer ${
                activeTask === t
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'
              }`}
            >
              Task {t} ({t === 1 ? t1Words : t2Words}/{t === 1 ? 150 : 250})
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-[60vh]">
          <div className="bg-white border border-slate-400 rounded-sm p-4 overflow-y-auto max-h-[68vh] space-y-3">
            {renderMaterials()}
          </div>
          <div className="bg-white border border-slate-400 rounded-sm p-4 flex flex-col min-h-[50vh]">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-2">
              <span className="text-[12px] font-bold text-slate-900">Your answer — Task {activeTask}</span>
              <span className={`text-[11px] font-mono font-bold ${editorWords >= editorMin ? 'text-slate-900' : 'text-slate-500'}`}>
                Words: {editorWords} / {editorMin} min
              </span>
            </div>
            <textarea
              aria-label={`Writing Task ${activeTask} answer`}
              value={editorValue}
              onChange={e => (activeTask === 1 ? handleTask1Change(e.target.value) : handleTask2Change(e.target.value))}
              placeholder={activeTask === 1 ? 'Write your Task 1 response here (at least 150 words)…' : 'Write your Task 2 essay here (at least 250 words)…'}
              className="flex-1 min-h-[46vh] w-full p-3 bg-white border border-slate-500 rounded-sm text-slate-900 text-[13px] leading-relaxed resize-none focus:outline-none focus:border-blue-800 font-serif"
            />
            <p className="text-[11px] text-slate-500 pt-2">
              {editorWords < editorMin
                ? `${editorMin - editorWords} words below minimum.`
                : 'Minimum reached. '}
              Saves automatically.
            </p>
          </div>
        </div>
      </div>

      {/* Zoom modal */}
      {showImageZoom && exam.writing.task1.imageUrl && (
        <div className="fixed inset-0 z-[100] bg-black/85 flex flex-col items-center justify-center p-4" onClick={() => setShowImageZoom(false)}>
          <div className="relative max-w-5xl max-h-[90vh] w-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <div className="w-full flex items-center justify-between pb-3 text-white">
              <span className="text-[13px] font-bold truncate pr-4">{exam.writing.task1.title}</span>
              <button
                type="button"
                onClick={() => setShowImageZoom(false)}
                className="px-2 h-7 text-[11px] font-bold bg-white/10 hover:bg-white/20 border border-white/30 rounded-sm transition cursor-pointer"
              >
                Close
              </button>
            </div>
            <img
              src={exam.writing.task1.imageUrl}
              alt="Task 1 diagram enlarged"
              className="max-h-[80vh] max-w-full object-contain rounded-sm bg-white p-2"
            />
          </div>
        </div>
      )}

      {/* Submit confirmation */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-white border-2 border-slate-900 rounded-sm p-5 space-y-3">
            <h3 className="text-[14px] font-bold text-slate-900">Submit exam?</h3>
            <p className="text-[12px] text-slate-700 leading-relaxed">
              Your answers will be frozen and submitted for scoring. Task 1: {t1Words} words. Task 2: {t2Words} words.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 h-8 text-[12px] font-semibold bg-white border border-slate-500 text-slate-800 rounded-sm hover:bg-slate-100 transition cursor-pointer"
              >
                Keep Writing
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setShowConfirmModal(false);
                  submitWithLatest();
                }}
                className="flex-1 h-8 text-[12px] font-bold bg-slate-900 text-white rounded-sm hover:bg-slate-700 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              >
                {isSubmitting ? 'Submitting…' : 'Submit Exam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
