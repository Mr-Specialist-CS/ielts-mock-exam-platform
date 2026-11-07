import { CandidateSession, Exam, Question } from '../types';

/**
 * Official IELTS Rounding Algorithm:
 * The overall score is calculated by taking the mean of the four module band scores (L, R, W, S).
 * - If the average ends in .25, it is rounded up to the next half band (e.g., 6.25 -> 6.5).
 * - If the average ends in .75, it is rounded up to the next whole band (e.g., 6.75 -> 7.0).
 * - If the average ends in .125, it rounds down to .0 (e.g. 6.125 -> 6.0).
 * - If the average ends in .375 or .625, it rounds to .5 (e.g. 6.375 -> 6.5).
 * - If the average ends in .875, it rounds to the next whole band (e.g. 6.875 -> 7.0).
 */
export function calculateIeltsOverallBand(l: number, r: number, w: number, s: number): number {
  const avg = (l + r + w + s) / 4;
  const integerPart = Math.floor(avg);
  const decimalPart = Math.round((avg - integerPart) * 1000) / 1000;

  if (decimalPart < 0.25) {
    return integerPart;
  } else if (decimalPart < 0.75) {
    return integerPart + 0.5;
  } else {
    return integerPart + 1.0;
  }
}

/**
 * Standard Academic Listening Raw Score (0-40) to IELTS Band (1.0 - 9.0)
 */
export function rawToListeningBand(raw: number): number {
  if (raw >= 39) return 9.0;
  if (raw >= 37) return 8.5;
  if (raw >= 35) return 8.0;
  if (raw >= 32) return 7.5;
  if (raw >= 30) return 7.0;
  if (raw >= 26) return 6.5;
  if (raw >= 23) return 6.0;
  if (raw >= 18) return 5.5;
  if (raw >= 16) return 5.0;
  if (raw >= 13) return 4.5;
  if (raw >= 10) return 4.0;
  if (raw >= 8) return 3.5;
  if (raw >= 6) return 3.0;
  if (raw >= 4) return 2.5;
  return 2.0;
}

/**
 * Standard Academic Reading Raw Score (0-40) to IELTS Band (1.0 - 9.0)
 */
export function rawToReadingBand(raw: number): number {
  if (raw >= 39) return 9.0;
  if (raw >= 37) return 8.5;
  if (raw >= 35) return 8.0;
  if (raw >= 33) return 7.5;
  if (raw >= 30) return 7.0;
  if (raw >= 27) return 6.5;
  if (raw >= 23) return 6.0;
  if (raw >= 19) return 5.5;
  if (raw >= 15) return 5.0;
  if (raw >= 13) return 4.5;
  if (raw >= 10) return 4.0;
  if (raw >= 8) return 3.5;
  if (raw >= 6) return 3.0;
  if (raw >= 4) return 2.5;
  return 2.0;
}

/**
 * Map IELTS Band to CEFR level
 */
export function bandToCefr(band: number): 'C2' | 'C1' | 'B2' | 'B1' | 'B0' {
  if (band >= 8.5) return 'C2';
  if (band >= 7.0) return 'C1';
  if (band >= 5.5) return 'B2';
  if (band >= 4.0) return 'B1';
  return 'B0';
}

/**
 * Clean & normalize student answer for comparison
 */
