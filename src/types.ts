/** Maximum number of exam forms allowed in the catalog at one time. */
export const MAX_EXAMS = 20;

/** Maximum registrations accepted for a single exam date. */
export const MAX_REGISTRATIONS_PER_DATE = 125;

export type ExamSection = 'listening' | 'reading' | 'writing' | 'completed' | 'review';

export type QuestionType =
  | 'multiple_choice'
  | 'multiple_choice_multi'
  | 'true_false_not_given'
  | 'yes_no_not_given'
  | 'matching_headings'
  | 'matching_information'
  | 'matching_features'
  | 'matching_sentence_endings'
  | 'fill_in_the_blank'
  | 'sentence_completion'
  | 'summary_completion'
  | 'short_answer'
  | 'diagram_label'
  | 'map_label'
  | 'table_completion'
  | 'flowchart_completion'
  | 'flowchart_completion_text'
  | 'image_map';

/** Input family driving student rendering + wizard field editors. */
export type QuestionInputFamily = 'single_choice' | 'multi_choice' | 'tfng' | 'ynng' | 'text' | 'diagram';

export interface QuestionTypeMeta {
  type: QuestionType;
  label: string;
  group: 'Choice' | 'Matching' | 'Completion' | 'Labelling' | 'Judgement';
  description: string;
  family: QuestionInputFamily;
  modules: ('listening' | 'reading')[];
}

export const QUESTION_TYPE_META: QuestionTypeMeta[] = [
  { type: 'multiple_choice', label: 'Multiple Choice (1 answer)', group: 'Choice', description: 'Choose ONE letter A–D.', family: 'single_choice', modules: ['listening', 'reading'] },
  { type: 'multiple_choice_multi', label: 'Multiple Choice (2+ answers)', group: 'Choice', description: 'Choose TWO or more letters (e.g. Questions 21–22); each correct letter earns its own question number.', family: 'multi_choice', modules: ['listening', 'reading'] },
  { type: 'true_false_not_given', label: 'TRUE / FALSE / NOT GIVEN', group: 'Judgement', description: 'Factual claims about the passage.', family: 'tfng', modules: ['reading'] },
  { type: 'yes_no_not_given', label: 'YES / NO / NOT GIVEN', group: 'Judgement', description: "Writer's views or claims.", family: 'ynng', modules: ['reading'] },
  { type: 'matching_headings', label: 'Matching Headings', group: 'Matching', description: 'Match each paragraph/section to a heading (list i, ii, iii…).', family: 'single_choice', modules: ['reading'] },
  { type: 'matching_information', label: 'Matching Information', group: 'Matching', description: 'Match statements to paragraphs (A–G).', family: 'single_choice', modules: ['reading'] },
  { type: 'matching_features', label: 'Matching Features', group: 'Matching', description: 'Match options to people, dates, places, theories…', family: 'single_choice', modules: ['listening', 'reading'] },
  { type: 'matching_sentence_endings', label: 'Matching Sentence Endings', group: 'Matching', description: 'Complete each stem with the correct ending.', family: 'single_choice', modules: ['reading'] },
  { type: 'fill_in_the_blank', label: 'Form / Note / Table Completion', group: 'Completion', description: 'Complete a form, note, table or flow-chart (≤3 words).', family: 'text', modules: ['listening', 'reading'] },
  { type: 'sentence_completion', label: 'Sentence Completion', group: 'Completion', description: 'Complete sentences with words from the text.', family: 'text', modules: ['listening', 'reading'] },
  { type: 'summary_completion', label: 'Summary Completion', group: 'Completion', description: 'Complete a summary with or without a word bank.', family: 'text', modules: ['reading'] },
  { type: 'short_answer', label: 'Short-Answer Questions', group: 'Completion', description: 'Answer with ≤3 words / a number.', family: 'text', modules: ['listening', 'reading'] },
  { type: 'diagram_label', label: 'Diagram Labelling (type answer)', group: 'Labelling', description: 'Label parts of a diagram by typing.', family: 'diagram', modules: ['listening'] },
  { type: 'map_label', label: 'Plan / Map Labelling (type answer)', group: 'Labelling', description: 'Label locations by typing.', family: 'diagram', modules: ['listening'] },
  { type: 'table_completion', label: 'Table Completion', group: 'Completion', description: 'Type answers directly into table cells. Consecutive questions sharing one table render as a single table.', family: 'text', modules: ['listening', 'reading'] },
  { type: 'flowchart_completion', label: 'Flow-Chart Completion (drag)', group: 'Matching', description: 'Drag steps from a shared bank into the flow boxes.', family: 'single_choice', modules: ['listening', 'reading'] },
  { type: 'flowchart_completion_text', label: 'Flow-Chart Completion (type answer)', group: 'Completion', description: 'Type answers directly into flow-chart boxes. Consecutive questions sharing one chart render as a single vertical flow.', family: 'text', modules: ['listening', 'reading'] },
  { type: 'image_map', label: 'Plan / Map on Image (drag)', group: 'Labelling', description: 'Show the uploaded plan clean; candidates drag labels into the numbered list beside it.', family: 'single_choice', modules: ['listening', 'reading'] },
];

