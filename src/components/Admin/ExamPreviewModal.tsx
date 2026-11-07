import React, { useMemo, useState } from 'react';
import { X, Headphones, BookOpen, PenTool, Eye, KeyRound, ChevronDown, ChevronUp } from 'lucide-react';
import { Exam, CandidateSession, Question } from '../../types';
import { multiSlotResults } from '../../utils/ieltsScoring';
import { ListeningSection } from '../StudentPortal/ListeningSection';
import { ReadingSection } from '../StudentPortal/ReadingSection';
import { WritingSection } from '../StudentPortal/WritingSection';

interface ExamPreviewModalProps {
  exam: Exam;
  /** Shown in the preview bar, e.g. "Unsaved draft" when previewing wizard edits. */
  subtitle?: string;
  onClose: () => void;
}

type PreviewSection = 'listening' | 'reading' | 'writing';

const noop = () => {};

/** Synthetic candidate session — sections run fully client-side; nothing is
 *  saved, synced, or reported (no lockdown listeners are mounted). */
function buildPreviewSession(exam: Exam, section: PreviewSection): CandidateSession {
  const now = new Date().toISOString();
  return {
    candidateId: 'PREVIEW',
    candidateName: 'Preview Candidate',
    candidatePhotoUrl: '',
    dateOfBirth: '',
    gender: 'M',
    countryOfOrigin: 'Azerbaijan',
    firstLanguage: 'Azerbaijani',
    idDocumentNumber: '',
    centreNumber: exam.centreNumber || 'AZ001 - Baku Official IELTS Test Center',
    schemeCode: 'Academic Standard',
    examId: exam.id,
    examTitle: exam.title,
    createdAt: now,
    status: 'in_progress',
    currentSection: section,
    trfNumber: 'PREVIEW',
    lockStatus: { violations: 0, isLocked: false, lockHistory: [] },
    listeningState: {
      bufferedPercent: 0,
      audioPlayed: false,
      reviewTimerRemaining: 120,
      answers: {},
      highlights: [],
      completed: false,
      audioPositionSeconds: 0
    },
    readingState: {
      timeRemainingSeconds: (exam.reading?.durationMinutes || 60) * 60,
      answers: {},
      highlights: [],
      completed: false
    },
    writingState: {
      timeRemainingSeconds: (exam.writing?.durationMinutes || 60) * 60,
      task1Response: '',
      task2Response: '',
      completed: false
    },
    grading: { isFinalized: false },
    lastSavedAt: now
  };
}

/**
 * True candidate-environment preview: renders the REAL Listening / Reading /
 * Writing section components with a synthetic session, so the admin sees
 * pixel-for-pixel what candidates get before deploying. Interactions work
 * locally but nothing persists. Admin-only extras live in the top preview
 * bar (section jump + answer keys) and never leak into the candidate UI.
 */