export function normalizeAnswer(ans: string | undefined): string {
  if (!ans) return '';
  return ans
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Check if candidate's answer matches any of the accepted keys.
 * Also tolerates word-bank letter equivalence for summary completion
 * (e.g. candidate "D" vs key "D Mason", or candidate "Mason" vs key "D Mason").
 */
export function checkAnswerMatch(candidateAnswer: string | undefined, acceptedKeys: string[]): boolean {
  if (!candidateAnswer) return false;
  const normalizedCandidate = normalizeAnswer(candidateAnswer);
  if (!normalizedCandidate) return false;

  const stripLeadingLetter = (s: string) => s.replace(/^[a-z]\s+/, '').trim();

  return acceptedKeys.some(key => {
    const normalizedKey = normalizeAnswer(key);
    if (!normalizedKey) return false;
    if (normalizedCandidate === normalizedKey) return true;
    // Single-letter candidate vs "D mason"-style key.
    if (/^[a-z]$/.test(normalizedCandidate)) {
      if (normalizedKey === normalizedCandidate) return true;
      if (normalizedKey.startsWith(normalizedCandidate + ' ')) return true;
    }
    // Single-letter key vs "D mason"-style candidate.
    if (/^[a-z]$/.test(normalizedKey)) {
      if (normalizedCandidate.startsWith(normalizedKey + ' ')) return true;
    }
    // Word-only vs "D word"-style (ignore the leading bank letter).
    const cStripped = stripLeadingLetter(normalizedCandidate);
    const kStripped = stripLeadingLetter(normalizedKey);
    if (cStripped && kStripped && cStripped === kStripped) return true;
    return false;
  });
}

/**
 * Grade Listening section for a session.
 * multiple_choice_multi consumes one mark per accepted letter (see
 * getMultiLetters): each correct letter earns its own question number.
 */
export function gradeListening(session: CandidateSession, exam: Exam) {
  let raw = 0;
  const overrides = session.grading.listeningScore?.overrides || {};
  const allQuestions = exam.listening.sections.flatMap(s => s.questions);
  let total = 0;

  allQuestions.forEach(q => {
    const marks = scoreQuestionMarks(q, session.listeningState.answers[q.id], overrides[q.id]);
    raw += marks.earned;
    total += marks.total;
  });

  // Scale raw score to 40-question standard if test has fewer sample questions
  const scaledRaw = Math.round((raw / (total || 1)) * 40);
  const band = rawToListeningBand(scaledRaw);

  return { raw, band, total, overrides };
}

/**
 * Grade Reading section for a session (same per-letter multi rule).
 */
export function gradeReading(session: CandidateSession, exam: Exam) {
  let raw = 0;
  const overrides = session.grading.readingScore?.overrides || {};
  const allQuestions = exam.reading.passages.flatMap(p => p.questions);
  let total = 0;

  allQuestions.forEach(q => {
    const marks = scoreQuestionMarks(q, session.readingState.answers[q.id], overrides[q.id]);
    raw += marks.earned;
    total += marks.total;
  });

  const scaledRaw = Math.round((raw / (total || 1)) * 40);
  const band = rawToReadingBand(scaledRaw);

  return { raw, band, total, overrides };
}

/**
 * Check if ALL 4 module grades (Listening, Reading, Writing, Speaking)
 * and the overall band are certified & finalized for a candidate session.
 * Writing counts ONLY with human examiner confirmation (writingAdminEvaluation);
 * the AI evaluation alone never certifies the overall band.
 * Without all grades finalized, official TRF cannot be generated or viewed.
 */
export function isSessionAllGradesFinalized(session?: CandidateSession | null): boolean {
  if (!session || !session.grading) return false;
  const g = session.grading;
  if (!g.isFinalized) return false;
  if (!g.listeningScore || typeof g.listeningScore.band !== 'number') return false;
  if (!g.readingScore || typeof g.readingScore.band !== 'number') return false;
  const hasWriting = !!(g.writingAdminEvaluation && typeof g.writingAdminEvaluation.overallBand === 'number');
  if (!hasWriting) return false;
  if (!g.speakingEvaluation || typeof g.speakingEvaluation.overallBand !== 'number') return false;
  if (typeof g.finalOverallBand !== 'number') return false;
  return true;
}

/**
 * Inspect individual module grading status and determine overall progress
 */
export function getSessionGradingProgress(session?: CandidateSession | null) {
  if (!session || !session.grading) {
    return {
      isFinalized: false,
      allFinalized: false,
      hasListening: false,
      listeningBand: undefined as number | undefined,
      hasReading: false,
      readingBand: undefined as number | undefined,
      hasWriting: false,
      writingBand: undefined as number | undefined,
      hasSpeaking: false,
      speakingBand: undefined as number | undefined,
      overallBand: undefined as number | undefined,
      cefrLevel: undefined as string | undefined,
      missingModules: ['listening', 'reading', 'writing', 'speaking'] as ('listening' | 'reading' | 'writing' | 'speaking')[]
    };
  }
  const g = session.grading;
  const hasListening = typeof g.listeningScore?.band === 'number';
  const hasReading = typeof g.readingScore?.band === 'number';
  // Human examiner confirmation only — AI evaluation alone never completes writing.
  const hasWriting = typeof g.writingAdminEvaluation?.overallBand === 'number';
  const hasSpeaking = typeof g.speakingEvaluation?.overallBand === 'number';
  const missingModules: ('listening' | 'reading' | 'writing' | 'speaking')[] = [];
  if (!hasListening) missingModules.push('listening');
  if (!hasReading) missingModules.push('reading');
  if (!hasWriting) missingModules.push('writing');
  if (!hasSpeaking) missingModules.push('speaking');

  const allFinalized = Boolean(
    g.isFinalized &&
    hasListening &&
    hasReading &&
    hasWriting &&
    hasSpeaking &&
    typeof g.finalOverallBand === 'number'
  );

  return {
    isFinalized: Boolean(g.isFinalized),
    allFinalized,
    hasListening,
    listeningBand: g.listeningScore?.band,
    hasReading,
    readingBand: g.readingScore?.band,
    hasWriting,
    writingBand: g.writingAdminEvaluation?.overallBand ?? g.writingAiEvaluation?.overallBand,
    hasSpeaking,
    speakingBand: g.speakingEvaluation?.overallBand,
    overallBand: g.finalOverallBand,
    cefrLevel: g.cefrLevel,
    missingModules
  };
}

/**
 * Multiple-choice with 2+ answers: ONE widget, but one mark per accepted
 * letter — the question numbers match the answer count (e.g. one stem for
 * Questions 11–12 with two correct letters; each letter counts separately).
 *
 * Legacy combined rows ("B, D" in a single acceptedAnswers entry) are split
 * here, so old exams migrate automatically wherever these helpers are used
 * (scoring, review, numbering, navigation).
 */
export function getMultiLetters(q: Pick<Question, 'type' | 'acceptedAnswers'>): string[] {
  if (q.type !== 'multiple_choice_multi') return [];
  const out: string[] = [];
  const push = (t: string) => {
    const m = t.match(/^[A-Z]/);
    const letter = m ? m[0] : t;
    if (letter && !out.includes(letter)) out.push(letter);
  };
  for (const row of q.acceptedAnswers || []) {
    const text = String(row).trim().toUpperCase();
    if (!text) continue;
    // Split on common separators: comma, slash, semicolon, &, +, |.
    const parts = text.split(/[,;/&+|]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      parts.forEach(push);
      continue;
    }
    // Bare whitespace separation counts only when EVERY token is a single
    // letter ("B D" → B, D — but "B lapwing" stays one key → B).
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every(w => /^[A-Z]$/.test(w))) {
      words.forEach(push);
      continue;
    }
    push(text);
  }
  return out;
}