export function getQuestionFamily(type: QuestionType): QuestionInputFamily {
  return QUESTION_TYPE_META.find(m => m.type === type)?.family || 'text';
}

export function getQuestionLabel(type: QuestionType): string {
  return QUESTION_TYPE_META.find(m => m.type === type)?.label || type;
}

/** Test-centre wall-clock zone for exam scheduling (Baku, UTC+4, no DST). */
export const EXAM_TIMEZONE_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * Scheduled start of an exam as a UTC timestamp (ms). The admin enters
 * examDate + examTime as Baku wall time (plain <input type="time"> carries
 * no zone), so it is interpreted as Asia/Baku HERE — in one shared place.
 * (Previously `new Date(y, m, d, hh, mm)` used the runtime's local zone:
 * correct on Baku browsers but 4 hours late on the UTC server, so exams
 * opened 4 hours after the announced time and early candidates got
 * "exam is not open".) Null when the exam has no date — such an exam is
 * open whenever it is active.
 */
export function getExamStartMs(exam: { examDate?: string; examTime?: string } | null | undefined): number | null {
  if (!exam?.examDate) return null;
  const m = exam.examDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const t = (exam.examTime || '00:00').match(/^(\d{1,2}):(\d{2})/);
  const hh = t ? Math.min(23, parseInt(t[1], 10)) : 0;
  const mm = t ? Math.min(59, parseInt(t[2], 10)) : 0;
  return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), hh, mm, 0, 0) - EXAM_TIMEZONE_OFFSET_MS;
}

/** Start of a numbered time slot (1 = examTime, 2 = examTime2) as UTC ms. */
export function getExamSlotStartMs(
  exam: { examDate?: string; examTime?: string; examTime2?: string } | null | undefined,
  slot: 1 | 2
): number | null {
  if (!exam) return null;
  const time = slot === 2 ? exam.examTime2 : exam.examTime;
  if (slot === 2 && !time) return null;
  return getExamStartMs({ examDate: exam.examDate, examTime: time });
}

/** Rough full-exam length in seconds (all modules + review + transitions). */
export function estimateExamDurationSeconds(exam: {
  listening?: { sections?: Array<{ audioDurationSeconds?: number }> };
  reading?: { durationMinutes?: number };
  writing?: { durationMinutes?: number };
} | null | undefined): number {
  const listening = (exam?.listening?.sections || []).reduce((n, s) => n + (s.audioDurationSeconds || 60), 0) + 120;
  const reading = (exam?.reading?.durationMinutes || 60) * 60;
  const writing = (exam?.writing?.durationMinutes || 60) * 60;
  return listening + reading + writing + 30 * 60;
}

/**
 * When a two-slot exam's paper may be shown to candidates (UTC ms): second
 * slot start + estimated duration. Null when the exam has no second time —
 * single-slot exams release immediately (legacy behavior).
 */
export function getExamResultsReleaseMs(exam: {
  examDate?: string; examTime?: string; examTime2?: string;
  listening?: { sections?: Array<{ audioDurationSeconds?: number }> };
  reading?: { durationMinutes?: number };
  writing?: { durationMinutes?: number };
} | null | undefined): number | null {
  if (!exam?.examDate || !exam.examTime2) return null;
  const slot2 = getExamSlotStartMs(exam, 2);
  if (slot2 === null) return null;
  return slot2 + estimateExamDurationSeconds(exam) * 1000;
}

/**
 * May candidates see this exam's paper (review answers/scores/TRF)?
 * True for single-slot exams, released exams, or once the auto-release
 * moment passes. Otherwise slot-1 finishers must wait for slot 2 to end.
 */
export function isExamPaperReleased(
  exam: { examDate?: string; examTime?: string; examTime2?: string; resultsReleased?: boolean;
    listening?: { sections?: Array<{ audioDurationSeconds?: number }> };
    reading?: { durationMinutes?: number };
    writing?: { durationMinutes?: number } } | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!exam) return true;
  if (exam.resultsReleased) return true;
  const releaseMs = getExamResultsReleaseMs(exam);
  if (releaseMs === null) return true;
  return nowMs >= releaseMs;
}

