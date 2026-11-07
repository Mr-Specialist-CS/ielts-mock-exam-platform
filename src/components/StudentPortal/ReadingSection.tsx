import React, { useState, useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import { CandidateSession, Exam, TextHighlight, Question, getQuestionFamily } from '../../types';
import { useThrottledSync } from '../../utils/useThrottledSync';
import { IdpTopBar, IdpFooterNav, IdpHelpModal, mmss } from './idpShell';
import {
  HighlightProvider, HlText, selectionToHls, hasSelectionIn, clearDomSelection,
  type PendingHl
} from './highlight';
import {
  IdpRadio3, IdpSingleList, IdpMultiList, IdpSelect, IdpText, IdpInlineBlanks, IdpDragMatch, splitBlanks,
  IdpTableGroup, IdpFlowGroup, IdpMapGroup, IdpSummaryGroup, IdpFlowTextGroup
} from './idpInputs';
import { questionSlots, spanEndNumber, expandNavSlots } from '../../utils/ieltsScoring';
import { splitLayoutGroups } from '../../utils/tableLayout';

interface ReadingSectionProps {
  session: CandidateSession;
  exam: Exam;
  onSyncSession: (partial: Partial<CandidateSession>) => void;
  onCompleteSection: (freshAnswers?: Record<string, string>) => void;
  onLockTerminal?: () => void;
  isFrozen?: boolean;
}

const HELP_LINES = [
  'The text is on the left, the questions on the right. Each pane scrolls on its own.',
  'Selecting passage or question text highlights it automatically. Selections across answer boxes highlight each side.',
  'Right-click a passage mark for Add note. Click a question mark to remove it.',
  'Use the numbered circles below to move between questions. Ticked circles are answered.',
  'Select any question circle, then press Flag to mark it for review.',
  'For gaps, respect the word limit shown. Extra words are cut automatically.',
  'For matching tasks, use the dropdowns — or drag cards into the box where offered.',
  'Complete tables directly inside the cells. Label maps by dragging a label onto its numbered point.',
  'Use Hide text to conceal the passage. The timer keeps running.'
];

export const ReadingSection: React.FC<ReadingSectionProps> = ({
  session,
  exam,
  onSyncSession,
  onCompleteSection,
  onLockTerminal,
  isFrozen = false
}) => {
  const [activePassageIdx, setActivePassageIdx] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(session.readingState.timeRemainingSeconds || 3600);
  const [answers, setAnswers] = useState<Record<string, string>>(session.readingState.answers || {});
  const [highlights, setHighlights] = useState<TextHighlight[]>(session.readingState.highlights || []);
  const [showConfirmFinish, setShowConfirmFinish] = useState(false);

  // IDP chrome state
  const [showHelp, setShowHelp] = useState(false);
  const [textHidden, setTextHidden] = useState(false);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hlId?: string } | null>(null);
  const [noteEditor, setNoteEditor] = useState<{ hlId: string; text: string; x: number; y: number } | null>(null);
  const [hasSel, setHasSel] = useState(false);
  const pendingHlRef = useRef<PendingHl[]>([]);
  const isFrozenRef = useRef(isFrozen);
  isFrozenRef.current = isFrozen;

  // Pen-ready selection tracking (passage + questions panes).
  useEffect(() => {
    const onSel = () => {
      if (isFrozenRef.current) {
        setHasSel(false);
        return;
      }
      if (hasSelectionIn('[data-reading-scope]')) {
        setHasSel(true);
        const ps = selectionToHls();
        if (ps.length) pendingHlRef.current = ps;
      } else {
        setHasSel(false);
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  // Pen button: passage selection → classic mark (right-click menu stays);
  // question-text selection → yellow mark. Mostly a touch fallback now.
  const handlePenHighlight = () => {
    if (isFrozenRef.current) return;
    const sel = window.getSelection();
    const elemOf = (n: Node | null): Element | null =>
      !n ? null : n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
    const inPassage = !!sel && !sel.isCollapsed &&
      !!elemOf(sel.anchorNode)?.closest?.('[data-passage-pane]') &&
      !!elemOf(sel.focusNode)?.closest?.('[data-passage-pane]');
    if (inPassage) {
      handleHighlightSelection();
      return;
    }
    const pid = currentPassageRef.current.id;
    const live = selectionToHls().filter(p => p.unitKey.startsWith(`${pid}|rq|`));
    const cached = pendingHlRef.current.filter(p => p.unitKey.startsWith(`${pid}|rq|`));
    commitRqHls(live.length ? live : cached);
  };

  // Refs for callbacks and session
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onSyncSessionRef = useRef(onSyncSession);
  onSyncSessionRef.current = onSyncSession;
  const onCompleteSectionRef = useRef(onCompleteSection);
  onCompleteSectionRef.current = onCompleteSection;
  const timeRemainingRef = useRef(timeRemaining);
  timeRemainingRef.current = timeRemaining;
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;

  // Keystroke answers are coalesced to at most one save per 10 s.
  const throttledSync = useThrottledSync(onSyncSession);

  // Global 60-minute countdown timer — frozen while hard-locked so the
  // exam stops for that user and resumes from the same second after reset.
  useEffect(() => {
    if (isFrozen) return;
    const timer = setInterval(() => {
      setTimeRemaining(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [isFrozen]);

  // One-click finish: immediate visual feedback + disabled while the switch
  // is in flight, so repeated clicks can't stack competing transitions.
  const [isFinishing, setIsFinishing] = useState(false);

  // Snapshot exact position the moment the lock engages.
  useEffect(() => {
    if (!isFrozen) return;
    onSyncSessionRef.current({
      readingState: {
        ...sessionRef.current.readingState,
        timeRemainingSeconds: timeRemainingRef.current,
        answers: { ...answersRef.current },
        highlights: [...highlightsRef.current]
      }
    });
  }, [isFrozen]);

  // Timer side effects (remaining-time persisted every 60 s — plenty for resume)
  useEffect(() => {
    if (isFrozen) return;
    if (timeRemaining === 0) {
      throttledSync.consumePending();
      onCompleteSectionRef.current({ ...answersRef.current });
    } else if (timeRemaining % 60 === 0) {
      onSyncSessionRef.current({
        readingState: {
          ...sessionRef.current.readingState,
          timeRemainingSeconds: timeRemaining
        }
      });
    }
  }, [timeRemaining, isFrozen]);

  // Finish with ONE authoritative save: disarm the throttled queue first so no
  // stale snapshot can land after the finish and revert the section change,
  // and hand the very latest answers to the completer.
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

  const currentPassage = exam.reading.passages[activePassageIdx] || exam.reading.passages[0];
  /** Highlight unit scope root for this passage's questions. */
  const rqP = `${currentPassage.id}|rq`;

  const handleAnswerChange = (qId: string, value: string) => {
    if (isFrozen) return;
    const updated = { ...answers, [qId]: value };
    setAnswers(updated);
    throttledSync.queueSync({
      readingState: {
        ...sessionRef.current.readingState,
        answers: updated
      }
    });
  };

  const persistHighlights = (updated: TextHighlight[]) => {
    setHighlights(updated);
    pendingHlRef.current = [];
    onSyncSessionRef.current({
      readingState: {
        ...sessionRef.current.readingState,
        highlights: updated
      }
    });
  };

  // Text selection & highlight (disabled while hard-locked). New marks are yellow.
  const handleHighlightSelection = (note?: string): string | null => {
    if (isFrozen) return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const selectedText = selection.toString().trim();
    if (!selectedText) return null;

    const range = selection.getRangeAt(0);

    // Find if the selection occurred inside one of our passage paragraph elements
    const startElem = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
    const endElem = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? (range.endContainer as Element)
      : range.endContainer.parentElement;

    const startParaElem = startElem?.closest('[data-para-idx]');
    const endParaElem = endElem?.closest('[data-para-idx]');

    let paragraphIndex: number | undefined;
    let startOffset: number | undefined;
    let endOffset: number | undefined;

    if (startParaElem && endParaElem && startParaElem === endParaElem) {
      const pIdxStr = startParaElem.getAttribute('data-para-idx');
      if (pIdxStr !== null) {
        paragraphIndex = parseInt(pIdxStr, 10);

        // Compute exact character offset from start of this paragraph element
        const preRange = document.createRange();
        preRange.selectNodeContents(startParaElem);
        preRange.setEnd(range.startContainer, range.startOffset);
        const rawSelText = range.toString();
        const leadingWhitespace = rawSelText.length - rawSelText.trimStart().length;
        const startChar = preRange.toString().length + leadingWhitespace;
        const endChar = startChar + selectedText.length;

        if (endChar > startChar) {
          startOffset = startChar;
          endOffset = endChar;
        }
      }
    }

    // Check for exact duplicate highlight at this same location
    if (paragraphIndex !== undefined && startOffset !== undefined && endOffset !== undefined) {
      if (highlights.some(h =>
        h.passageId === currentPassage.id &&
        h.paragraphIndex === paragraphIndex &&
        h.startOffset === startOffset &&
        h.endOffset === endOffset
      )) {
        return null;
      }
    } else {
      // Fallback: Avoid duplicate highlights for the same exact snippet in passage
      // (question-pane marks carry unitKey and never collide with passage marks).
      if (highlights.some(h => !h.unitKey && h.passageId === currentPassage.id && h.text === selectedText)) {
        return null;
      }
    }

    const newHighlight: TextHighlight = {
      id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      passageId: currentPassage.id,
      text: selectedText,
      color: 'yellow',
      timestamp: new Date().toISOString(),
      paragraphIndex,
      startOffset,
      endOffset,
      ...(note !== undefined ? { note } : {})
    };

    const updated = [...highlights, newHighlight];
    persistHighlights(updated);

    try {
      selection.removeAllRanges();
    } catch {}
    return newHighlight.id;
  };

  const currentPassageRef = useRef(currentPassage);
  currentPassageRef.current = currentPassage;

  // Commit yellow marks on question text (one per touched unit, deduped).
  const commitRqHls = (ps: PendingHl[]) => {
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
      passageId: currentPassageRef.current.id,
      text: p.text,
      color: 'yellow',
      timestamp: new Date().toISOString(),
      unitKey: p.unitKey,
      startOffset: p.start,
      endOffset: p.end
    }));
    persistHighlights([...highlightsRef.current, ...marks]);
  };
  const commitRqHlsRef = useRef(commitRqHls);
  commitRqHlsRef.current = commitRqHls;

  const autoHlRef = useRef(() => {});
  autoHlRef.current = () => {
    if (isFrozenRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const elemOf = (n: Node | null): Element | null =>
      !n ? null : n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
    const aPane = elemOf(sel.anchorNode)?.closest?.('[data-passage-pane]');
    const fPane = elemOf(sel.focusNode)?.closest?.('[data-passage-pane]');
    if (aPane && fPane) {
      if (!textHidden) handleHighlightSelection();
      return;
    }
    // Question-text fragments (selections fully outside the passage pane).
    if (!aPane && !fPane) {
      const pid = currentPassageRef.current.id;
      const frags = selectionToHls().filter(p => p.unitKey.startsWith(`${pid}|rq|`));
      if (frags.length) commitRqHlsRef.current(frags);
    }
  };

  // Selecting passage text highlights it automatically once the selection is
  // finalized (mouse released, touch lifted, keys released).
  useEffect(() => {
    const auto = () => autoHlRef.current();
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) auto();
    };
    window.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', auto);
    document.addEventListener('keyup', auto);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchend', auto);
      document.removeEventListener('keyup', auto);
    };
  }, []);

  const removeHighlight = (id: string) => {
    const updated = highlights.filter(h => h.id !== id);
    persistHighlights(updated);
  };

  const saveNote = (id: string, note: string) => {
    const updated = highlights.map(h => (h.id === id ? { ...h, note } : h));
    persistHighlights(updated);
  };

  const clearPassageHighlights = () => {
    const updated = highlights.filter(h => h.passageId !== currentPassage.id);
    persistHighlights(updated);
  };

  const passageHighlights = highlights.filter(h => h.passageId === currentPassage.id);

  // Right-click menu on the passage: Highlight / Add note / Remove.
  const handlePassageContextMenu = (e: React.MouseEvent) => {
    if (isFrozen) return;
    const markElem = (e.target as Element)?.closest?.('[data-hl-id]');
    const hlId = markElem?.getAttribute('data-hl-id') || undefined;
    const sel = window.getSelection();
    const hasSelection = !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
    if (!hlId && !hasSelection) return;
    e.preventDefault();
    setNoteEditor(null);
    setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 160), hlId });
  };

  // Render passage text with ALL highlights dynamically and accurately
  const renderPassageWithHighlights = (rawText: string) => {
    const normalized = (rawText || '').replace(/\r\n/g, '\n');
    const paragraphs = normalized.split(/\n\n+/);

    // Track highlights matched without explicit paragraphIndex to avoid duplicating across multiple paragraphs
    const matchedLegacyHlIds = new Set<string>();

    return paragraphs.map((para, pIdx) => {
      if (!para.trim()) return null;

      // Find all matches for all highlights in this paragraph
      interface HighlightMatch {
        start: number;
        end: number;
        hl: TextHighlight;
      }

      const matches: HighlightMatch[] = [];

      passageHighlights.forEach(hl => {
        if (!hl.text || !hl.text.trim()) return;
        // Question-pane marks (unitKey set) render inside their own units —
        // never ghost-match identical text in the passage.
        if (hl.unitKey) return;
        const searchStr = hl.text.trim();

        // 1. If highlight has paragraphIndex recorded:
        if (typeof hl.paragraphIndex === 'number') {
          // If this highlight belongs to a different paragraph, skip!
          if (hl.paragraphIndex !== pIdx) return;

          // If exact startOffset & endOffset are present:
          if (
            typeof hl.startOffset === 'number' &&
            typeof hl.endOffset === 'number' &&
            hl.endOffset > hl.startOffset
          ) {
            const s = hl.startOffset;
            const e = hl.endOffset;
            const targetSlice = para.slice(s, e).trim();

            // Check if exact slice matches what user highlighted
            if (targetSlice === searchStr) {
              matches.push({ start: s, end: e, hl });
              return;
            }

            // If text shifted slightly, search within nearby window around offset
            const searchWindowStart = Math.max(0, s - 15);
            const searchWindowEnd = Math.min(para.length, e + 15);
            const windowText = para.slice(searchWindowStart, searchWindowEnd);
            const relIdx = windowText.indexOf(searchStr);
            if (relIdx !== -1) {
              const adjustedStart = searchWindowStart + relIdx;
              matches.push({
                start: adjustedStart,
                end: adjustedStart + searchStr.length,
                hl
              });
              return;
            }
          }

          // Fallback within the designated paragraph: only match the FIRST occurrence in this paragraph
          const firstIdx = para.indexOf(searchStr);
          if (firstIdx !== -1) {
            matches.push({
              start: firstIdx,
              end: firstIdx + searchStr.length,
              hl
            });
          }
          return;
        }

        // 2. Legacy highlights without paragraphIndex:
        // Match ONLY the single first occurrence in the entire text (do not highlight all occurrences!)
        if (matchedLegacyHlIds.has(hl.id)) return;
        const legacyIdx = para.indexOf(searchStr);
        if (legacyIdx !== -1) {
          matchedLegacyHlIds.add(hl.id);
          matches.push({
            start: legacyIdx,
            end: legacyIdx + searchStr.length,
            hl
          });
        }
      });

      // If no highlights in this paragraph, render plain paragraph
      if (matches.length === 0) {
        return (
          <p
            key={pIdx}
            data-para-idx={pIdx}
            className="mb-4 text-slate-900 leading-relaxed text-[13px] font-serif whitespace-pre-line"
          >
            {para}
          </p>
        );
      }

      // Sort matches by start position
      matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

      // Filter overlapping intervals cleanly
      const nonOverlapping: HighlightMatch[] = [];
      let lastEnd = 0;

      for (const m of matches) {
        if (m.start >= lastEnd) {
          nonOverlapping.push(m);
          lastEnd = m.end;
        }
      }

      // Build paragraph nodes by interleaving unhighlighted text and <mark> elements
      const nodes: React.ReactNode[] = [];
      let cursor = 0;

      nonOverlapping.forEach((m, mIdx) => {
        if (m.start > cursor) {
          nodes.push(para.slice(cursor, m.start));
        }

        const snippet = para.slice(m.start, m.end);
        const hasNote = !!m.hl.note;
        nodes.push(
          <mark
            key={`${m.hl.id}-${mIdx}`}
            data-hl-id={m.hl.id}
            className="px-0.5 rounded-sm cursor-pointer bg-yellow-200 text-slate-900 border-b border-yellow-500"
            title={hasNote ? 'Note attached — right-click to view' : 'Right-click for options'}
            onClick={(e) => {
              e.stopPropagation();
              if (hasNote) {
                setCtxMenu(null);
                setNoteEditor({ hlId: m.hl.id, text: m.hl.note || '', x: Math.min(e.clientX, window.innerWidth - 300), y: Math.min(e.clientY, window.innerHeight - 220) });
              } else {
                removeHighlight(m.hl.id);
              }
            }}
          >
            {snippet}
            {hasNote && <sup className="ml-0.5 text-[9px] font-bold text-blue-800">[note]</sup>}
          </mark>
        );

        cursor = m.end;
      });

      if (cursor < para.length) {
        nodes.push(para.slice(cursor));
      }

      return (
        <p
          key={pIdx}
          data-para-idx={pIdx}
          className="mb-4 text-slate-900 leading-relaxed text-[13px] font-serif whitespace-pre-line"
        >
          {nodes}
        </p>
      );
    });
  };

  // Flattened module navigation (Passages 1–3, all questions)
  const allQs = exam.reading.passages.flatMap((p, pi) => p.questions.map(q => ({ ...q, pi })));
  const isAnswered = (id: string) => (answers[id] || '').trim() !== '';
  const focusedQid = (() => {
    if (focusedId && currentPassage.questions.some(q => q.id === focusedId)) return focusedId;
    return currentPassage.questions[0]?.id || null;
  })();
  const focusIndex = allQs.findIndex(q => q.id === focusedQid);
  const jumpTo = (id: string) => {
    const target = allQs.find(q => q.id === id);
    if (!target) return;
    setActivePassageIdx(target.pi);
    setFocusedId(id);
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

  const renderWidget = (q: Question) => {
    const currentAns = answers[q.id] || '';
    const family = getQuestionFamily(q.type);
    const blanks = splitBlanks(q.prompt);

    if (family === 'tfng') {
      return (
        <div className="pt-1 space-y-1">
          <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${rqP}|${q.id}|prompt`} /></p>
          <IdpRadio3 qid={q.id} value={currentAns} choices={['TRUE', 'FALSE', 'NOT GIVEN']} onPick={v => handleAnswerChange(q.id, v)} horizontal hlPrefix={rqP} />
        </div>
      );
    }
    if (family === 'ynng') {
      return (
        <div className="pt-1 space-y-1">
          <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${rqP}|${q.id}|prompt`} /></p>
          <IdpRadio3 qid={q.id} value={currentAns} choices={['YES', 'NO', 'NOT GIVEN']} onPick={v => handleAnswerChange(q.id, v)} horizontal hlPrefix={rqP} />
        </div>
      );
    }
    if (q.type === 'multiple_choice') {
      return (
        <div className="pt-1 space-y-1">
          <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${rqP}|${q.id}|prompt`} /></p>
          <IdpSingleList qid={q.id} value={currentAns} options={q.options || []} onPick={k => handleAnswerChange(q.id, k)} hlPrefix={rqP} />
        </div>
      );
    }
    if (q.type === 'multiple_choice_multi') {
      const slots = questionSlots(q);
      return (
        <div className="pt-1 space-y-1">
          {slots > 1 && (
            <p className="text-[13px] font-bold text-slate-900">
              Questions {q.number}–{q.number + slots - 1}
            </p>
          )}
          {q.instructionLine?.trim() && (
            <p className="text-[13px] text-slate-900"><HlText text={q.instructionLine} unitKey={`${rqP}|${q.id}|instr`} /></p>
          )}
          <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${rqP}|${q.id}|prompt`} /></p>
          <IdpMultiList qid={q.id} value={currentAns} options={q.options || []} max={q.maxSelections} onPick={csv => handleAnswerChange(q.id, csv)} hlPrefix={rqP} />
        </div>
      );
    }
    if (q.type === 'matching_headings' || q.type === 'matching_features') {
      return (
        <div className="pt-1 space-y-1">
          <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${rqP}|${q.id}|prompt`} /></p>
          <IdpDragMatch qid={q.id} options={q.options || []} value={currentAns} onPick={v => handleAnswerChange(q.id, v)} hlPrefix={rqP} />
        </div>
      );
    }
    if (q.type === 'matching_information' || q.type === 'matching_sentence_endings') {
      if (blanks.length === 2) {
        return (
          <IdpInlineBlanks
            prompt={q.prompt}
            value={currentAns}
            onEdit={v => handleAnswerChange(q.id, v)}
            selectOptions={q.options || []}
            hlUnit={`${rqP}|${q.id}`}
          />
        );
      }
      return (
        <div className="pt-1">
          <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${rqP}|${q.id}|prompt`} /></p>
          <IdpSelect qid={q.id} value={currentAns} options={q.options || []} onPick={v => handleAnswerChange(q.id, v)} ariaLabel={`Answer for question ${q.number}`} />
        </div>
      );
    }
    if (blanks.length === 2) {
      return (
        <IdpInlineBlanks
          prompt={q.prompt}
          value={currentAns}
          onEdit={v => handleAnswerChange(q.id, v)}
          wordLimit={q.wordLimit}
          hlUnit={`${rqP}|${q.id}`}
        />
      );
    }
    return (
      <div className="pt-1">
        <p className="text-[13px] text-slate-900 leading-relaxed"><HlText text={q.prompt} unitKey={`${rqP}|${q.id}|prompt`} /></p>
        <IdpText qid={q.id} value={currentAns} onEdit={v => handleAnswerChange(q.id, v)} wordLimit={q.wordLimit} />
      </div>
    );
  };

  return (
    <div data-reading-scope className="bg-gray-100 min-h-[calc(100vh-4rem)] flex flex-col" onClick={() => setCtxMenu(null)}>
      <IdpTopBar
        left="Reading"
        sub={`Passage ${activePassageIdx + 1} of ${exam.reading.passages.length} · ${session.candidateId}`}
        timerText={mmss(timeRemaining)}
        urgent={timeRemaining < 300}
        timerNote="Reading time remaining"
        onHelp={() => setShowHelp(true)}
        highlightAction={{
          onHighlight: handlePenHighlight,
          disabled: isFrozen || !hasSel,
          title: isFrozen ? 'Highlighting locked' : hasSel ? 'Highlight selection' : 'Select passage text first, then press the pen'
        }}
        hideToggle={{ hidden: textHidden, onToggle: () => setTextHidden(v => !v) }}
        extra={
          onLockTerminal ? (
            <button
              type="button"
              onClick={onLockTerminal}
              title="Lock screen"
              className="px-2 h-7 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 border border-slate-600 rounded-sm transition cursor-pointer"
            >
              Lock
            </button>
          ) : undefined
        }
      />
      {showHelp && <IdpHelpModal title="Reading — Help" lines={HELP_LINES} onClose={() => setShowHelp(false)} />}

      <div className="max-w-[1400px] w-full mx-auto px-3 py-3 flex-1 flex flex-col min-h-0">
        {/* Passage tabs */}
        <div className="flex gap-1 border-b-2 border-slate-900 pb-0 mb-3 overflow-x-auto" role="tablist" aria-label="Reading passages">
          {exam.reading.passages.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={activePassageIdx === idx}
              onClick={() => {
                setActivePassageIdx(idx);
                const first = p.questions[0];
                if (first) setFocusedId(first.id);
              }}
              className={`px-4 h-8 text-[12px] font-bold whitespace-nowrap border border-b-0 rounded-t-sm transition cursor-pointer ${
                activePassageIdx === idx
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'
              }`}
            >
              Passage {p.passageNumber}
            </button>
          ))}
          {passageHighlights.length > 0 && (
            <button
              type="button"
              onClick={clearPassageHighlights}
              title="Clear highlights in this passage"
              className="ml-auto px-2 h-8 text-[11px] font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 rounded-t-sm bg-white transition cursor-pointer whitespace-nowrap"
            >
              Clear marks ({passageHighlights.length})
            </button>
          )}
        </div>

        {/* Split panes, independent scroll */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-[60vh]">
          <div
            data-passage-pane
            className="bg-white border border-slate-400 rounded-sm p-4 overflow-y-auto max-h-[68vh]"
            onContextMenu={handlePassageContextMenu}
          >
            <h2 className="text-[15px] font-bold text-slate-900 border-b border-slate-200 pb-2 mb-3">{currentPassage.title}</h2>
            {currentPassage.subtitle && <p className="text-[12px] italic text-slate-600 mb-3">{currentPassage.subtitle}</p>}
            {textHidden ? (
              <p className="text-[12px] text-slate-500 italic border border-dashed border-slate-400 rounded-sm p-6 text-center">
                Text hidden. Use Hide text again to reveal it. The timer keeps running.
              </p>
            ) : (
              renderPassageWithHighlights(currentPassage.text)
            )}
          </div>

          <div className="bg-white border border-slate-400 rounded-sm p-4 overflow-y-auto max-h-[68vh]">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-3">
              <span className="text-[12px] font-bold text-slate-900">
                Questions {currentPassage.questions[0]?.number}–{(() => { const lq = currentPassage.questions[currentPassage.questions.length - 1]; return lq ? spanEndNumber(lq) : ''; })()}
              </span>
              <span className="text-[11px] text-slate-500 font-mono">
                {currentPassage.questions.reduce((a, q) => a + (isAnswered(q.id) ? questionSlots(q) : 0), 0)}/{currentPassage.questions.reduce((a, q) => a + questionSlots(q), 0)} answered
              </span>
            </div>
            <HighlightProvider highlights={highlights} onRemove={removeHighlight}>
            <div className="space-y-3">
              {(() => {
                type RBlock =
                  | { kind: 'table'; qs: Question[] }
                  | { kind: 'flow'; qs: Question[] }
                  | { kind: 'flowtext'; qs: Question[] }
                  | { kind: 'map'; qs: Question[]; imageUrl: string }
                  | { kind: 'summary'; qs: Question[] }
                  | { kind: 'single'; q: Question };
                const qs = currentPassage.questions;
                const sameOptions = (a?: string[], b?: string[]) =>
                  !!a && a.length > 0 && JSON.stringify(a) === JSON.stringify(b);
                const blocks: RBlock[] = [];
                let i = 0;
                while (i < qs.length) {
                  const q = qs[i];
                  if (q.type === 'table_completion') {
                    const group: Question[] = [q];
                    let j = i + 1;
                    while (j < qs.length && qs[j].type === 'table_completion') {
                      group.push(qs[j]);
                      j++;
                    }
                    // A fresh tableDef on a later question starts a NEW table
                    // (two tables back-to-back render separately). Sub-groups
                    // without any layout fall through to single cards below.
                    const subs = splitLayoutGroups(group);
                    if (subs.every(sub => !sub[0].tableDef?.rows?.length)) {
                      // No layout anywhere: fall through to single typed cards below
                    } else {
                      for (const sub of subs) {
                        if (sub[0].tableDef?.rows?.length) blocks.push({ kind: 'table', qs: sub });
                        else sub.forEach(sq => blocks.push({ kind: 'single', q: sq }));
                      }
                      i = j;
                      continue;
                    }
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
                    // Type-in flow: consecutive questions form ONE vertical
                    // chart (layout from the first question's flowDef, else
                    // each prompt is its own box) — no word bank involved.
                    // A fresh flowDef starts a NEW chart.
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
                  }
                  if (q.type === 'summary_completion') {
                    // Consecutive summary gaps form ONE boxed summary (paper layout),
                    // like table_completion: bank + instruction taken from the group.
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
                  blocks.push({ kind: 'single', q });
                  i++;
                }

                const groupProps = {
                  answers,
                  flagged,
                  onFocus: (id: string) => setFocusedId(id)
                };
                const renderSingleCard = (q: Question, hideInstruction: boolean) => (
                  <div
                    key={q.id}
                    onClick={() => setFocusedId(q.id)}
                    className={`border rounded-sm p-2.5 transition ${
                      focusedQid === q.id ? 'border-blue-800 ring-1 ring-blue-800 bg-white' : 'border-slate-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 bg-slate-900 text-white text-[11px] font-mono font-bold flex items-center justify-center ${q.type === 'multiple_choice_multi' && questionSlots(q) > 1 ? 'w-auto px-1.5 h-6 rounded-full' : 'w-6 h-6 rounded-full'}`} title={q.type === 'multiple_choice_multi' && questionSlots(q) > 1 ? `Questions ${q.number}–${spanEndNumber(q)}` : `Question ${q.number}`}>
                        {q.type === 'multiple_choice_multi' && questionSlots(q) > 1 ? `${q.number}–${spanEndNumber(q)}` : q.number}
                      </span>
                      {flagged.has(q.id) && (
                        <span className="mt-1 text-[10px] font-bold uppercase text-amber-700 tracking-wide">Flagged</span>
                      )}
                      <div className="flex-1 min-w-0">
                        {!hideInstruction && q.instructionLine && (
                          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1"><HlText text={q.instructionLine} unitKey={`${rqP}|${q.id}|instr`} /></p>
                        )}
                        {(q as { type: string }).type === 'multiple_choice_multi' && !q.maxSelections && (
                          <p className="text-[11px] text-slate-500 italic">Choose all correct answers.</p>
                        )}
                        {renderWidget(q)}
                      </div>
                    </div>
                  </div>
                );

                const out: React.ReactNode[] = [];
                let k = 0;
                while (k < blocks.length) {
                  const b = blocks[k];
                  if (b.kind === 'table') {
                    out.push(
                      <IdpTableGroup key={`t-${b.qs[0].id}`} qs={b.qs} {...groupProps} onEdit={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={rqP} />
                    );
                    k++;
                    continue;
                  }
                  if (b.kind === 'flow') {
                    out.push(
                      <IdpFlowGroup key={`f-${b.qs[0].id}`} qs={b.qs} {...groupProps} onPick={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={rqP} />
                    );
                    k++;
                    continue;
                  }
                  if (b.kind === 'flowtext') {
                    out.push(
                      <IdpFlowTextGroup key={`ft-${b.qs[0].id}`} qs={b.qs} {...groupProps} onEdit={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={rqP} />
                    );
                    k++;
                    continue;
                  }
                  if (b.kind === 'map') {
                    out.push(
                      <IdpMapGroup key={`m-${b.qs[0].id}`} qs={b.qs} imageUrl={b.imageUrl} {...groupProps} onPick={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={rqP} />
                    );
                    k++;
                    continue;
                  }
                  if (b.kind === 'summary') {
                    out.push(
                      <IdpSummaryGroup key={`s-${b.qs[0].id}`} qs={b.qs} {...groupProps} onAnswer={(qid, v) => handleAnswerChange(qid, v)} hlPrefix={rqP} />
                    );
                    k++;
                    continue;
                  }
                  // Multi-answer widgets always stand alone with their own header
                  // and instruction (they already show "Questions N–M").
                  // Consecutive singles run under one "Questions A–B" header
                  // when they share an instruction line — or, without any
                  // instruction, when they share one question type (so the
                  // paper's ranges like 11–14 always show).
                  if (b.q.type !== 'multiple_choice_multi') {
                    const runInstr = b.q.instructionLine?.trim() || '';
                    const runType = b.q.type;
                    const sameRun = (x: RBlock) =>
                      x.kind === 'single' &&
                      (x as { kind: 'single'; q: Question }).q.type !== 'multiple_choice_multi' &&
                      ((x as { kind: 'single'; q: Question }).q.instructionLine?.trim() || '') === runInstr &&
                      (runInstr !== '' || (x as { kind: 'single'; q: Question }).q.type === runType);
                    let j = k + 1;
                    while (j < blocks.length && sameRun(blocks[j])) {
                      j++;
                    }
                    if (j > k + 1) {
                      const runQs = blocks.slice(k, j).map(x => (x as { kind: 'single'; q: Question }).q);
                      out.push(
                        <div key={`run-${runQs[0].id}`}>
                          <p className="text-[13px] font-bold text-slate-900">
                            Questions {runQs[0].number}–{spanEndNumber(runQs[runQs.length - 1])}
                          </p>
                          {runInstr && (
                            <p className="text-[13px] text-slate-900 mt-0.5 mb-2"><HlText text={runInstr} unitKey={`${rqP}|run|${runQs[0].id}|instr`} /></p>
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
                return out;
              })()}
            </div>
            </HighlightProvider>
          </div>
        </div>
      </div>

      {/* Right-click menu */}
      {ctxMenu && (
        <div
          className="fixed z-[110] w-52 bg-white border-2 border-slate-900 rounded-sm shadow-xl py-1 text-[12px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
        >
          {ctxMenu.hlId ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const hl = highlights.find(h => h.id === ctxMenu.hlId);
                  setNoteEditor({ hlId: ctxMenu.hlId!, text: hl?.note || '', x: ctxMenu.x, y: ctxMenu.y });
                  setCtxMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-100 font-semibold text-slate-900 cursor-pointer"
              >
                {highlights.find(h => h.id === ctxMenu.hlId)?.note ? 'View / edit note' : 'Add note'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  removeHighlight(ctxMenu.hlId!);
                  setCtxMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-800 cursor-pointer"
              >
                Remove highlight
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handleHighlightSelection();
                  setCtxMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-100 font-semibold text-slate-900 cursor-pointer"
              >
                Highlight
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = handleHighlightSelection('');
                  if (id) setNoteEditor({ hlId: id, text: '', x: ctxMenu.x, y: ctxMenu.y });
                  setCtxMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-800 cursor-pointer"
              >
                Add note
              </button>
            </>
          )}
        </div>
      )}

      {/* Note editor */}
      {noteEditor && (
        <div
          className="fixed z-[110] w-72 bg-white border-2 border-slate-900 rounded-sm shadow-xl"
          style={{ left: Math.min(noteEditor.x, window.innerWidth - 300), top: Math.min(noteEditor.y, window.innerHeight - 230) }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 h-8 flex items-center justify-between bg-slate-900 text-white">
            <span className="text-[11px] font-bold">Note</span>
            <button
              type="button"
              onClick={() => setNoteEditor(null)}
              className="text-[11px] font-bold hover:underline cursor-pointer"
            >
              Close
            </button>
          </div>
          <div className="p-3 space-y-2">
            <textarea
              rows={3}
              autoFocus
              value={noteEditor.text}
              onChange={e => setNoteEditor({ ...noteEditor, text: e.target.value })}
              placeholder="Type your note…"
              className="w-full px-2 py-1.5 text-[12px] bg-white border border-slate-500 text-slate-900 rounded-sm focus:outline-none focus:border-blue-800"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  saveNote(noteEditor.hlId, noteEditor.text);
                  setNoteEditor(null);
                }}
                className="flex-1 h-7 text-[11px] font-bold bg-slate-900 text-white rounded-sm hover:bg-slate-700 transition cursor-pointer"
              >
                Save note
              </button>
              <button
                type="button"
                onClick={() => {
                  removeHighlight(noteEditor.hlId);
                  setNoteEditor(null);
                }}
                className="px-3 h-7 text-[11px] font-semibold bg-white border border-slate-400 text-slate-700 rounded-sm hover:bg-slate-100 transition cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <IdpFooterNav
        items={expandNavSlots(allQs).map(s => ({ id: s.id, number: s.number, answered: isAnswered(s.id) }))}
        currentId={focusedQid}
        flagged={flagged}
        onJump={jumpTo}
        onBack={goBack}
        onNext={goNext}
        onToggleFlag={toggleFlag}
        backDisabled={focusIndex <= 0}
        nextDisabled={focusIndex < 0 || focusIndex >= allQs.length - 1}
        finish={{ label: isFinishing ? 'Switching…' : 'Finish', disabled: isFinishing, onClick: () => { if (!isFinishing) setShowConfirmFinish(true); } }}
        statusText={`Passage ${activePassageIdx + 1} of ${exam.reading.passages.length}`}
      />
      {showHelp && <IdpHelpModal title="Reading — Help" lines={HELP_LINES} onClose={() => setShowHelp(false)} />}

      {/* Finish confirmation */}
      {showConfirmFinish && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-white border-2 border-slate-900 rounded-sm p-5 space-y-3">
            <h3 className="text-[14px] font-bold text-slate-900">Finish Reading?</h3>
            <p className="text-[12px] text-slate-700 leading-relaxed">
              Proceed to Writing? Unused time does not carry over.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmFinish(false)}
                className="flex-1 h-8 text-[12px] font-semibold bg-white border border-slate-500 text-slate-800 rounded-sm hover:bg-slate-100 transition cursor-pointer"
              >
                Keep Working
              </button>
              <button
                type="button"
                disabled={isFinishing}
                onClick={() => {
                  setShowConfirmFinish(false);
                  finishSection();
                }}
                className="flex-1 h-8 text-[12px] font-bold bg-slate-900 text-white rounded-sm hover:bg-slate-700 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              >
                {isFinishing ? 'Switching…' : 'Finish & Go to Writing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