export const ExamPreviewModal: React.FC<ExamPreviewModalProps> = ({ exam, subtitle, onClose }) => {
  const [section, setSection] = useState<PreviewSection>('listening');
  const [showKeys, setShowKeys] = useState(false);

  const session = useMemo(() => buildPreviewSession(exam, section), [exam, section]);

  const keys: Array<{ id: string; number: number; prompt: string; answers: string[] }> = useMemo(() => {
    const out: Array<{ id: string; number: number; prompt: string; answers: string[] }> = [];
    const clean = (q: Question) => (q.acceptedAnswers || []).filter(a => String(a ?? '').trim() !== '');
    // One row per question NUMBER (a 2-letter multi spans two rows), so the
    // count matches the student numbering on every exam.
    const pushList = (qs: Question[]) => qs.forEach(q => {
      if (q.type === 'multiple_choice_multi') {
        const slots = multiSlotResults(q, undefined);
        if (slots.length === 0) {
          out.push({ id: q.id, number: q.number, prompt: q.prompt, answers: clean(q) });
        } else {
          slots.forEach(s => out.push({ id: `${q.id}-${s.number}`, number: s.number, prompt: q.prompt, answers: [s.correctLetter] }));
        }
      } else {
        out.push({ id: q.id, number: q.number, prompt: q.prompt, answers: clean(q) });
      }
    });
    if (section === 'listening') {
      (exam.listening?.sections || []).forEach(sec => pushList(sec.questions || []));
    } else if (section === 'reading') {
      (exam.reading?.passages || []).forEach(p => pushList(p.questions || []));
    }
    return out;
  }, [exam, section]);

  const jump: Array<{ id: PreviewSection; label: string; Icon: typeof Headphones }> = [
    { id: 'listening', label: 'Listening', Icon: Headphones },
    { id: 'reading', label: 'Reading', Icon: BookOpen },
    { id: 'writing', label: 'Writing', Icon: PenTool }
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-100">
      {/* Admin-only preview bar */}
      <div className="sticky top-0 z-40 bg-slate-900 text-white px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 shadow-md">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer shrink-0"
          aria-label="Close preview"
          title="Back to admin"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/20 border border-violet-400/40 text-violet-200 text-[11px] font-bold uppercase tracking-wider shrink-0">
          <Eye className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Candidate preview</span>
          <span className="sm:hidden">Preview</span>
        </span>
        <span className="text-[11px] text-slate-400 truncate hidden md:inline">
          {subtitle || 'Read-only — interactions work locally, nothing is saved.'}
        </span>
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {jump.map(j => (
            <button
              key={j.id}
              type="button"
              onClick={() => setSection(j.id)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1 cursor-pointer ${
                section === j.id ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <j.Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{j.label}</span>
            </button>
          ))}
          {(section === 'listening' || section === 'reading') && (
            <button
              type="button"
              onClick={() => setShowKeys(v => !v)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1 cursor-pointer ${
                showKeys ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="Show answer keys for this module"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Keys</span>
            </button>
          )}
        </div>
      </div>

      {/* Answer-keys drawer (admin only) */}
      {showKeys && (section === 'listening' || section === 'reading') && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-3">
          <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider mb-2 flex items-center gap-1">
            <KeyRound className="w-3.5 h-3.5" /> Answer keys — {section} ({keys.length})
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
            {keys.map((k) => (
              <div key={k.id} className="text-[11px] bg-white border border-emerald-200/70 rounded-lg px-2 py-1">
                <span className="font-mono font-bold text-slate-400 mr-1">Q{k.number}</span>
                <span className="text-slate-700">{k.prompt || <em className="text-slate-400">empty stem</em>}</span>
                <span className="block font-medium text-emerald-700">→ {k.answers.join(' / ') || '—'}</span>
              </div>
            ))}
            {keys.length === 0 && <p className="text-[11px] text-slate-500">No questions in this module yet.</p>}
          </div>
        </div>
      )}

      {/* REAL candidate components */}
      {section === 'listening' && (
        <ListeningSection
          session={session}
          exam={exam}
          onSyncSession={noop}
          onCompleteSection={() => setSection('reading')}
          onLockTerminal={noop}
          isFrozen={false}
        />
      )}
      {section === 'reading' && (
        <ReadingSection
          session={session}
          exam={exam}
          onSyncSession={noop}
          onCompleteSection={() => setSection('writing')}
          onLockTerminal={noop}
          isFrozen={false}
        />
      )}
      {section === 'writing' && (
        <WritingSection
          session={session}
          exam={exam}
          onSyncSession={noop}
          onSubmitFinalExam={noop}
          onLockTerminal={noop}
          isFrozen={false}
        />
      )}

      {/* Collapse toggle affordance for the keys drawer */}
      {(section === 'listening' || section === 'reading') && showKeys && (
        <button
          onClick={() => setShowKeys(false)}
          className="fixed bottom-4 right-4 z-40 p-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg cursor-pointer"
          title="Hide answer keys"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}
      {(section === 'listening' || section === 'reading') && !showKeys && (
        <button
          onClick={() => setShowKeys(true)}
          className="fixed bottom-4 right-4 z-40 p-2.5 rounded-full bg-slate-900 hover:bg-slate-700 text-white shadow-lg cursor-pointer"
          title="Show answer keys"
        >
          <ChevronUp className="w-5 h-5" />
          <span className="sr-only">Show answer keys</span>
        </button>
      )}
    </div>
  );
};