export interface TableDef {
  /** Optional centered table title (e.g. "Research findings"). */
  title?: string;
  /** Column headers (excluding any row-label column). */
  headers: string[];
  /** Body rows; cells are plain text, `___` marks a gap (row-major order). */
  rows: string[][];
}

export interface FlowDef {
  /** Optional centered chart title (e.g. "Honey production"). */
  title?: string;
  /** Flow boxes top-to-bottom; `___` marks a gap (in order). A line holding
   *  only `||` is a layout marker (not a box): the boxes below it render as
   *  2-column branch rows (e.g. Q9/Q10 side-by-side). */
  boxes: string[];
}

export interface Question {
  id: string;
  number: number; // 1 to 40
  type: QuestionType;
  prompt: string;
  /** Authored instruction line, e.g. "Write NO MORE THAN TWO WORDS AND/OR A NUMBER." */
  instructionLine?: string;
  /** Max words accepted for text answers (e.g. 2). Inputs truncate beyond this. */
  wordLimit?: number;
  /** Max selectable options for multiple_choice_multi (e.g. 2). */
  maxSelections?: number;
  options?: string[]; // for multiple choice or matching
  acceptedAnswers: string[]; // e.g. ["apple", "an apple"]
  /** Table layout (table_completion). Layout is taken from the FIRST question of a consecutive group. */
  tableDef?: TableDef;
  /** Flow-chart layout (flowchart_completion_text). Layout is taken from the FIRST question of a consecutive group. */
  flowDef?: FlowDef;
  /** Uploaded plan/diagram image (image_map). Taken from the FIRST question of a group. */
  imageUrl?: string;
  /** Position of this question's gap overlaid on the group image (percent 0–100). */
  mapPos?: { x: number; y: number };
  diagramConfig?: {
    diagramType: 'map' | 'flowchart' | 'process';
    title: string;
    labels: {
      id: string;
      labelNumber: number;
      x: number; // percentage from left (0 - 100)
      y: number; // percentage from top (0 - 100)
      placeholder: string;
    }[];
  };
  explanation?: string;
}

export type ListeningQuestion = Question;
export type ReadingQuestion = Question;

export interface ListeningSection {
  id: string;
  sectionNumber: number; // 1, 2, 3, 4
  title: string;
  context: string;
  audioDurationSeconds: number;
  audioUrl?: string;
  audioFileName?: string;
  audioSourceType?: 'upload' | 'script' | 'record' | 'youtube';
  audioScriptSnippet?: string;
  questions: Question[];
}

export interface ReadingPassage {
  id: string;
  passageNumber: number; // 1, 2, 3
  title: string;
  subtitle?: string;
  text: string;
  questions: Question[];
}

/** Built-in Task 1 visual types (single chart or each item of a multi-chart). */
export type Task1ChartType = 'bar_chart' | 'line_graph' | 'pie_chart' | 'process_diagram' | 'map';

/** One dataset in a Task 1 bar/line chart (pie charts use a single series). */
export interface Task1ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

/** One step of a process diagram, or one marked place on a map. */
export interface Task1ChartStage {
  label: string;
  detail?: string;
}

/**
 * Structured parameters driving the built-in Task 1 vector chart, authored
 * by the admin as JSON in the Exam Wizard. The renderer picks the visual
 * from WritingTask1.chartType and reads:
 * - bar_chart / line_graph: labels[] + series[] ({ name, values, color? }), unit?
 * - pie_chart: labels[] + values[] (or a single series), unit?
 * - process_diagram / map: stages[] (string or { label, detail? })
 * Absent/invalid data renders a neutral placeholder — never invented numbers.
 */
export interface Task1ChartData {
  /** Per-visual type override for multi-chart tasks; falls back to the
   *  task-level chartType when absent. */
  chartType?: Task1ChartType;
  labels?: string[];
  series?: Task1ChartSeries[];
  values?: number[];
  unit?: string;
  stages?: Array<string | Task1ChartStage>;
  title?: string;
}

export interface WritingTask1 {
  id: string;
  title: string;
  prompt: string;
  chartType: Task1ChartType;
  chartDescription: string;
  chartDataSummary: string;
  /** Optional structured chart parameters (JSON): either ONE chart object
   *  or an ARRAY of them for multi-visual tasks (e.g. two pie charts, or a
   *  bar chart plus a table description). Each array item may carry its own
   *  chartType (mixed visuals); items without one use the task's chartType.
   *  Without it the built-in chart area shows a neutral placeholder instead
   *  of chart graphics. */
  chartData?: Task1ChartData | Task1ChartData[];
  minWords: number;
  imageUrl?: string;
  imageFileName?: string;
  visualMode?: 'upload' | 'builtin';
}