/** How many question numbers / marks one record consumes (multi: per letter). */
export function questionSlots(q: Pick<Question, 'type' | 'acceptedAnswers'>): number {
  if (q.type !== 'multiple_choice_multi') return 1;
  return Math.max(getMultiLetters(q).length, 1);
}

/**
 * Total question NUMBERS covered by a list (a 2-letter multi counts 2).
 * Use for EVERY displayed total — record counts under-report exams with
 * multi-letter records (e.g. 38 records covering Q1–40).
 */
export function countQuestionSlots(qs: { type: string; acceptedAnswers: string[] }[]): number {
  return (qs || []).reduce((n, q) => n + questionSlots(q as Pick<Question, 'type' | 'acceptedAnswers'>), 0);
}

/** Last question number covered by a record starting at q.number. */
export function spanEndNumber(q: Pick<Question, 'number'> & Pick<Question, 'type' | 'acceptedAnswers'>): number {
  return (q.number || 0) + questionSlots(q) - 1;
}

/** Normalize a multi record to one accepted letter per row (exam-save migration). */
export function normalizeMultiKeys<T extends Pick<Question, 'type' | 'acceptedAnswers' | 'maxSelections'>>(q: T): T {
  if (q.type !== 'multiple_choice_multi') return q;
  const letters = getMultiLetters(q as Pick<Question, 'type' | 'acceptedAnswers'>);
  return {
    ...q,
    acceptedAnswers: letters.length > 0 ? letters : (q.acceptedAnswers || []),
    maxSelections: typeof q.maxSelections === 'number' && q.maxSelections > 0
      ? q.maxSelections
      : Math.max(letters.length, 2)
  };
}

/** Extract picked letters from a stored multi CSV ("B, D") — extras kept, scoring ignores them. */
export function parsePickedLetters(candidateAnswer: string | undefined): string[] {
  if (!candidateAnswer) return [];
  const out: string[] = [];
  for (const part of candidateAnswer.split(',')) {
    const t = part.trim().toUpperCase();
    if (!t) continue;
    const m = t.match(/^[A-Z]/);
    const letter = m ? m[0] : t;
    if (!out.includes(letter)) out.push(letter);
  }
  return out;
}

/** Marks earned on a multi record: 1 per correct letter, extra picks ignored. */
export function scoreMultiMarks(candidateAnswer: string | undefined, q: Pick<Question, 'type' | 'acceptedAnswers'>): number {
  const letters = getMultiLetters(q);
  if (letters.length === 0) return 0;
  const picked = new Set(parsePickedLetters(candidateAnswer));
  return letters.filter(l => picked.has(l)).length;
}

/**
 * Marks for any question record. Record-level admin overrides still apply to
 * the whole record (override true = full marks, false = zero).
 */
export function scoreQuestionMarks(
  q: Pick<Question, 'type' | 'acceptedAnswers'>,
  candidateAnswer: string | undefined,
  override?: boolean
): { earned: number; total: number } {
  const total = questionSlots(q);
  if (override !== undefined) return { earned: override ? total : 0, total };
  if (q.type === 'multiple_choice_multi') {
    return { earned: scoreMultiMarks(candidateAnswer, q), total };
  }
  return { earned: checkAnswerMatch(candidateAnswer, (q as Question).acceptedAnswers || []) ? 1 : 0, total };
}

