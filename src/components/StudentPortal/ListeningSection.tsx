import React, { useState, useEffect, useRef } from 'react';
import { Play, Volume2, VolumeX, Wifi, Bell, Menu, Pencil, HelpCircle, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { CandidateSession, Exam, Question, TextHighlight, getQuestionFamily } from '../../types';
import { audioEngine } from '../../utils/audioPlayer';
import { useThrottledSync } from '../../utils/useThrottledSync';
import { IdpHelpModal, mmss } from './idpShell';
import {
  HighlightProvider, HlText, selectionToHls, hasSelectionIn, clearDomSelection,
  type PendingHl
} from './highlight';
import {
  IdpSingleList, IdpMultiList, IdpText, GapBox,
  IdpTableGroup, IdpFlowGroup, IdpMapGroup, IdpSummaryGroup, IdpFlowTextGroup, splitBlanks,
  groupRangeLabel
} from './idpInputs';
import { questionSlots, spanEndNumber, expandNavSlots } from '../../utils/ieltsScoring';
import { splitLayoutGroups } from '../../utils/tableLayout';

interface ListeningSectionProps {
  session: CandidateSession;
  exam: Exam;
  onSyncSession: (partial: Partial<CandidateSession>) => void;
  onCompleteSection: (freshAnswers?: Record<string, string>) => void;
  onLockTerminal?: () => void;
  isFrozen?: boolean;
}

const HELP_LINES = [
  'The recording is played ONCE only. Answer the questions as you listen.',
  'Type answers directly into the numbered boxes. The number is replaced by your answer.',
  'For matching tasks, drag a card into a numbered gap — or activate a card, then activate the gap.',
  'Complete tables directly inside the cells. Label maps by dragging a label onto its numbered point.',
  'Use the parts strip below to move between questions. Flagged questions show an amber dot.',
  'For gaps, respect the word limit shown. Extra words are cut automatically.',
  'Selecting any question text highlights it yellow automatically.',
  'Click a yellow mark to remove it. Clear marks removes all marks in this part.',
  'When the recording ends you receive review time. The section advances automatically, or press the tick button.'
];

export const ListeningSection: React.FC<ListeningSectionProps> = ({
  session,
  exam,
  onSyncSession,
  onCompleteSection,
  onLockTerminal,
  isFrozen = false
}) => {
  // Buffer Check State
  const [bufferProgress, setBufferProgress] = useState(session.listeningState.bufferedPercent || 0);
  const [isBufferReady, setIsBufferReady] = useState(session.listeningState.bufferedPercent >= 100);

  // No recording attached anywhere (no master URL, no per-section URL):
  // skip the audio gate entirely — never a default robot voice.
  const examHasAnyAudio = Boolean(exam.listening.audioUrl) ||
    exam.listening.sections.some(s => s.audioUrl && s.audioUrl.trim().length > 0);

  // Audio Playback State (restored from saved position so a lock/reset resumes mid-stream)
  const savedAudioPos = Math.max(0, Math.floor(session.listeningState.audioPositionSeconds || 0));
  const estimatedTotal = exam.listening.sections.reduce((acc, s) => acc + (s.audioDurationSeconds || 0), 0) || 1;
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioPercent, setAudioPercent] = useState(
    savedAudioPos > 0 ? Math.min(99, Math.round((savedAudioPos / estimatedTotal) * 100)) : 0
  );
  const [currentAudioSec, setCurrentAudioSec] = useState(savedAudioPos);
  const [hasAudioStarted, setHasAudioStarted] = useState(
    session.listeningState.audioPlayed || savedAudioPos > 0 || !examHasAnyAudio
  );
  const [hasAudioEnded, setHasAudioEnded] = useState(session.listeningState.audioPlayed || !examHasAnyAudio);
  // YouTube failure surfaced from the audio engine (no silent TTS fallback).
  const [audioError, setAudioError] = useState<null | 'youtube-error' | 'youtube-blocked' | 'youtube-api'>(null);

  // 120-Second Review Timer State
  const [reviewSecondsLeft, setReviewSecondsLeft] = useState(session.listeningState.reviewTimerRemaining || 120);
  const [activeSectionTab, setActiveSectionTab] = useState(0);

  // Answers State
  const [answers, setAnswers] = useState<Record<string, string>>(session.listeningState.answers || {});

  // Highlight State (yellow marks on question text, persisted like Reading)
  const [highlights, setHighlights] = useState<TextHighlight[]>(session.listeningState.highlights || []);
  const [hasSel, setHasSel] = useState(false);
  const pendingHlRef = useRef<PendingHl[]>([]);

  // Chrome state
  const [showHelp, setShowHelp] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showBell, setShowBell] = useState(false);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Refs to avoid stale closures or re-triggering effects during render updates
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onSyncSessionRef = useRef(onSyncSession);
  onSyncSessionRef.current = onSyncSession;
  const onCompleteSectionRef = useRef(onCompleteSection);
  onCompleteSectionRef.current = onCompleteSection;
  const hasAudioStartedRef = useRef(hasAudioStarted);
  hasAudioStartedRef.current = hasAudioStarted;
  const hasAudioEndedRef = useRef(hasAudioEnded);
  hasAudioEndedRef.current = hasAudioEnded;
  const reviewSecondsLeftRef = useRef(reviewSecondsLeft);
  reviewSecondsLeftRef.current = reviewSecondsLeft;
  const currentAudioSecRef = useRef(currentAudioSec);
  currentAudioSecRef.current = currentAudioSec;
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const isFrozenRef = useRef(isFrozen);
  isFrozenRef.current = isFrozen;

  // Keystroke answers are coalesced to at most one save per 10 s.
  const throttledSync = useThrottledSync(onSyncSession);

  const currentSection = exam.listening.sections[activeSectionTab] || exam.listening.sections[0];
  const currentSectionRef = useRef(currentSection);
  currentSectionRef.current = currentSection;
  /** Highlight unit scope root for the visible part (owner id for marks). */
  const hlP = currentSection.id;

  // Track a pen-ready selection (stale cache covers touch taps that collapse it).
  useEffect(() => {
    const onSel = () => {
      if (isFrozenRef.current) {
        setHasSel(false);
        return;
      }
      if (hasSelectionIn('[data-hl-unit]')) {
        setHasSel(true);
        const ps = selectionToHls().filter(p => p.unitKey.startsWith(`${currentSectionRef.current.id}|`));
        if (ps.length) pendingHlRef.current = ps;
      } else {
        setHasSel(false);
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  // Simulate audio buffering check on mount if not already buffered
  useEffect(() => {
    if (isBufferReady) return;

    const interval = setInterval(() => {
      setBufferProgress(prev => {
        const next = prev + 20;
        if (next >= 100) {
          clearInterval(interval);
          return 100;
        }
        return next;
      });
    }, 200);

    return () => clearInterval(interval);
  }, [isBufferReady]);

  // Sync buffer ready state cleanly outside of state updater
  useEffect(() => {
    if (bufferProgress >= 100 && !isBufferReady) {
      setIsBufferReady(true);
      onSyncSessionRef.current({
        listeningState: {
          ...sessionRef.current.listeningState,
          bufferedPercent: 100,
          highlights: [...highlightsRef.current]
        }
      });
    }
  }, [bufferProgress, isBufferReady]);

  // Freeze audio + snapshot progress the moment a hard lock engages.
  const wasPausedByLockRef = useRef(false);
  useEffect(() => {
    if (isFrozen) {
      if (audioEngine.playing) {
        audioEngine.pause();
        setIsPlaying(false);
        wasPausedByLockRef.current = true;
      }
      // Persist exact position so admin reset resumes from where it was.
      onSyncSessionRef.current({
        listeningState: {
          ...sessionRef.current.listeningState,
          answers: { ...answersRef.current },
          highlights: [...highlightsRef.current],
          reviewTimerRemaining: reviewSecondsLeftRef.current,
          audioPlayed: hasAudioEndedRef.current,
          audioPositionSeconds: currentAudioSecRef.current
        }
      });
    } else if (wasPausedByLockRef.current) {
      wasPausedByLockRef.current = false;
      // Only auto-resume if audio was mid-playback (not during review period).
      if (hasAudioEndedRef.current === false && hasAudioStartedRef.current === true) {
        audioEngine.resume();
        setIsPlaying(audioEngine.playing);
      }
    }
  }, [isFrozen]);

  // Handle Review Timer countdown once audio has ended (frozen while locked)
  useEffect(() => {
    if (!hasAudioEnded || isFrozen) return;

    const timer = setInterval(() => {
      setReviewSecondsLeft(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [hasAudioEnded, isFrozen]);

  // Handle Review Timer side-effects cleanly outside of render/updater
  useEffect(() => {
    if (!hasAudioEnded || isFrozen) return;

    if (reviewSecondsLeft === 0) {
      throttledSync.consumePending();
      onCompleteSectionRef.current({ ...answersRef.current });
    } else if (reviewSecondsLeft % 10 === 0 && reviewSecondsLeft < 120) {
      onSyncSessionRef.current({
        listeningState: {
          ...sessionRef.current.listeningState,
          reviewTimerRemaining: reviewSecondsLeft,
          highlights: [...highlightsRef.current]
        }
      });
    }
  }, [reviewSecondsLeft, hasAudioEnded, isFrozen]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      audioEngine.stop();
    };
  }, []);

  // Persist audio position during playback so a reload/lock resumes mid-stream.
  const lastPosSyncRef = useRef(0);
  // Real measured track length from the engine (file metadata / YouTube).
  // Display + progress prefer this over the admin estimate whenever known.
  const [measuredTotal, setMeasuredTotal] = useState<number | null>(null);
  const handleAudioProgress = (pct: number, sec: number, total?: number) => {
    setAudioPercent(pct);
    setCurrentAudioSec(sec);
    if (total && isFinite(total) && total > 0) {
      setMeasuredTotal(prev => (prev === Math.ceil(total) ? prev : Math.ceil(total)));
    }
    const now = Date.now();
    if (now - lastPosSyncRef.current > 30000 && !isFrozenRef.current) {
      lastPosSyncRef.current = now;
      onSyncSessionRef.current({
        listeningState: {
          ...sessionRef.current.listeningState,
          answers: { ...answersRef.current },
          highlights: [...highlightsRef.current],
          audioPlayed: false,
          audioPositionSeconds: sec
        }
      });
    }
  };

  // Start / resume Section Audio Playback (blocked while hard-locked)
  const handleStartExamAudio = () => {
    if (isFrozen) return;
    // Resume from the last saved position instead of restarting from scratch.
    const resumeFrom = hasAudioEndedRef.current
      ? 0
      : Math.max(
          currentAudioSecRef.current,
          Math.floor(sessionRef.current.listeningState.audioPositionSeconds || 0)
        );

    // Pick duration from sections
    const totalDuration = exam.listening.sections.reduce((acc, s) => acc + s.audioDurationSeconds, 0);
    const scriptCombined = exam.listening.sections.map(s => s.audioScriptSnippet || '').join(' ');
    // Find uploaded audio URL from master or sections (Task 7)
    const isSingleMode = exam.listening.audioUploadMode === 'single' || Boolean(exam.listening.audioUrl);
    const audioUrl = isSingleMode
      ? (exam.listening.audioUrl || exam.listening.sections[0]?.audioUrl)
      : (exam.listening.sections[activeSectionTab]?.audioUrl || exam.listening.sections.find(s => s.audioUrl)?.audioUrl);

    // No recording attached: skip straight to review, silently (no robot voice).
    if (!audioUrl || !audioUrl.trim()) {
      setAudioError(null);
      setHasAudioStarted(true);
      setIsPlaying(false);
      setHasAudioEnded(true);
      onSyncSessionRef.current({
        listeningState: {
          ...sessionRef.current.listeningState,
          answers: { ...answersRef.current },
          highlights: [...highlightsRef.current],
          audioPlayed: true,
          audioPositionSeconds: 0,
          completed: false
        }
      });
      return;
    }

    setAudioError(null);
    setHasAudioStarted(true);
    setIsPlaying(true);
    setCurrentAudioSec(resumeFrom);
    setMeasuredTotal(null);

    onSyncSessionRef.current({
      listeningState: {
        ...sessionRef.current.listeningState,
        answers: { ...answersRef.current },
        highlights: [...highlightsRef.current],
        audioPlayed: false,
        audioPositionSeconds: resumeFrom
      }
    });

    audioEngine.startAudio(
      totalDuration,
      scriptCombined,
      handleAudioProgress,
      () => {
        setIsPlaying(false);
        setHasAudioEnded(true);
        onSyncSessionRef.current({
          listeningState: {
            ...sessionRef.current.listeningState,
            answers: { ...answersRef.current },
            highlights: [...highlightsRef.current],
            audioPlayed: true,
            audioPositionSeconds: 0,
            completed: false
          }
        });
      },
      audioUrl,
      resumeFrom,
      reason => {
        // YouTube failed: show it plainly instead of a mystery robot voice.
        setAudioError(reason);
        setIsPlaying(false);
      }
    );
  };

  // Student gives up on a broken YouTube track: review time starts, no voice.
  const continueWithoutAudio = () => {
    audioEngine.stop();
    setAudioError(null);
    setIsPlaying(false);
    setHasAudioStarted(true);
    setHasAudioEnded(true);
    onSyncSessionRef.current({
      listeningState: {
        ...sessionRef.current.listeningState,
        answers: { ...answersRef.current },
        highlights: [...highlightsRef.current],
        audioPlayed: true,
        audioPositionSeconds: 0,
        completed: false
      }
    });
  };

  // Browser blocked YouTube autoplay: this tap IS the user gesture that unlocks sound.
  const handleYoutubeTapToPlay = () => {
    if (isFrozen) return;
    if (audioEngine.tapToPlayYoutube()) {
      setAudioError(null);
      setIsPlaying(true);
    }
  };

  const handleAnswerChange = (qId: string, value: string) => {
    if (isFrozen) return;
    const updated = { ...answers, [qId]: value };
    setAnswers(updated);

    // Auto-save sync to server (throttled — flushed on section exit)
    throttledSync.queueSync({
      listeningState: {
        ...sessionRef.current.listeningState,
        answers: updated,
        highlights: [...highlightsRef.current]
      }
    });
  };

  const persistHighlights = (updated: TextHighlight[]) => {
    setHighlights(updated);
    pendingHlRef.current = [];
    onSyncSessionRef.current({
      listeningState: {
        ...sessionRef.current.listeningState,
        answers: { ...answersRef.current },
        highlights: updated
      }
    });
  };

  const removeHighlight = (id: string) => {
    if (isFrozenRef.current) return;
    persistHighlights(highlightsRef.current.filter(h => h.id !== id));
  };

  const sectionHighlights = highlights.filter(h => h.passageId === currentSection.id);

  const clearSectionHighlights = () => {
    if (isFrozenRef.current) return;
    persistHighlights(highlightsRef.current.filter(h => h.passageId !== currentSection.id));
  };

  // Commit highlights for the visible part (one mark per touched unit,
  // duplicates skipped). Selections spanning inputs/questions just work.
  const commitPendingHls = (ps: PendingHl[]) => {
    if (!ps.length) return;
    const fresh = ps.filter(p => !highlightsRef.current.some(h =>
      h.unitKey === p.unitKey && h.startOffset === p.start && h.endOffset === p.end
    ));
    pendingHlRef.current = [];
    clearDomSelection();
    setHasSel(false);
    if (!fresh.length) return;
    const stamp = Date.now();
    const marks: TextHighlight[] = fresh.map((p, i) => ({
      id: `hl-${stamp.toString(36)}-${Math.floor(Math.random() * 1e6)}-${i}`,
      passageId: currentSectionRef.current.id,
      text: p.text,
      color: 'yellow',
      timestamp: new Date().toISOString(),
      unitKey: p.unitKey,
      startOffset: p.start,
      endOffset: p.end
    }));
    persistHighlights([...highlightsRef.current, ...marks]);
  };
  const commitHlsRef = useRef(commitPendingHls);
  commitHlsRef.current = commitPendingHls;

  // Selecting text highlights it automatically once the selection is
  // finalized (mouse released, touch lifted, keys released).
  useEffect(() => {
    const autoHl = () => {
      if (isFrozenRef.current) return;
      const ps = selectionToHls().filter(p => p.unitKey.startsWith(`${currentSectionRef.current.id}|`));
      if (!ps.length) return;
      commitHlsRef.current(ps);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) autoHl();
    };
    window.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', autoHl);
    document.addEventListener('keyup', autoHl);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchend', autoHl);
      document.removeEventListener('keyup', autoHl);
    };
  }, []);

  // Pen button: highlight the live selection (or the last cached one on touch).
  // Mostly a fallback now — mouse/touch/keyboard selections highlight automatically.
  const handlePenHighlight = () => {
    if (isFrozenRef.current) return;
    const secId = currentSectionRef.current.id;
    const live = selectionToHls().filter(p => p.unitKey.startsWith(`${secId}|`));
    const cached = pendingHlRef.current.filter(p => p.unitKey.startsWith(`${secId}|`));
    commitPendingHls(live.length ? live : cached);
  };

  // One-click finish: immediate visual feedback + disabled while the switch
  // is in flight, so repeated clicks can't stack competing transitions.
  // Finish with ONE authoritative save: disarm the throttled queue first so no
  // stale snapshot can land after the finish and revert the section change,
  // and hand the very latest answers to the completer.
  const [isFinishing, setIsFinishing] = useState(false);
  const finishSection = async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    try {
      throttledSync.consumePending();
      await onCompleteSection({ ...answersRef.current });
    } finally {
      setIsFinishing(false);
    }
  };

  // Estimate from the exam (correct at authoring time for real tracks);
  // the measured length takes over the moment playback reports it.
  const totalDuration = measuredTotal ||
    exam.listening.sections.reduce((acc, s) => acc + (s.audioDurationSeconds || 0), 0);

  // Switching parts: the recording is ONE continuous track across all 4 parts,
  // so in single/master-audio mode playback must NOT stop when moving between
  // parts. Only separate-per-part audio stops (a different file per part —
  // the candidate presses play again for the new part).
  const handlePartSwitch = (idx: number) => {
    if (idx === activeSectionTab) return;
    const isSingleMode = exam.listening.audioUploadMode === 'single' || Boolean(exam.listening.audioUrl);
    if (!isSingleMode && audioEngine.playing) {
      audioEngine.stop();
      setIsPlaying(false);
      setCurrentAudioSec(0);
      setMeasuredTotal(null);
      onSyncSessionRef.current({
        listeningState: {
          ...sessionRef.current.listeningState,
          answers: { ...answersRef.current },
          highlights: [...highlightsRef.current],
          audioPlayed: false,
          audioPositionSeconds: 0
        }
      });
    }
    setActiveSectionTab(idx);
  };

  // Flattened module navigation (Parts 1–4)
  const allQs = exam.listening.sections.flatMap((sec, si) => sec.questions.map(q => ({ ...q, si })));
  const isAnswered = (id: string) => (answers[id] || '').trim() !== '';
  const focusedQid = (() => {
    if (focusedId && currentSection.questions.some(q => q.id === focusedId)) return focusedId;
    return currentSection.questions[0]?.id || null;
  })();
  const focusIndex = allQs.findIndex(q => q.id === focusedQid);
  const jumpTo = (id: string) => {
    const target = allQs.find(q => q.id === id);
    if (!target) return;
    handlePartSwitch(target.si);
    setFocusedId(id);
    setShowDrawer(false);
  };
  const goBack = () => {
    if (focusIndex > 0) jumpTo(allQs[focusIndex - 1].id);
  };
  const goNext = () => {
    if (focusIndex >= 0 && focusIndex < allQs.length - 1) jumpTo(allQs[focusIndex + 1].id);
  };
  const toggleFlag = () => {
    if (!focusedQid) return;
    setFlagged(prev => {
      const next = new Set(prev);
      if (next.has(focusedQid)) next.delete(focusedQid);
      else next.add(focusedQid);
      return next;
    });
  };
  const flaggedList = allQs.filter(q => flagged.has(q.id));

  // One dot per question number (a 2-letter multi starting at 11 yields
  // dots 11 and 12 pointing at the same shared widget).
  const renderNavDot = (qid: string, n: number) => {
    const cur = qid === focusedQid;
    const fl = flagged.has(qid);
    const ans = isAnswered(qid);
    return (
      <button
        key={`${qid}#${n}`}
        type="button"
        onClick={() => jumpTo(qid)}
        title={`Question ${n}${ans ? ' (answered)' : ''}${fl ? ' (flagged)' : ''}`}
        className={`relative w-6 h-6 text-[11px] font-mono border transition cursor-pointer rounded-[2px] ${
          cur
            ? 'border-blue-700 ring-1 ring-blue-700 bg-white text-slate-900 font-bold'
            : ans
            ? 'bg-slate-900 border-slate-900 text-white'
            : 'bg-white border-slate-400 text-slate-700 hover:border-slate-800'
        }`}
      >
        {n}
        {fl && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 border border-amber-600" />
        )}
      </button>
    );
  };

  const audioStatus = !examHasAnyAudio
    ? 'No audio attached'
    : !hasAudioStarted
    ? 'Audio ready'
    : hasAudioEnded
    ? `Review time ${mmss(reviewSecondsLeft)}`
    : isPlaying
    ? `Audio is Playing · ${mmss(currentAudioSec)} / ${mmss(totalDuration)}`
    : `Audio Paused · ${mmss(currentAudioSec)} / ${mmss(totalDuration)}`;

  const renderWidget = (q: Question) => {
    const currentAns = answers[q.id] || '';
    const blanks = splitBlanks(q.prompt);

    if (q.type === 'true_false_not_given' || q.type === 'yes_no_not_given') {
      const choices = q.type === 'true_false_not_given' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
      return (
        <div className="mt-1 space-y-1">
          <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${hlP}|${q.id}|prompt`} /></p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {choices.map((c, ci) => (
              <label key={c} className="inline-flex items-center gap-1.5 text-[13px] text-slate-900 cursor-pointer">
                <input
                  type="radio"
                  name={`q-${q.id}`}
                  checked={currentAns.toUpperCase() === c}
                  onChange={() => handleAnswerChange(q.id, c)}
                  className="w-3.5 h-3.5 accent-slate-900 cursor-pointer"
                />
                <span><HlText text={c.charAt(0) + c.slice(1).toLowerCase()} unitKey={`${hlP}|${q.id}|radio${ci}`} interactive={false} /></span>
              </label>
            ))}
          </div>
        </div>
      );
    }
    if (q.type === 'multiple_choice') {
      return (
        <div className="mt-1 space-y-1">
          <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${hlP}|${q.id}|prompt`} /></p>
          <IdpSingleList qid={q.id} value={currentAns} options={q.options || []} onPick={k => handleAnswerChange(q.id, k)} hlPrefix={hlP} />
        </div>
      );
    }
    if (q.type === 'multiple_choice_multi') {
      const slots = questionSlots(q);
      return (
        <div className="mt-1 space-y-1">
          {slots > 1 && (
            <p className="text-[13px] font-bold text-slate-900">
              Questions {q.number}–{q.number + slots - 1}
            </p>
          )}
          {q.instructionLine?.trim() && (
            <p className="text-[13px] text-slate-900"><HlText text={q.instructionLine} unitKey={`${hlP}|${q.id}|instr`} /></p>
          )}
          <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${hlP}|${q.id}|prompt`} /></p>
          <IdpMultiList qid={q.id} value={currentAns} options={q.options || []} max={q.maxSelections} onPick={csv => handleAnswerChange(q.id, csv)} hlPrefix={hlP} />
        </div>
      );
    }
    if (q.type === 'matching_information' || q.type === 'matching_sentence_endings') {
      // Standalone dropdown rows (grouped bank layout below covers drag families)
      return (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-slate-900"><HlText text={q.prompt} unitKey={`${hlP}|${q.id}|prompt`} /></span>
          <select
            aria-label={`Answer for question ${q.number}`}
            value={(q.options || []).includes(currentAns) ? currentAns : ''}
            onChange={e => handleAnswerChange(q.id, e.target.value)}
            className="px-2 py-1 text-[13px] bg-white border border-slate-500 text-slate-900 rounded-[3px] focus:outline-none focus:border-blue-700 cursor-pointer max-w-full"
          >
            <option value="">{q.number}</option>
            {(q.options || []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }
    // Text + diagram families: single gap renders inline, otherwise prompt + gap below
    if (blanks.length === 2) {
      const parts = blanks;
      return (
        <p className="text-[13px] text-slate-900 leading-loose">
          <HlText text={parts[0]} unitKey={`${hlP}|${q.id}|gapA`} />
          <GapBox number={q.number} value={currentAns} onEdit={v => handleAnswerChange(q.id, v)} wordLimit={q.wordLimit} />
          <HlText text={parts[1]} unitKey={`${hlP}|${q.id}|gapB`} />
        </p>
      );
    }
    return (
      <div className="mt-1 space-y-1">
        <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${hlP}|${q.id}|prompt`} /></p>
        <GapBox number={q.number} value={currentAns} onEdit={v => handleAnswerChange(q.id, v)} wordLimit={q.wordLimit} />
      </div>
    );
  };

  // Consecutive group-family questions form one visual unit:
  // table (shared layout), flow/map (shared bank), matching rows (shared bank).
  // Everything else becomes single blocks; consecutive singles sharing one
  // instruction line are rendered under a single "Questions A–B" header,
  // exactly like the paper (instruction written once).
  type LBlock =
    | { kind: 'table'; qs: Question[] }
    | { kind: 'flow'; qs: Question[] }
    | { kind: 'flowtext'; qs: Question[] }
    | { kind: 'map'; qs: Question[]; imageUrl: string }
    | { kind: 'matchrows'; qs: Question[] }
    | { kind: 'summary'; qs: Question[] }
    | { kind: 'single'; q: Question };

  const sameOptions = (a?: string[], b?: string[]) =>
    !!a && a.length > 0 && JSON.stringify(a) === JSON.stringify(b);

  const buildBlocks = (): LBlock[] => {
    const blocks: LBlock[] = [];
    let i = 0;
    const qs = currentSection.questions;
    while (i < qs.length) {
      const q = qs[i];
      if (q.type === 'table_completion') {
        const group: Question[] = [q];
        let j = i + 1;
        while (j < qs.length && qs[j].type === 'table_completion') {
          group.push(qs[j]);
          j++;
        }
        // A fresh tableDef on a later question starts a NEW table (two
        // tables back-to-back render separately). Sub-groups without any
        // layout fall through to single typed cards below.
        const subs = splitLayoutGroups(group);
        if (!subs.every(sub => !sub[0].tableDef?.rows?.length)) {
          for (const sub of subs) {
            if (sub[0].tableDef?.rows?.length) blocks.push({ kind: 'table', qs: sub });
            else sub.forEach(sq => blocks.push({ kind: 'single', q: sq }));
          }
          i = j;
          continue;
        }
        // No layout authored: fall through to single typed cards below
      }
      if (q.type === 'flowchart_completion' && q.options && q.options.length > 0) {
        const group: Question[] = [q];
        let j = i + 1;
        while (j < qs.length && qs[j].type === 'flowchart_completion' && sameOptions(q.options, qs[j].options)) {
          group.push(qs[j]);
          j++;
        }
        blocks.push({ kind: 'flow', qs: group });
        i = j;
        continue;
      }
      if (q.type === 'flowchart_completion_text') {
        // Type-in flow: consecutive questions form ONE vertical chart
        // (layout from the first question's flowDef, else each prompt is
        // its own box) — no word bank involved. A fresh flowDef starts a
        // NEW chart.
        const group: Question[] = [q];
        let j = i + 1;
        while (j < qs.length && qs[j].type === 'flowchart_completion_text') {
          group.push(qs[j]);
          j++;
        }
        for (const sub of splitLayoutGroups(group)) blocks.push({ kind: 'flowtext', qs: sub });
        i = j;
        continue;
      }
      if (q.type === 'image_map' && q.options && q.options.length > 0) {
        const group: Question[] = [q];
        let j = i + 1;
        while (j < qs.length && qs[j].type === 'image_map' && sameOptions(q.options, qs[j].options)) {
          group.push(qs[j]);
          j++;
        }
        const img = group.find(g => g.imageUrl)?.imageUrl;
        if (img) {
          blocks.push({ kind: 'map', qs: group, imageUrl: img });
          i = j;
          continue;
        }
        // No image uploaded: fall through to row layout below
      }
      if (q.type === 'summary_completion') {
        // Consecutive summary gaps form ONE boxed summary (paper layout).
        const group: Question[] = [q];
        let j = i + 1;
        while (j < qs.length && qs[j].type === 'summary_completion') {
          group.push(qs[j]);
          j++;
        }
        blocks.push({ kind: 'summary', qs: group });
        i = j;
        continue;
      }
      if (
        (q.type === 'matching_headings' ||
          q.type === 'matching_features' ||
          q.type === 'diagram_label' ||
          q.type === 'map_label' ||
          q.type === 'image_map') &&
        q.options &&
        q.options.length > 0
      ) {
        const group: Question[] = [q];
        const key = JSON.stringify(q.options);
        let j = i + 1;
        while (
          j < qs.length &&
          (qs[j].type === 'matching_headings' ||
            qs[j].type === 'matching_features' ||
            qs[j].type === 'diagram_label' ||
            qs[j].type === 'map_label' ||
            qs[j].type === 'image_map') &&
          JSON.stringify(qs[j].options) === key
        ) {
          group.push(qs[j]);
          j++;
        }
        blocks.push({ kind: 'matchrows', qs: group });
        i = j;
        continue;
      }
      blocks.push({ kind: 'single', q });
      i++;
    }
    return blocks;
  };

  const renderSingleCard = (q: Question, hideInstruction: boolean) => (
    <div key={q.id} onClick={() => setFocusedId(q.id)}>
      {!hideInstruction && q.instructionLine && (
        <p className="text-[12px] font-bold text-slate-900 mb-1"><HlText text={q.instructionLine} unitKey={`${hlP}|${q.id}|instr`} /></p>
      )}
      {renderWidget(q)}
      {flagged.has(q.id) && (
        <p className="text-[10px] font-bold uppercase text-amber-700 tracking-wide mt-1">Flagged for review</p>
      )}
    </div>
  );

  const renderQuestions = () => {
    const blocks = buildBlocks();
    const groupProps = {
      answers,
      flagged,
      onFocus: (id: string) => setFocusedId(id)
    };
    const out: React.ReactNode[] = [];
    let k = 0;
    while (k < blocks.length) {
      const b = blocks[k];
      if (b.kind === 'table') {
        out.push(
          <IdpTableGroup key={`t-${b.qs[0].id}`} qs={b.qs} {...groupProps} onEdit={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={hlP} />
        );
        k++;
        continue;
      }
      if (b.kind === 'flow') {
        out.push(
          <IdpFlowGroup key={`f-${b.qs[0].id}`} qs={b.qs} {...groupProps} onPick={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={hlP} />
        );
        k++;
        continue;
      }
      if (b.kind === 'flowtext') {
        out.push(
          <IdpFlowTextGroup key={`ft-${b.qs[0].id}`} qs={b.qs} {...groupProps} onEdit={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={hlP} />
        );
        k++;
        continue;
      }
      if (b.kind === 'map') {
        out.push(
          <IdpMapGroup key={`m-${b.qs[0].id}`} qs={b.qs} imageUrl={b.imageUrl} {...groupProps} onPick={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={hlP} />
        );
        k++;
        continue;
      }
      if (b.kind === 'matchrows') {
        out.push(<MatchingGroup key={`g-${b.qs[0].id}`} qs={b.qs} />);
        k++;
        continue;
      }
      if (b.kind === 'summary') {
        out.push(
          <IdpSummaryGroup key={`s-${b.qs[0].id}`} qs={b.qs} {...groupProps} onAnswer={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={hlP} />
        );
        k++;
        continue;
      }
      // Single: merge consecutive singles sharing one instruction line.
      // Multi-answer widgets always stand alone with their own header and
      // instruction (they already show "Questions N–M" + instruction).
      // Without any instruction, same-type singles still run under one
      // "Questions A–B" header (paper ranges like 11–14 always show).
      if (b.q.type !== 'multiple_choice_multi') {
        const runInstr = b.q.instructionLine?.trim() || '';
        const runType = b.q.type;
        const sameRun = (x: LBlock) =>
          x.kind === 'single' &&
          (x as { kind: 'single'; q: Question }).q.type !== 'multiple_choice_multi' &&
          (((x as { kind: 'single'; q: Question }).q.instructionLine?.trim() || '') === runInstr) &&
          (runInstr !== '' || (x as { kind: 'single'; q: Question }).q.type === runType);
        let j = k + 1;
        while (j < blocks.length && sameRun(blocks[j])) {
          j++;
        }
        if (j > k + 1) {
          const runQs = blocks.slice(k, j).map(x => (x as { kind: 'single'; q: Question }).q);
          const runEnd = spanEndNumber(runQs[runQs.length - 1]);
          out.push(
            <div key={`run-${runQs[0].id}`}>
              <p className="text-[13px] font-bold text-slate-900">
                Questions {runQs[0].number}–{runEnd}
              </p>
              {runInstr && (
                <p className="text-[13px] text-slate-900 mt-0.5 mb-2"><HlText text={runInstr} unitKey={`${hlP}|run|${runQs[0].id}|instr`} /></p>
              )}
              <div className="space-y-3">
                {runQs.map(q => renderSingleCard(q, true))}
              </div>
            </div>
          );
          k = j;
          continue;
        }
      }
      out.push(
        b.q.type === 'multiple_choice_multi'
          ? renderSingleCard(b.q, true)
          : renderSingleCard(b.q, false)
      );
      k++;
    }
    return <div className="space-y-4">{out}</div>;
  };

  const MatchingGroup: React.FC<{ qs: Question[] }> = ({ qs }) => {
    const [selected, setSelected] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const options = qs[0].options || [];
    const assignedValues = qs.map(q => answers[q.id] || '').filter(Boolean);
    const bank = options.filter(o => !assignedValues.includes(o));
    const first = qs[0].number;
    const last = qs[qs.length - 1].number;
    const instruction =
      qs.find(q => q.instructionLine)?.instructionLine ||
      (qs[0].type === 'diagram_label' || qs[0].type === 'map_label'
        ? 'Label the map. Choose the correct answer and move it into the gap.'
        : 'Choose the correct answer and move it into the gap.');

    const place = (qid: string, opt: string) => {
      handleAnswerChange(qid, opt);
      setSelected(null);
    };

    return (
      <div>
        <p className="text-[13px] font-bold text-slate-900">
          {groupRangeLabel(first, last)}
        </p>
        <p className="text-[13px] text-slate-900 mt-0.5"><HlText text={instruction} unitKey={`${hlP}|match|${qs[0].id}|instr`} /></p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 mt-2">
          <div className="space-y-2">
            {qs.map(q => {
              const v = answers[q.id] || '';
              return (
                <div key={q.id} className="flex items-center gap-2" onClick={() => setFocusedId(q.id)}>
                  <span className="text-[13px] text-slate-900 flex-1 min-w-0"><HlText text={q.prompt} unitKey={`${hlP}|${q.id}|stem`} /></span>
                  <button
                    type="button"
                    aria-label={v ? `Gap ${q.number} filled with ${v}` : `Gap ${q.number} empty`}
                    onClick={() => {
                      if (selected) place(q.id, selected);
                    }}
                    onDragOver={e => {
                      e.preventDefault();
                      setDragOverId(q.id);
                    }}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={e => {
                      e.preventDefault();
                      setDragOverId(null);
                      const k = e.dataTransfer.getData('text/plain');
                      if (k && options.includes(k)) place(q.id, k);
                    }}
                    className={`min-w-[3.5rem] px-3 py-1 text-[13px] font-bold text-center rounded-[3px] transition cursor-pointer border border-dashed ${
                      dragOverId === q.id
                        ? 'border-blue-700 bg-blue-50 text-blue-900'
                        : v
                        ? 'border-slate-500 bg-white text-slate-900'
                        : 'border-slate-500 bg-white text-slate-900'
                    }`}
                  >
                    {v || q.number}
                  </button>
                  {v && (
                    <button
                      type="button"
                      aria-label={`Clear gap ${q.number}`}
                      onClick={() => handleAnswerChange(q.id, '')}
                      className="text-slate-400 hover:text-slate-900 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  )}
                  {flagged.has(q.id) && (
                    <span className="text-[10px] font-bold uppercase text-amber-700">Flagged</span>
                  )}
                </div>
              );
            })}
          </div>
          <div
            className="flex flex-wrap content-start gap-1.5"
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const k = e.dataTransfer.getData('text/plain');
              const owner = qs.find(q => (answers[q.id] || '') === k);
              if (owner) handleAnswerChange(owner.id, '');
            }}
          >
            {bank.map((opt, bi) => (
              <button
                key={opt}
                type="button"
                draggable
                onDragStart={e => e.dataTransfer.setData('text/plain', opt)}
                onClick={() => setSelected(selected === opt ? null : opt)}
                title="Activate, then activate a gap — or drag into a gap"
                className={`px-2.5 py-1 border text-[12px] rounded-[3px] transition cursor-grab active:cursor-grabbing ${
                  selected === opt ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-800 border-slate-400 hover:border-slate-800'
                }`}
              >
                <HlText text={opt} unitKey={`${hlP}|match|bank${bi}`} interactive={false} />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const secFirst = currentSection.questions[0]?.number;
  const secLastQ = currentSection.questions[currentSection.questions.length - 1];
  const secLast = secLastQ ? spanEndNumber(secLastQ) : undefined;

  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] flex flex-col">
      {/* Inspera-style top bar */}
      <div className="sticky top-0 z-40 bg-white border-b border-slate-300">
        <div className="max-w-[1400px] mx-auto px-3 h-12 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[22px] font-black italic text-red-600 tracking-tight leading-none">
              IELTS<sup className="text-[9px] not-italic font-bold">™</sup>
            </span>
            <span className="w-px h-6 bg-slate-300 hidden sm:block" />
            <div className="leading-tight hidden sm:block">
              <div className="text-[12px] font-bold text-slate-900">Test taker ID</div>
              <div className="text-[11px] text-slate-600 flex items-center gap-1">
                {isPlaying ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                {audioStatus}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-slate-800">
            {onLockTerminal && (
              <button
                type="button"
                onClick={onLockTerminal}
                title="Lock screen"
                className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Lock
              </button>
            )}
            <span title="Connection" className="hidden sm:block">
              {/* wifi icon (status only) */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <circle cx="12" cy="20" r="1" fill="currentColor" />
              </svg>
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowBell(v => !v);
                  setShowDrawer(false);
                }}
                title="Flagged questions"
                aria-label="Flagged questions"
                className="hover:text-black cursor-pointer"
              >
                <Bell className="w-[18px] h-[18px]" />
                {flaggedList.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 border border-amber-600 text-[8px] font-bold text-black flex items-center justify-center">
                    {flaggedList.length}
                  </span>
                )}
              </button>
              {showBell && (
                <>
                  <div className="fixed inset-0 z-[105]" onClick={() => setShowBell(false)} />
                  <div className="absolute right-0 top-7 z-[106] w-56 bg-white border border-slate-400 rounded-[3px] shadow-xl py-1 text-[12px]">
                    <p className="px-3 py-1.5 font-bold text-slate-900 border-b border-slate-200">Flagged for review</p>
                    {flaggedList.length === 0 && (
                      <p className="px-3 py-2 text-slate-500">No flagged questions.</p>
                    )}
                    {flaggedList.map(q => (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => {
                          jumpTo(q.id);
                          setShowBell(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-800 cursor-pointer"
                      >
                        Question {q.number} <span className="text-slate-400">(Part {q.si + 1})</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowDrawer(true);
                setShowBell(false);
              }}
              title="Sections menu"
              aria-label="Sections menu"
              className="hover:text-black cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={handlePenHighlight}
              disabled={isFrozen || !hasSel}
              title={isFrozen ? 'Highlighting locked' : hasSel ? 'Highlight selection' : 'Select text first, then press the pen'}
              aria-label="Highlight selection"
              className="hover:text-black cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Pencil className="w-[18px] h-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              title="Help"
              aria-label="Help"
              className="hover:text-black cursor-pointer"
            >
              <HelpCircle className="w-[18px] h-[18px]" />
            </button>
            {hasAudioEnded && (
              <span
                title="Review time remaining — Listening closes automatically and Reading begins at 0:00"
                className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-sm bg-red-700 text-white text-[12px] font-mono font-bold tabular-nums animate-pulse"
              >
                <span className="font-sans font-bold text-[10px] uppercase tracking-wide">Review</span>
                {mmss(reviewSecondsLeft)}
              </span>
            )}
          </div>
        </div>
      </div>
      {showHelp && <IdpHelpModal title="Help — Listening" lines={HELP_LINES} onClose={() => setShowHelp(false)} />}

      <div className="max-w-[1400px] w-full mx-auto px-3 py-3 space-y-4 flex-1">
        {/* Part banner */}
        <div className="bg-[#f5f3ec] border border-slate-200 rounded-[3px] px-3 py-2.5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-bold text-slate-900">Part {currentSection.sectionNumber}</p>
            {secFirst !== undefined && secLast !== undefined && (
              <p className="text-[13px] text-slate-800">
                Listen and answer questions {secFirst}–{secLast}.
              </p>
            )}
          </div>
          {sectionHighlights.length > 0 && (
            <button
              type="button"
              onClick={clearSectionHighlights}
              disabled={isFrozen}
              title="Clear highlights in this part"
              className="shrink-0 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 rounded-[3px] bg-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear marks ({sectionHighlights.length})
            </button>
          )}
        </div>

        {/* Buffer gate */}
        {!hasAudioStarted && (
          <div className="bg-white border border-slate-300 rounded-[3px] p-5 text-center max-w-xl mx-auto">
            <h2 className="text-[15px] font-bold text-slate-900">Check your audio</h2>
            <p className="text-[12px] text-slate-600 mt-1">
              The recording plays once. Progress: {bufferProgress}%{isBufferReady ? ' — ready.' : ' — buffering…'}
            </p>
            <div className="w-full h-1.5 bg-gray-200 rounded-sm overflow-hidden mt-3">
              <div className="h-full bg-slate-800 transition-all" style={{ width: `${bufferProgress}%` }} />
            </div>
            <button
              type="button"
              onClick={handleStartExamAudio}
              disabled={!isBufferReady}
              className="mt-4 inline-flex items-center gap-2 px-6 h-9 text-[13px] font-bold bg-black text-white rounded-[3px] hover:bg-slate-800 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" />
              {isBufferReady ? 'Start recording' : 'Please wait…'}
            </button>
          </div>
        )}

        {/* Playback status */}
        {hasAudioStarted && (
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-slate-700">
            <span className="font-bold text-slate-900">
              {!examHasAnyAudio
                ? 'No audio attached — answer directly.'
                : hasAudioEnded ? 'Recording ended — review time.' : isPlaying ? '● Playing…' : 'Paused'}
            </span>
            <div className="flex-1 min-w-[120px] h-1 bg-gray-200 rounded-sm overflow-hidden">
              <div className="h-full bg-slate-800 transition-all" style={{ width: `${audioPercent}%` }} />
            </div>
            <span className="font-mono text-[11px] text-slate-500">
              {hasAudioEnded ? `Review ${mmss(reviewSecondsLeft)}` : `${mmss(currentAudioSec)} / ${mmss(totalDuration)}`}
            </span>
            {!hasAudioEnded && !isPlaying && !audioError && examHasAnyAudio && (
              <button
                type="button"
                onClick={handleStartExamAudio}
                disabled={isFrozen}
                className="inline-flex items-center gap-1.5 px-3 h-7 text-[12px] font-bold bg-black text-white rounded-[3px] hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
                title={currentAudioSec > 0 ? `Resume from ${mmss(currentAudioSec)}` : 'Play'}
              >
                <Play className="w-3.5 h-3.5" />
                {currentAudioSec > 0 ? `Resume from ${mmss(currentAudioSec)}` : 'Play'}
              </button>
            )}
          </div>
        )}

        {/* YouTube failure: plain message + actions, never a mystery robot voice */}
        {audioError && !hasAudioEnded && (
          <div className="bg-amber-50 border border-amber-300 rounded-[3px] p-4 text-[12px] text-slate-800 max-w-xl">
            <p className="font-bold text-slate-900">
              {audioError === 'youtube-error' && 'This YouTube video cannot be played here.'}
              {audioError === 'youtube-blocked' && 'The browser blocked the audio.'}
              {audioError === 'youtube-api' && 'Could not reach YouTube.'}
            </p>
            <p className="mt-1 text-slate-600">
              {audioError === 'youtube-error' && 'The owner may have disabled embedding, or the video is restricted. Ask your admin for another link — or continue without audio.'}
              {audioError === 'youtube-blocked' && 'Tap the play button once to start the sound with your own tap.'}
              {audioError === 'youtube-api' && 'Check your connection or turn off the adblocker, then retry.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {audioError === 'youtube-blocked' ? (
                <button
                  type="button"
                  onClick={handleYoutubeTapToPlay}
                  disabled={isFrozen}
                  className="inline-flex items-center gap-1.5 px-4 h-8 text-[12px] font-bold bg-black text-white rounded-[3px] hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
                >
                  <Play className="w-3.5 h-3.5" />
                  Tap to play
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartExamAudio}
                  disabled={isFrozen}
                  className="inline-flex items-center gap-1.5 px-4 h-8 text-[12px] font-bold bg-black text-white rounded-[3px] hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={continueWithoutAudio}
                disabled={isFrozen}
                className="px-4 h-8 text-[12px] font-semibold border border-slate-300 rounded-[3px] bg-white hover:bg-slate-100 transition cursor-pointer disabled:opacity-40"
              >
                Continue without audio
              </button>
            </div>
          </div>
        )}

        <HighlightProvider highlights={highlights} onRemove={removeHighlight}>
          {currentSection.context && (
            <p className="text-[13px] text-slate-700 italic"><HlText text={currentSection.context} unitKey={`${hlP}|ctx`} /></p>
          )}

          {renderQuestions()}
        </HighlightProvider>
      </div>

      {/* Parts drawer */}
      {showDrawer && (
        <>
          <div className="fixed inset-0 z-[105] bg-black/40" onClick={() => setShowDrawer(false)} />
          <div className="fixed left-0 top-0 bottom-0 z-[106] w-72 bg-white border-r border-slate-300 shadow-2xl p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-bold text-slate-900">Listening parts</span>
              <button
                type="button"
                onClick={() => setShowDrawer(false)}
                aria-label="Close menu"
                className="p-1 hover:bg-slate-100 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {exam.listening.sections.map((sec, idx) => {
              const done = sec.questions.reduce((a, q) => a + (isAnswered(q.id) ? questionSlots(q) : 0), 0);
              const slotTotal = sec.questions.reduce((a, q) => a + questionSlots(q), 0);
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => {
                    handlePartSwitch(idx);
                    const first = sec.questions[0];
                    if (first) setFocusedId(first.id);
                    setShowDrawer(false);
                  }}
                  className={`w-full text-left px-3 py-2 mb-1 border rounded-[3px] transition cursor-pointer ${
                    activeSectionTab === idx ? 'border-slate-900 bg-slate-100' : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <span className="block text-[12px] font-bold text-slate-900">Part {sec.sectionNumber}</span>
                  <span className="block text-[11px] text-slate-500 font-mono">
                    {done} of {slotTotal} answered
                  </span>
                </button>
              );
            })}
            {onLockTerminal && (
              <button
                type="button"
                onClick={() => {
                  setShowDrawer(false);
                  onLockTerminal();
                }}
                className="w-full mt-2 px-3 py-2 text-[12px] font-semibold border border-slate-300 rounded-[3px] hover:bg-slate-100 transition cursor-pointer"
              >
                Lock screen
              </button>
            )}
          </div>
        </>
      )}

      {/* Per-part footer */}
      <div className="sticky bottom-0 z-40 bg-white border-t border-slate-300">
        <div className="max-w-[1400px] mx-auto px-3 py-1.5 flex items-end justify-between gap-3">
          <div className="flex items-end gap-5 overflow-x-auto">
            {exam.listening.sections.map((sec, idx) => {
              const done = sec.questions.reduce((a, q) => a + (isAnswered(q.id) ? questionSlots(q) : 0), 0);
              const slotTotal = sec.questions.reduce((a, q) => a + questionSlots(q), 0);
              const isCurrent = idx === activeSectionTab;
              return (
                <div key={sec.id} className="flex items-end gap-1.5 pb-0.5">
                  <span className={`text-[12px] whitespace-nowrap ${isCurrent ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
                    Part {sec.sectionNumber}
                  </span>
                  {isCurrent ? (
                    <span className="flex items-center gap-[3px]">
                      {expandNavSlots(sec.questions).map(s => renderNavDot(s.id, s.number))}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 font-mono whitespace-nowrap">
                      {done} of {slotTotal}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
            <button
              type="button"
              onClick={toggleFlag}
              title="Flag current question"
              className={`px-2 h-9 text-[11px] font-bold border rounded-[3px] transition cursor-pointer ${
                focusedQid && flagged.has(focusedQid)
                  ? 'bg-amber-400 border-amber-500 text-black'
                  : 'bg-gray-200 border-gray-300 text-slate-700 hover:bg-gray-300'
              }`}
            >
              Flag
            </button>
            <button
              type="button"
              onClick={goBack}
              disabled={focusIndex <= 0}
              aria-label="Back"
              className="w-9 h-9 flex items-center justify-center bg-gray-200 hover:bg-gray-300 text-slate-800 rounded-[3px] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={focusIndex < 0 || focusIndex >= allQs.length - 1}
              aria-label="Next"
              className="w-9 h-9 flex items-center justify-center bg-black hover:bg-slate-800 text-white rounded-[3px] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={finishSection}
              disabled={isFinishing}
              aria-label="Finish listening"
              title={isFinishing ? 'Switching to Reading…' : 'Finish listening section'}
              className={`w-9 h-9 flex items-center justify-center bg-black hover:bg-slate-800 text-white rounded-[3px] transition cursor-pointer disabled:opacity-40 disabled:cursor-wait ${isFinishing ? 'animate-pulse' : ''}`}
            >
              <Check className="w-5 h-5" strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