export interface WritingTask2 {
  id: string;
  title: string;
  prompt: string;
  essayType: 'agree_disagree' | 'discuss_both_views' | 'problem_solution' | 'advantages_disadvantages';
  minWords: number;
}

export interface Exam {
  id: string;
  title: string;
  code: string;
  type?: 'academic' | 'general_training';
  description?: string;
  centreNumber?: string;
  /** Exam day (YYYY-MM-DD). Shown at registration; caps entries at 125/date. */
  examDate?: string;
  /** Exam start time (HH:MM, local). The active exam opens automatically when reached. */
  examTime?: string;
  /** Optional second start time (HH:MM, Baku wall time) on the SAME day:
   *  the same paper runs twice; candidates pick slot 1 or 2 at registration.
   *  Absent = single session (legacy behavior, results visible at once). */
  examTime2?: string;
  /** Manual results release: when true, candidates may see their paper even
   *  before the automatic post-slot-2 release moment. */
  resultsReleased?: boolean;
  listening: {
    title: string;
    audioUploadMode?: 'single' | 'separate';
    audioUrl?: string;
    audioFileName?: string;
    sections: ListeningSection[];
  };
  reading: {
    title: string;
    durationMinutes: number;
    passages: ReadingPassage[];
  };
  writing: {
    title: string;
    durationMinutes: number;
    task1: WritingTask1;
    task2: WritingTask2;
  };
  speaking?: {
    title?: string;
    part1?: { topics: string[] };
    part2?: { cueCardTopic: string };
    part3?: { discussionPrompts: string[] };
  };
}

export interface TextHighlight {
  id: string;
  /** Owner block id: reading passage id, or listening section id. */
  passageId: string;
  text: string;
  color: 'yellow' | 'green' | 'pink';
  timestamp: string;
  paragraphIndex?: number;
  startOffset?: number;
  endOffset?: number;
  /** Stable highlightable-unit key (listening): `${ownerId}|${unit}`. */
  unitKey?: string;
  /** Optional candidate note attached via right-click "Add note". */
  note?: string;
}

export interface SystemSettings {
  examPriceAzn?: number;
  m10PhoneNumber?: string;
  m10AccountHolder?: string;
  activeExamId?: string | null; // e.g. "exam-ielts-academic-101", or null/empty if no exam is active
  isConfigured?: boolean;
  updatedAt?: string;
  updatedBy?: string;
  // Proctored exam scheduling
  examAccessMode?: 'closed' | 'scheduled' | 'open'; // closed = blocked, scheduled = countdown, open = live
  examScheduledAt?: string | null; // ISO datetime for scheduled auto-open
  examOpenedAt?: string | null;    // ISO datetime when exam was opened (manual or auto)
  // Data retention bookkeeping (180-day rolling window)
  retentionLastRun?: string; // ISO datetime of last retention purge
  retentionLastDeleted?: { sessions: number; registrations: number; files: number };
}

export interface StickyNoteComment {
  id: string;
  task: 1 | 2;
  selectedText: string;
  note: string;
  author: string;
  createdAt?: string;
  timestamp?: string;
}

export type WritingComment = StickyNoteComment;

export interface WritingError {
  task: 1 | 2;
  snippet: string;
  suggestion: string;
  errorType: 'grammar' | 'spelling' | 'punctuation' | 'word_choice';
  explanation: string;
}

export interface WritingBandScores {
  ta_tr: number; // Task Achievement (T1) / Task Response (T2)
  cc: number;    // Coherence and Cohesion
  lr: number;    // Lexical Resource
  gra: number;   // Grammatical Range and Accuracy
  overall: number;
}

export interface WritingAiEvaluation {
  task1Band: WritingBandScores;
  task2Band: WritingBandScores;
  overallBand: number;
  errors: WritingError[];
  flags?: any[];
  feedbackSummary: string;
  examinerFeedback?: string;
  criteriaFeedback: {
    ta_tr: string;
    cc: string;
    lr: string;
    gra: string;
  };
  evaluatedAt: string;
}

export interface WritingAdminEvaluation {
  task1Band: WritingBandScores;
  task2Band: WritingBandScores;
  overallBand: number;
  comments: StickyNoteComment[];
  adminFeedback?: string;
  examinerFeedback?: string;
  isFinalized: boolean;
  finalizedAt?: string;
  finalizedBy?: string;
}