/**
 * Per-number breakdown of a multi record for review screens: each consumed
 * number maps to its own correct letter and whether the candidate picked it.
 */
export function multiSlotResults(
  q: Pick<Question, 'number' | 'type' | 'acceptedAnswers'>,
  candidateAnswer: string | undefined,
  override?: boolean
): { number: number; correctLetter: string; pickedLetter: string | null; ok: boolean }[] {
  const letters = getMultiLetters(q);
  const picked = new Set(parsePickedLetters(candidateAnswer));
  const start = q.number || 0;
  return letters.map((letter, i) => {
    const has = picked.has(letter);
    const ok = override !== undefined ? override : has;
    return { number: start + i, correctLetter: letter, pickedLetter: has ? letter : null, ok };
  });
}

/**
 * Expand question records into navigation entries — one per question number,
 * so a 2-letter multi starting at 11 yields dots 11 and 12 (same record id).
 */
export function expandNavSlots<T extends Pick<Question, 'id' | 'number' | 'type' | 'acceptedAnswers'>>(
  questions: T[]
): { id: string; number: number }[] {
  const out: { id: string; number: number }[] = [];
  for (const q of questions) {
    const slots = questionSlots(q);
    for (let i = 0; i < slots; i++) out.push({ id: q.id, number: (q.number || 0) + i });
  }
  return out;
}

/**
 * Merge consecutive multiple_choice_multi records sharing ONE stem (same
 * prompt + options) into a single record covering the number range: one
 * widget, one mark per letter. Importers sometimes emit one record per
 * letter (e.g. two "Which TWO..." records for Q15–16); the paper shows one
 * shared stem, so they must merge. Non-adjacent same-stem records are left
 * alone (separate groups). Accepts Question, draft, and server-normalizer
 * shapes alike (fields read defensively).
 */
export function mergeConsecutiveMultis<T extends object>(questions: T[]): T[] {
  const out: T[] = [];
  const get = (q: T, k: string): unknown => (q as Record<string, unknown>)[k];
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const keyOf = (q: T) => `${get(q, 'prompt') ?? ''}\n${JSON.stringify(strArr(get(q, 'options')))}`;
  const lettersOf = (q: T): string[] => {
    const letters: string[] = [];
    // Split legacy combined rows ("B, D") via the shared helper, one record
    // at a time (getMultiLetters only handles multi-typed records).
    for (const row of strArr(get(q, 'acceptedAnswers'))) {
      for (const l of getMultiLetters({ type: 'multiple_choice_multi', acceptedAnswers: [row] })) {
        if (l && !letters.includes(l)) letters.push(l);
      }
    }
    return letters;
  };
  const maxOf = (q: T): number | null => {
    const v = get(q, 'maxSelections');
    return typeof v === 'number' && v > 0 ? v : null;
  };
  const instrOf = (q: T): string => {
    const v = get(q, 'instructionLine');
    return typeof v === 'string' ? v : '';
  };
  let i = 0;
  while (i < questions.length) {
    const q = questions[i];
    if (get(q, 'type') !== 'multiple_choice_multi') { out.push(q); i++; continue; }
    let j = i;
    while (
      j + 1 < questions.length &&
      get(questions[j + 1], 'type') === 'multiple_choice_multi' &&
      keyOf(questions[j + 1]) === keyOf(q)
    ) j++;
    if (j === i) { out.push(q); i++; continue; }
    const run = questions.slice(i, j + 1);
    const letters: string[] = [];
    run.forEach(r => lettersOf(r).forEach(l => { if (!letters.includes(l)) letters.push(l); }));
    const maxes = run.map(maxOf).filter((v): v is number => v !== null);
    const sameMax = maxes.length === run.length && maxes.every(v => v === maxes[0]);
    const instruction = run.find(r => instrOf(r).trim()) !== undefined
      ? (run.find(r => instrOf(r).trim()) as Record<string, unknown>).instructionLine
      : get(run[0], 'instructionLine');
    out.push({
      ...run[0],
      acceptedAnswers: letters.length > 0 ? letters : strArr(get(run[0], 'acceptedAnswers')),
      maxSelections: sameMax ? (maxes[0] as number) : Math.max(letters.length, 2),
      instructionLine: instruction
    } as T);
    i = j + 1;
  }
  return out;
}

/**
 * Renumber records so a multi-letter record consumes one question number
 * per letter (Q15–16 style): the next record starts after the previous
 * record's last covered number. Without this, records after a merged multi
 * overlap its range. Accepts a start number for module-global continuity.
 */
export function renumberQuestionsWithSlots<T extends Pick<Question, 'number' | 'type' | 'acceptedAnswers'>>(
  questions: T[],
  startAt = 1
): T[] {
  let n = startAt;
  return questions.map(q => {
    const out = { ...q, number: n };
    n = spanEndNumber(out) + 1;
    return out;
  });
}