export interface SpeakingEvaluation {
  fluency: number;
  lexical: number;
  grammar: number;
  pronunciation: number;
  overallBand: number;
  examinerNotes: string;
  evaluatedAt?: string;
  conductedAt?: string;
  /** Voice memo of the interview (short-lived: auto-deleted 7 days after recording). */
  audioUrl?: string;
  /** ISO datetime the voice memo was recorded. */
  audioRecordedAt?: string;
  /** Examiner-typed questions/prompts per interview part (free input). */
  partQuestions?: {
    part1?: string;
    part2?: string;
    part3?: string;
  };
}

export interface CandidateProfileData {
  candidateName: string;
  candidateId?: string;
  /** Time slot on two-slot exam days (1 = first start, 2 = second). */
  examSlot?: 1 | 2;
  candidatePhotoUrl?: string;
  dateOfBirth?: string;
  gender?: 'M' | 'F' | 'Other';
  countryOfOrigin?: string;
  firstLanguage?: string;
  idDocumentNumber?: string;
  centreNumber?: string;
  schemeCode?: 'Academic Standard' | 'General Training';
  examId?: string;
}

export interface CandidateSession {
  candidateId: string;
  /** Registration this session was issued from (e.g. "REG-123456"). Linked, never identical. */
  registrationId?: string;
  candidateName: string;
  candidatePhotoUrl?: string;
  dateOfBirth?: string;
  gender?: 'M' | 'F' | 'Other';
  countryOfOrigin?: string;
  firstLanguage?: string;
  idDocumentNumber?: string;
  centreNumber?: string;
  schemeCode?: 'Academic Standard' | 'General Training';
  examId: string;
  examTitle: string;
  /** Time slot on two-slot exam days (1 = first start, 2 = second). */
  examSlot?: 1 | 2;
  createdAt: string;
  status: 'registered' | 'in_progress' | 'hard_locked' | 'completed' | 'finalized';
  currentSection: ExamSection;
  lockStatus: {
    violations: number;
    isLocked: boolean;
    lockReason?: string;
    lockHistory: { timestamp: string; reason: string }[];
  };
  listeningState: {
    bufferedPercent: number;
    audioPlayed: boolean;
    reviewTimerRemaining: number;
    answers: Record<string, string>;
    highlights: TextHighlight[];
    completed: boolean;
    audioPositionSeconds?: number;
  };
  readingState: {
    timeRemainingSeconds: number;
    answers: Record<string, string>;
    highlights: TextHighlight[];
    completed: boolean;
  };
  writingState: {
    timeRemainingSeconds: number;
    task1Response: string;
    task2Response: string;
    completed: boolean;
  };
  grading: {
    listeningScore?: {
      raw: number;
      band: number;
      total: number;
      overrides?: Record<string, boolean>; // questionId -> manual override isCorrect
    };
    readingScore?: {
      raw: number;
      band: number;
      total: number;
      overrides?: Record<string, boolean>; // questionId -> manual override isCorrect
    };
    writingAiEvaluation?: WritingAiEvaluation;
    writingAdminEvaluation?: WritingAdminEvaluation;
    speakingEvaluation?: SpeakingEvaluation;
    finalOverallBand?: number;
    cefrLevel?: 'C2' | 'C1' | 'B2' | 'B1' | 'B0';
    isFinalized: boolean;
    finalizedAt?: string;
  };
  trfNumber: string;
  lastSavedAt: string;
}

export interface ExamRegistrationRequest {
  id: string; // e.g. "REG-628104"
  candidateName: string;
  candidatePhotoUrl: string;
  dateOfBirth: string;
  gender: 'M' | 'F' | 'Other';
  countryOfOrigin: string;
  firstLanguage: string;
  idDocumentNumber: string;
  phone: string;
  email: string;
  examId: string;
  examTitle: string;
  /** Exam day copied from the exam at submit time (YYYY-MM-DD). */
  examDate?: string;
  /** Exam start time copied from the exam at submit time (HH:MM, local). */
  examTime?: string;
  /** Chosen time slot on two-slot exam days (1 = first start, 2 = second). */
  examSlot?: 1 | 2;
  schemeCode: 'Academic Standard' | 'General Training';
  centreNumber: string;
  paymentMethod: 'm10';
  m10ReceiptUrl: string; // image / data URL of receipt
  m10TransactionId?: string;
  amountAzn: number; // e.g. 45
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  submittedAt: string;
  reviewedAt?: string;
  approvedCandidateId?: string; // e.g. "IG-772104"
}

export interface AdminAuthResponse {
  success: boolean;
  token?: string;
  username?: string;
  role?: string;
  error?: string;
  message?: string;
  attemptsRemaining?: number;
  locked?: boolean;
  waitSeconds?: number;
}
