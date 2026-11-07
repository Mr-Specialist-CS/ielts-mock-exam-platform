import React, { useRef, useState } from 'react';
import { FileUp, Loader2, AlertCircle, CheckCircle2, X, Trash2 } from 'lucide-react';
import { Question, QuestionType, QUESTION_TYPE_META } from '../../types';
import { autoBuildMissingTableLayouts, splitLayoutGroups, layoutSubGroup } from '../../utils/tableLayout';
import { mergeConsecutiveMultis, renumberQuestionsWithSlots, countQuestionSlots } from '../../utils/ieltsScoring';
import { synthesizeParagraphBanks } from '../../utils/matchingBank';
import { getAdminAuthHeaders } from '../../utils/adminAuth';

export interface ImportDraftQuestion {
  type: string;
  prompt: string;
  instructionLine: string;
  wordLimit: number | null;
  maxSelections: number | null;
  options: string[];
  acceptedAnswers: string[];
  explanation: string;
  /** Table layout (table_completion only). Present on the FIRST question of
   *  each consecutive table group; gaps marked with ___ in row-major order. */
  tableDef?: { title?: string; headers?: string[]; rows?: string[][] };
  /** Flow-chart layout (flowchart_completion_text only). Present on the FIRST
   *  question of each consecutive type-in flow group; ___ marks gaps in order. */
  flowDef?: { title?: string; boxes?: string[] };
}

export interface ImportDraftPassage {
  passageTitle: string;
  passageText: string;
  questions: ImportDraftQuestion[];
  /** Exam passage index this draft block will be inserted into. */
  targetIdx: number;
}

export interface ImportDraft {
  passages: ImportDraftPassage[];
}

export interface ImportInsertItem {
  passageIdx: number;
  title: string;
  text: string;
  questions: Question[];
}

interface DocumentImportModalProps {
  passages: { id: string; passageNumber: number; title: string }[];
  initialPassageIdx: number;
  onClose: () => void;
  onInsert: (items: ImportInsertItem[], mode: 'append' | 'replace') => void;
}

const ALLOWED_TYPES = new Set<string>(QUESTION_TYPE_META.map(m => m.type));
const FRIENDLY_AI_ERROR =
  'AI import is temporarily unavailable. Please try again in a moment or enter the passage and questions manually.';

/** Complete copy-paste prompt: admin pastes this into ChatGPT (or any AI),
 *  appends their document after ---DOCUMENT---, and pastes the ONE returned
 *  JSON back into the textarea. The AI returns ALL passages in a single JSON
 *  object — no CONTINUE steps. If the reply is cut off, pasting the remainder
 *  merges into the same draft (same-title re-paste replaces). */
const AI_PARSER_PROMPT = `You are an IELTS Academic Reading exam parser. I will paste a reading test document after the line ---DOCUMENT---.
The document contains UP TO THREE reading passages (Passage 1, 2, 3 in order), each followed by its own questions.
Extract EVERY passage with its FULL text and EVERY question under the correct passage.

Return ONE single JSON object holding ALL passages at once (no CONTINUE steps, no follow-up replies needed).
Return STRICT JSON only (no markdown fences, no commentary, no extra keys), exactly this shape:
{"passages": [{"passageTitle": "...", "passageText": "Para 1...\\n\\nPara 2...", "questions": [{"type": "sentence_completion", "prompt": "The vault held ___ coins.", "acceptedAnswers": ["40 gold"], "instructionLine": "Choose ONE WORD ONLY from the text.", "wordLimit": 1, "maxSelections": null, "options": [], "explanation": ""}]}, {"passageTitle": "...", "passageText": "...", "questions": [...]}]}

 AUTO-CHOOSE the most appropriate question type per question from EXACTLY this list (never invent other types):
- multiple_choice: ONE answer A-D. Every option starts with its letter ("A ..."). The accepted answer is the LETTER ("B").
- multiple_choice_multi: TWO or more answers for ONE shared stem covering consecutive numbers (e.g. Questions 21–22). Same letter convention; maxSelections = required count; acceptedAnswers is ONE row PER correct letter (["B", "D"] — never a combined "B, D" row; each letter earns its own question number). Emit exactly ONE JSON object per shared stem (ONE record for the whole range, e.g. Questions 15–16 → a single record with acceptedAnswers ["A", "C"]) — never one record per letter.
- true_false_not_given: answer TRUE, FALSE or NOT GIVEN. yes_no_not_given: answer YES, NO or NOT GIVEN.
- matching_headings, matching_information, matching_features, matching_sentence_endings: answered from a bank. Every option carries its FULL text ("E mixed"); the accepted answer is the FULL text.
- fill_in_the_blank, sentence_completion, summary_completion, short_answer: typed answers. wordLimit = max words (1, 2, 3) or null.
- diagram_label, map_label: typed label answers.
- table_completion: typed answers inside table cells (layout in "tableDef", see TABLES rule below). flowchart_completion: drag-from-bank (needs an "options" bank). flowchart_completion_text: typed answers inside flow-chart boxes (layout in "flowDef", see FLOWCHARTS rule below). image_map: drag-from-bank like matching.

TABLES (table_completion — layout is REQUIRED, not optional): when the paper shows a table/form/note with N numbered gaps:
- Emit N consecutive questions with type "table_completion", one per gap in reading order (row-major: top row first, left cell first). acceptedAnswers[i] is the answer for gap i.
- "prompt" may be "" or the row label; the gaps themselves live in "tableDef", NOT in prompt (prompt rule 1 is exempt for table_completion).
- Put the FULL layout ONLY on the FIRST question of the group as "tableDef": {"title": "Table title or omitempty", "headers": ["", "Morning", "Evening"], "rows": [["Monday", "___", "yoga"], ["Tuesday", "reading ___", "___"]]}. Other questions of the group omit "tableDef".
- Mark EACH gap with ___ (2+ underscores, only ___, never ***) inside its cell, in the exact cell position. Several gaps MAY share one cell ("___ to ___"). Gap count inside tableDef MUST equal N (group size).
- "headers" = column headers (first may be "" when the first column holds row labels). "rows" = body rows, cells are plain text. Keep original wording/casing.
- VERBATIM CELLS: copy every cell word-for-word — keep • bullets, keep original line order, keep every line including lines without gaps (e.g. transport details like "shuttle bus"). Never drop, merge, reorder, or paraphrase any line. The table must mirror the paper exactly.
- NOTES (section headers + bullets, e.g. hotel notes with Time / Temperature / Transport / Facilities) are table_completion too: each bullet line is a row; section headers and the Example line are gap-less rows (plain text, no question — the Example answer stays as plain text, never a question).
- Example group of 3: {"type": "table_completion", "prompt": "", "instructionLine": "Complete the table below. Write NO MORE THAN TWO WORDS AND/OR A NUMBER.", "wordLimit": 2, "maxSelections": null, "options": [], "acceptedAnswers": ["9 am"], "explanation": "", "tableDef": {"title": "Library hours", "headers": ["", "Opens", "Closes"], "rows": [["Monday", "___", "6 pm"], ["Tuesday", "9 am", "___"]]}} then {"type": "table_completion", "prompt": "", "instructionLine": "<same>", "wordLimit": 2, "maxSelections": null, "options": [], "acceptedAnswers": ["7 pm"], "explanation": ""} then a third with acceptedAnswers ["8 pm"].

FLOWCHARTS (auto-split by word bank): a flow-chart/process with a visible option bank (A–G choices, word list) becomes flowchart_completion WITH that bank copied VERBATIM into "options" on EVERY question of the group. A flow-chart with NO bank (answers come from the passage, e.g. numbered boxes with underlines like "Gigartina (also called as ___)") becomes N consecutive "flowchart_completion_text" questions, one per gap in top-to-bottom box order:
- "prompt" may be "" or the box label; the gaps themselves live in "flowDef", NOT in prompt (prompt rule 1 is exempt for flowchart_completion_text too).
- Put the FULL layout ONLY on the FIRST question of the group as "flowDef": {"title": "Chart title or omitempty", "boxes": ["Gigartina (also called as ___)", "made into ___"]}. Other questions of the group omit "flowDef".
- Mark EACH gap with ___ inside its box (only ___, never ***), in top-to-bottom order. Several gaps MAY share one box. Gap count inside flowDef MUST equal N (group size).
- BRANCH: when the paper forks into two side-by-side boxes (e.g. Q9 left, Q10 right), put a line holding only "||" before the branched boxes: {"boxes": ["Gigartina (also called as ___)","___","||","___ canned or bottled food","medicine (e.g. ___), toothpaste and others."]}. The "||" line is a layout marker, not a box — it carries no gap and earns no question.
- flowchart_completion_text is ONLY for box-and-arrow diagrams / process flows. NEVER use it for notes, forms, or bullet lists — those are table_completion (see TABLES rule, including the NOTES bullet).

MANDATORY RULES:
1. Every question MUST have a complete non-empty "prompt" with its FULL text — EXCEPT table_completion and flowchart_completion_text, where prompt may be "" (gaps live in tableDef / flowDef). For all other types: the COMPLETE statement for true/false; the FULL stem for choice; the FULL sentence with ___ marking exactly ONE gap for completion. Never leave prompt empty (except table_completion / flowchart_completion_text). Never put question numbers inside prompt.
2. Copy each shared group instruction VERBATIM into "instructionLine" on EVERY question of that group (e.g. all of Q1-5 carry "Choose ONE WORD ONLY from the text for each answer."). Most groups DO show an instruction (e.g. "Choose the correct letter, A, B or C.") — copy it; use "" only when the paper truly shows none above that group.
3. Keep original wording; do not invent questions or passages. At most 40 questions TOTAL. "explanation" is always "".
4. FIDELITY: passageText holds ONLY the reading content, paragraphs in original order separated by a blank line (escape newlines as \\n\\n inside strings, never literal line-breaks inside "..."). Keep paragraph markers at the start of each paragraph ("{A} ...", "{B} ...", "Section A ..."). STRIP running heads/feet, watermarks, page numbers, URLs, facebook/telegram links, "IELTSFever Academic Reading 128", "Academic Reading IELTS Fever" headers. passageTitle is the bare title only ("Build a Medieval Castle").
5. BANKS: when the paper shows an option bank (A-L for the summary, A-G for choose-three, i-x List of Headings), copy the FULL bank VERBATIM into "options" on EVERY question of that group. Choice options start with their key ("A ...", "(iv) ..."); matching-heading options carry full text. maxSelections = required count (e.g. 3 for "Choose three letters"); acceptedAnswers is ONE row per correct letter (["C", "E", "F"]) for multi, or the full option text for matching. Paragraph matching (matching_information, answers are bare letters) carries the EXPLICIT range in "options" on EVERY question (e.g. ["A","B","C","D","E","F","G","H"] for eight paragraphs).
6. IMAGES: decorative illustrations with no numbered question (e.g. the castle cutaway) produce NO question. Only create diagram_label/map_label/image_map when the paper explicitly numbers a diagram question.
7. ESCAPING (critical — unescaped characters break the JSON): inside every "..." string, escape each double-quote character as \\" (backslash + quote), e.g. who would say: \\"I'm doing my research for pure science.\\" Never leave a bare " inside text. Never put literal Enter/Tab line-breaks inside a string; separate paragraphs with \\n\\n only.

---DOCUMENT---
(paste the full test document below this line)`;

function makeId(): string {
  return `r-import-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
}

/** Strip markdown fences / commentary the AI often adds around the JSON. */
function stripFences(t: string): string {
  let s = (t || '').trim();
  // Remove ```json ... ``` wrappers (take the largest fenced block if present).
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1] && fence[1].trim().startsWith('{')) s = fence[1].trim();
  else s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/g, '').trim();
  // Drop leading commentary before the first { and trailing text after the last }.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first > 0 && last > first) s = s.slice(first, last + 1);
  // Common AI mistakes: trailing commas, curly quotes.
  s = s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
  return s;
}

/** Escape bare control characters (literal Enter/Tab inside "..." strings),
 *  the #1 reason ChatGPT JSON fails to parse. Pretty-print newlines BETWEEN
 *  tokens are left alone; only newlines inside a quoted string are escaped. */
function repairBareControls(t: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; }
      else if (ch === '\\') { out += ch; esc = true; }
      else if (ch === '"') { out += ch; inStr = false; }
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += ch;
    } else {
      out += ch;
      if (ch === '"') inStr = true;
    }
  }
  return out;
}

/** True when the `"` at index quoteIdx ends its JSON string value/key.
 *  Looks BEYOND a following `,`/`:` to confirm real JSON structure, so prose
 *  like `"stop", and left` or `listening? "There is...` is NOT mistaken for a
 *  terminator. A terminator is:
 *  - end of input, or
 *  - `,` followed by `"`, `{`, `[`, digit/`-`, true/false/null start (next key/value), or
 *  - `}` / `]` (object/array close), or
 *  - `:` followed by a value start (`"`, `{`, `[`, digit/`-`, true/false/null). */
function isStringTerminator(t: string, quoteIdx: number): boolean {
  let j = quoteIdx + 1;
  while (j < t.length && (t[j] === ' ' || t[j] === '\t' || t[j] === '\n' || t[j] === '\r')) j++;
  const nx: string | undefined = t[j];
  if (nx === undefined) return true;
  if (nx === '}') return true;
  if (nx === ']') return true;
  if (nx === ',') {
    let k = j + 1;
    while (k < t.length && (t[k] === ' ' || t[k] === '\t' || t[k] === '\n' || t[k] === '\r')) k++;
    const nk: string | undefined = t[k];
    if (nk === '"' || nk === '{' || nk === '[' || nk === '}' || nk === ']') return true;
    if (nk === '-' || nk === 't' || nk === 'f' || nk === 'n') return true;
    if (nk !== undefined && nk >= '0' && nk <= '9') return true;
    // Prose: `"stop", and` -> nk is a letter starting prose, NOT a key.
    return false;
  }
  if (nx === ':') {
    let k = j + 1;
    while (k < t.length && (t[k] === ' ' || t[k] === '\t' || t[k] === '\n' || t[k] === '\r')) k++;
    const nk: string | undefined = t[k];
    if (nk === '"' || nk === '{' || nk === '[') return true;
    if (nk === '-' || nk === 't' || nk === 'f' || nk === 'n') return true;
    if (nk !== undefined && nk >= '0' && nk <= '9') return true;
    // Prose colon (`say: hello`) -> not a key terminator.
    return false;
  }
  return false;
}

/** Escape bare dialogue quotes inside "..." strings (the AI often leaves them
 *  unescaped, e.g. who would say: "I'm doing my research..."). Uses
 *  isStringTerminator so prose commas/colons don't end the string early. */
function repairUnescapedQuotes(t: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; }
      else if (ch === '\\') { out += ch; esc = true; }
      else if (ch === '"') {
        if (isStringTerminator(t, i)) {
          out += ch; inStr = false;
        } else {
          out += '\\"';
        }
      }
      else out += ch;
    } else {
      out += ch;
      if (ch === '"') inStr = true;
    }
  }
  return out;
}

/** Tolerant fallback parser: handles bare dialogue quotes AND literal
 *  newlines inside strings in a single pass. Strings end only at a confirmed
 *  structural terminator (see isStringTerminator); everything else is content.
 *  Objects/arrays tolerate trailing commas. Throws on structural failure. */
function parseTolerant(text: string): any {
  let i = 0;
  const skipWs = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  function parseString(): string {
    // text[i] === '"'
    i++; // consume opening
    let s = '';
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        const nx = text[i + 1];
        if (nx === 'n') { s += '\n'; i += 2; }
        else if (nx === 'r') { s += '\r'; i += 2; }
        else if (nx === 't') { s += '\t'; i += 2; }
        else if (nx === '"') { s += '"'; i += 2; }
        else if (nx === '\\') { s += '\\'; i += 2; }
        else if (nx === 'u' && /^[0-9a-fA-F]{4}/.test(text.slice(i + 2, i + 6))) {
          s += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)); i += 6;
        } else if (nx === '\n') { s += '\n'; i += 2; }
        else if (nx !== undefined) { s += nx; i += 2; }
        else { i++; }
      } else if (ch === '"') {
        if (isStringTerminator(text, i)) { i++; return s; }
        s += '"'; i++;
      } else if (ch === '\n') { s += '\n'; i++; }
      else if (ch === '\r') { s += '\r'; i++; }
      else if (ch === '\t') { s += '\t'; i++; }
      else { s += ch; i++; }
    }
    throw new Error('Unterminated string');
  }
  function parseValue(): any {
    skipWs();
    const ch = text[i];
    if (ch === '"') return parseString();
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    const num = text.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
    if (num) { i += num[0].length; return Number(num[0]); }
    throw new Error(`Unexpected token '${ch}' at position ${i}`);
  }
  function parseObject(): any {
    i++; // {
    const obj: Record<string, any> = {};
    skipWs();
    if (text[i] === '}') { i++; return obj; }
    while (true) {
      skipWs();
      if (text[i] !== '"') throw new Error(`Expected string key at position ${i}`);
      const key = parseString();
      skipWs();
      if (text[i] !== ':') throw new Error(`Expected ':' at position ${i}`);
      i++;
      obj[key] = parseValue();
      skipWs();
      if (text[i] === ',') { i++; skipWs(); if (text[i] === '}') { i++; return obj; } continue; }
      if (text[i] === '}') { i++; return obj; }
      throw new Error(`Expected ',' or '}' at position ${i}`);
    }
  }
  function parseArray(): any {
    i++; // [
    const arr: any[] = [];
    skipWs();
    if (text[i] === ']') { i++; return arr; }
    while (true) {
      arr.push(parseValue());
      skipWs();
      if (text[i] === ',') { i++; skipWs(); if (text[i] === ']') { i++; return arr; } continue; }
      if (text[i] === ']') { i++; return arr; }
      throw new Error(`Expected ',' or ']' at position ${i}`);
    }
  }
  skipWs();
  const v = parseValue();
  skipWs();
  return v;
}

/** Try strict parse first, then repaired parses (bare newlines/tabs, then
 *  unescaped dialogue quotes), then a fully tolerant scan. The original error
 *  is rethrown when nothing parses. */
function parseDraftJson(cleanedText: string): any {
  try {
    return JSON.parse(cleanedText);
  } catch (firstErr) {
    const repairedControls = repairBareControls(cleanedText);
    if (repairedControls !== cleanedText) {
      try {
        return JSON.parse(repairedControls);
      } catch { /* fall through to quote repair */ }
    }
    const repairedQuotes = repairBareControls(repairUnescapedQuotes(cleanedText));
    if (repairedQuotes !== cleanedText) {
      try {
        return JSON.parse(repairedQuotes);
      } catch { /* fall through to tolerant parser */ }
    }
    try {
      return parseTolerant(cleanedText);
    } catch {
      try {
        return parseTolerant(repairedControls);
      } catch {
        throw firstErr;
      }
    }
  }
}

/** Build a specific, actionable error message for a JSON.parse failure. */
function describeJsonError(original: string, e: any): string {
  const rawMsg: string = e?.message || 'Invalid JSON.';
  const text = stripFences(original);
  const posMatch = rawMsg.match(/position\s+(\d+)/i);
  const pos = posMatch ? parseInt(posMatch[1], 10) : -1;
  const around = pos >= 0
    ? text.slice(Math.max(0, pos - 60), Math.min(text.length, pos + 60)).replace(/\s+/g, ' ')
    : '';

  // Heuristic: truncated AI output (unbalanced braces/brackets or abrupt ending).
  // Uses terminator-aware string tracking so bare dialogue quotes inside
  // passageText don't corrupt the brace count.
  let openBrace = 0, openBracket = 0, inStr = false, esc = false;
  for (let bi = 0; bi < text.length; bi++) {
    const ch = text[bi];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') {
        if (isStringTerminator(text, bi)) inStr = false;
      }
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') openBrace++;
      else if (ch === '}') openBrace--;
      else if (ch === '[') openBracket++;
      else if (ch === ']') openBracket--;
    }
  }
  const looksTruncated = openBrace > 0 || openBracket > 0 || !/}\s*$/.test(text);
  if (looksTruncated) {
    return `JSON is incomplete (truncated) — ${rawMsg}. The AI cut off mid-output. Ask the AI to "re-output the MISSING passages only as STRICT JSON with the same shape, no markdown, \\n\\n for paragraphs" and paste that remainder — it merges into the same draft (same titles replace, new ones append).${around ? ` Near error: “…${around}…”` : ''}`;
  }
  if (/literal|control character|Bad control/i.test(rawMsg)) {
    return `Invalid JSON — ${rawMsg}. Cause: literal line-breaks inside a "..." string (the passageText must use \\n\\n between paragraphs, not real Enter line-breaks inside quotes).${around ? ` Near: “…${around}…”` : ''} Fix: ask the AI to "re-output the full JSON again as STRICT JSON with \\n escapes, no literal newlines inside strings".`;
  }
  return `Invalid JSON — ${rawMsg}. Expected ONE object with ALL passages: {"passages": [{"passageTitle": "...", "passageText": "Para 1...\\n\\nPara 2...", "questions": [{"type": "...", "prompt": "...", "acceptedAnswers": ["..."]}]}]}. Paste the single AI reply as-is.${around ? ` Near: “…${around}…”` : ''}`;
}

/** Keep only a sane TableDef (title/headers/rows caps); null when empty. */
function sanitizeTableDef(raw: unknown): Question['tableDef'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { title?: unknown; headers?: unknown; rows?: unknown };
  const title = typeof r.title === 'string' ? r.title.slice(0, 200) : undefined;
  const headers = Array.isArray(r.headers)
    ? r.headers.map(String).map(s => s.slice(0, 100)).slice(0, 12)
    : [];
  const rows = Array.isArray(r.rows)
    ? r.rows.slice(0, 30).map(row =>
      (Array.isArray(row) ? row : []).map(String).map(s => s.slice(0, 300)).slice(0, 12)
    )
    : [];
  if (rows.length === 0 || rows.every(row => row.every(c => !c.trim()))) return undefined;
  return { ...(title ? { title } : {}), headers, rows };
}

/** Gaps (___ or … or ***) across a table layout, row-major order. */
function countDraftTableGaps(def?: { rows?: string[][] }): number {
  if (!def?.rows) return 0;
  return def.rows.flat().join('|').split(/_{2,}|…|\*{3,}/).length - 1;
}

/** Keep only a sane FlowDef (title/boxes caps); undefined when empty. */
function sanitizeFlowDef(raw: unknown): Question['flowDef'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { title?: unknown; boxes?: unknown };
  const title = typeof r.title === 'string' ? r.title.slice(0, 200) : undefined;
  const boxes = Array.isArray(r.boxes)
    ? r.boxes.map(String).map(s => s.slice(0, 300)).slice(0, 30)
    : [];
  // A "||" line is a branch marker, not content — ignore it for emptiness.
  const content = boxes.filter(b => b.trim() !== '||');
  if (content.length === 0 || content.every(b => !b.trim())) return undefined;
  return { ...(title ? { title } : {}), boxes };
}

/** Gaps (___ or … or ***) across flow boxes, top-to-bottom. */
function countDraftFlowGaps(def?: { boxes?: string[] }): number {
  if (!def?.boxes) return 0;
  return def.boxes.join('|').split(/_{2,}|…|\*{3,}/).length - 1;
}

function toQuestion(dq: ImportDraftQuestion, idx: number): Question {
  const type: QuestionType = ALLOWED_TYPES.has(dq.type) ? (dq.type as QuestionType) : 'short_answer';
  const family = QUESTION_TYPE_META.find(m => m.type === type)?.family || 'text';
  const q: Question = {
    id: `${makeId()}-${idx}`,
    number: idx + 1,
    type,
    prompt: dq.prompt || '',
    acceptedAnswers: dq.acceptedAnswers && dq.acceptedAnswers.length ? dq.acceptedAnswers : [''],
    explanation: dq.explanation || ''
  };
  if (dq.instructionLine) q.instructionLine = dq.instructionLine;
  if (typeof dq.wordLimit === 'number' && dq.wordLimit > 0) q.wordLimit = dq.wordLimit;
  if (typeof dq.maxSelections === 'number' && dq.maxSelections > 0) q.maxSelections = dq.maxSelections;
  if (family === 'single_choice' || family === 'multi_choice') {
    q.options = dq.options && dq.options.length ? dq.options : [];
  }
  if (type === 'table_completion') {
    const def = sanitizeTableDef((dq as { tableDef?: unknown }).tableDef);
    if (def) q.tableDef = def;
  }
  if (type === 'flowchart_completion_text') {
    const def = sanitizeFlowDef((dq as { flowDef?: unknown }).flowDef);
    if (def) q.flowDef = def;
  }
  return q;
}

/** Layout travels on the FIRST question of each consecutive table group
 *  (renderer + QuestionEditor contract). Promote the first found layout when
 *  the AI spread it across siblings, and drop duplicates from the rest. A
 *  fresh tableDef starts a NEW table, so back-to-back tables keep their own
 *  layouts instead of the second being deleted. */
function consolidateTableGroups(questions: Question[]): Question[] {
  let i = 0;
  while (i < questions.length) {
    if (questions[i].type !== 'table_completion') { i++; continue; }
    let j = i;
    while (j + 1 < questions.length && questions[j + 1].type === 'table_completion') j++;
    for (const sub of splitLayoutGroups(questions.slice(i, j + 1))) {
      const holder = sub.find(q => q.tableDef?.rows?.length);
      // Capture BEFORE clearing: holder is inside sub, so reading its
      // layout after deleting would yield undefined and wipe the table.
      const layout = holder?.tableDef;
      if (layout) {
        sub.forEach(q => { delete q.tableDef; });
        sub[0].tableDef = layout;
      }
    }
    i = j + 1;
  }
  return questions;
}

/** Same first-question contract for type-in flow charts (fresh flowDef
 *  starts a new chart). */
function consolidateFlowGroups(questions: Question[]): Question[] {
  let i = 0;
  while (i < questions.length) {
    if (questions[i].type !== 'flowchart_completion_text') { i++; continue; }
    let j = i;
    while (j + 1 < questions.length && questions[j + 1].type === 'flowchart_completion_text') j++;
    for (const sub of splitLayoutGroups(questions.slice(i, j + 1))) {
      const holder = sub.find(q => q.flowDef?.boxes?.length);
      // Capture BEFORE clearing (holder is inside sub).
      const layout = holder?.flowDef;
      if (layout) {
        sub.forEach(q => { delete q.flowDef; });
        sub[0].flowDef = layout;
      }
    }
    i = j + 1;
  }
  return questions;
}

export const DocumentImportModal: React.FC<DocumentImportModalProps> = ({
  passages,
  initialPassageIdx,
  onClose,
  onInsert
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [source, setSource] = useState<'file' | 'json'>('file');
  const [jsonText, setJsonText] = useState('');
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const ext = f.name.toLowerCase().split('.').pop() || '';
    if (ext === 'json') {
      // JSON file: load locally, no AI needed. Final draft still holds ALL passages.
      const reader = new FileReader();
      reader.onload = () => {
        setJsonText(String(reader.result || ''));
        setSource('json');
        setFile(null);
        setError(null);
      };
      reader.readAsText(f);
      return;
    }
    if (ext !== 'pdf') {
      setError('Unsupported file. Please upload a PDF, or a .json file (it will open in the Paste JSON tab).');
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setError('Document is too large. Please use a file under 15 MB.');
      return;
    }
    setFile(f);
    setError(null);
    setDraft(null);
  };

  const parse = async () => {
    if (!file) {
      setError('Choose a PDF file first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const b64 = btoa(binary);
      const res = await fetch('/api/admin/reading-import-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileBase64: b64 })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.draft) {
        setError(data?.error || FRIENDLY_AI_ERROR);
        return;
      }
      const raw = data.draft as { passages?: ImportDraftPassage[]; passageTitle?: string; passageText?: string; questions?: ImportDraftQuestion[] };
      // Accept multi-passage shape; fall back to legacy single-passage shape.
      const list = Array.isArray(raw.passages) && raw.passages.length
        ? raw.passages
        : [{ passageTitle: raw.passageTitle || '', passageText: raw.passageText || '', questions: raw.questions || [] }];
      setDraft({
        passages: list.slice(0, 3).map((p, i) => ({
          passageTitle: p.passageTitle || '',
          passageText: p.passageText || '',
          questions: p.questions || [],
          targetIdx: Math.min(initialPassageIdx + i, Math.max(passages.length - 1, 0))
        }))
      });
    } catch {
      setError(FRIENDLY_AI_ERROR);
    } finally {
      setLoading(false);
    }
  };

  /** Manual fallback when AI parsing is unavailable: paste the draft JSON
   *  (e.g. produced by an external AI with the prompt below — ONE object with
   *  ALL passages) and load it into the same review flow. If the AI reply was
   *  cut off, paste the remainder afterwards: it merges into the same draft
   *  (same-title re-paste replaces instead of duplicating). */
  const loadJsonDraft = () => {
    setError(null);
    let raw: any;
    const cleanedText = stripFences(jsonText);
    try {
      raw = parseDraftJson(cleanedText);
    } catch (e: any) {
      setError(describeJsonError(jsonText, e));
      return;
    }
    const list = Array.isArray(raw?.passages) && raw.passages.length
      ? raw.passages
      : (raw?.passageText || Array.isArray(raw?.questions)
        ? [{ passageTitle: raw.passageTitle || '', passageText: raw.passageText || '', questions: raw.questions || [] }]
        : []);
    if (list.length === 0) {
      // Empty shape {"passages":[]} means "no passages detected".
      if (Array.isArray(raw?.passages) && raw.passages.length === 0) {
        setError(null);
        setJsonText('');
        setCopyMsg(draft ? `Draft holds ${draft.passages.length}/3 passage(s). Review below, then Insert.` : 'The pasted JSON holds no passages. Paste the single AI reply holding all passages.');
        setTimeout(() => setCopyMsg(null), 8000);
        return;
      }
      setError('No passages found in JSON. Paste the single AI reply as-is: {"passages": [{"passageTitle": "...", "passageText": "...", "questions": [...]}]}.');
      return;
    }
    const cleaned = list.slice(0, 3).map((p: any) => ({
      passageTitle: String(p?.passageTitle || ''),
      passageText: String(p?.passageText || ''),
      questions: (Array.isArray(p?.questions) ? p.questions : []).map((q: any) => ({
        type: String(q?.type || 'short_answer'),
        prompt: String(q?.prompt || ''),
        instructionLine: String(q?.instructionLine || ''),
        wordLimit: typeof q?.wordLimit === 'number' ? q.wordLimit : null,
        maxSelections: typeof q?.maxSelections === 'number' ? q.maxSelections : null,
        options: Array.isArray(q?.options) ? q.options.map(String) : [],
        // Accept "A" or ["A"] or "A, B" spellings from the AI.
        acceptedAnswers: Array.isArray(q?.acceptedAnswers)
          ? q.acceptedAnswers.map(String)
          : (q?.acceptedAnswers != null && String(q.acceptedAnswers).trim() !== ''
            ? [String(q.acceptedAnswers)]
            : []),
        explanation: String(q?.explanation || ''),
        tableDef: sanitizeTableDef(q?.tableDef) || undefined,
        flowDef: sanitizeFlowDef(q?.flowDef) || undefined
      }))
    }));
    // Prompts-only table groups (no tableDef from the AI) get a best-effort
    // layout built from their prompts, so the draft review — and the exam —
    // shows a real table instead of loose single cards.
    cleaned.forEach(p => { autoBuildMissingTableLayouts(p.questions); });
    // Split multi records sharing one stem (one record per letter) merge
    // into a single range record (e.g. Q15–16), as the paper shows one stem.
    cleaned.forEach(p => { p.questions = mergeConsecutiveMultis(p.questions); });
    // Paragraph matching has no printed bank (answers ARE the letters):
    // synthesize the explicit A–H range so the dropdown has options.
    cleaned.forEach(p => { synthesizeParagraphBanks(p.questions, p.passageText); });
    if (!cleaned.some(p => p.passageText.trim() || p.questions.length > 0)) {
      setError('JSON parsed, but it contains no passage text and no questions.');
      return;
    }
    // Merge with any existing draft so the final import contains ALL passages.
    // Same-title re-paste replaces (safe retry); new titles append in order.
    // Extra pasted passages beyond 3 fold their questions into the last draft
    // passage instead of being silently discarded (continuation-paste flow).
    const merged: ImportDraftPassage[] = (draft?.passages || []).map(p => ({ ...p, questions: [...p.questions] }));
    for (const p of cleaned) {
      const titleKey = (p.passageTitle || '').trim().toLowerCase();
      const existingIdx = titleKey
        ? merged.findIndex(m => (m.passageTitle || '').trim().toLowerCase() === titleKey)
        : -1;
      if (existingIdx >= 0) {
        merged[existingIdx] = { ...p, questions: [...p.questions], targetIdx: merged[existingIdx].targetIdx };
        continue;
      }
      if (merged.length < 3) {
        merged.push({ ...p, questions: [...p.questions], targetIdx: 0 });
      } else {
        const last = merged[merged.length - 1];
        last.questions = [...last.questions, ...p.questions];
        if (!last.passageText.trim()) last.passageText = p.passageText;
        if (!last.passageTitle.trim()) last.passageTitle = p.passageTitle;
        if (p.passageText.trim() && last.passageText !== p.passageText) {
          last.passageText = last.passageText ? last.passageText + '\n\n' + p.passageText : p.passageText;
        }
      }
    }
    setDraft({
      passages: merged.map((p, i) => ({
        ...p,
        targetIdx: Math.min(initialPassageIdx + i, Math.max(passages.length - 1, 0))
      }))
    });
    setJsonText('');
  };

  const patchPassage = (pi: number, patch: Partial<ImportDraftPassage>) => {
    if (!draft) return;
    setDraft({ ...draft, passages: draft.passages.map((p, i) => (i === pi ? { ...p, ...patch } : p)) });
  };

  const insert = () => {
    if (!draft) return;
    const items: ImportInsertItem[] = draft.passages.map(dp => ({
      passageIdx: dp.targetIdx,
      title: dp.passageTitle,
      text: dp.passageText,
      questions: consolidateFlowGroups(autoBuildMissingTableLayouts(consolidateTableGroups(renumberQuestionsWithSlots(mergeConsecutiveMultis(dp.questions.map((dq, i) => toQuestion(dq, i)))))))
    }));
    onInsert(items, mode);
    onClose();
  };

  const totalQuestions = draft ? draft.passages.reduce((n, p) => n + countQuestionSlots(p.questions), 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <FileUp className="w-4 h-4 text-orange-600" />
            Import Reading from PDF (up to 3 passages)
          </h4>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed">
          One file with all 3 reading passages + their questions. The file is sent to AI for parsing only and is never saved —
          only the extracted passage titles/texts and questions are added to the exam after you confirm.
          If AI parsing is unavailable, switch to <strong>Paste JSON</strong> below.
        </p>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-bold w-fit">
          <button
            type="button"
            onClick={() => { setSource('file'); setError(null); }}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${source === 'file' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Upload file
          </button>
          <button
            type="button"
            onClick={() => { setSource('json'); setError(null); }}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${source === 'json' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Paste JSON
          </button>
        </div>

        {source === 'json' ? (
          <div className="space-y-2">
            <label className="block text-[10px] text-slate-600 uppercase font-bold">
              Draft JSON — one paste holds all passages <span className="normal-case font-medium text-slate-400">(paste the single AI reply; if it was cut off, paste the remainder afterwards — it merges, draft shows n/3)</span>
            </label>
            <textarea
              rows={7}
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              spellCheck={false}
              placeholder={'{"passages": [{"passageTitle": "...", "passageText": "...", "questions": [{"type": "true_false_not_given", "prompt": "...", "acceptedAnswers": ["TRUE"], "instructionLine": "", "wordLimit": null, "maxSelections": null, "options": [], "explanation": ""}]}]}'}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <details className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-[11px] text-slate-600">
              <summary className="cursor-pointer font-bold text-slate-700 text-xs">Format guide + copyable template</summary>
              <p className="mt-1.5 leading-relaxed">
                No AI key needed: copy the prompt below into ChatGPT (or any AI), paste your document after{' '}
                <code className="font-mono bg-white px-1 border rounded">---DOCUMENT---</code>. The AI replies with ONE JSON
                holding ALL passages — paste that single reply into the textarea above and click{' '}
                <code className="font-mono bg-white px-1 border rounded">Load draft</code>. Expected shape:{' '}
                <code className="font-mono bg-white px-1 border rounded">{'{"passages": [all passages]}'}</code> with{' '}
                <code className="font-mono bg-white px-1 border rounded">passageTitle</code>,{' '}
                <code className="font-mono bg-white px-1 border rounded">passageText</code> (blank line = new paragraph, escaped as \n\n),{' '}
                <code className="font-mono bg-white px-1 border rounded">questions[]</code>. Every question needs a complete{' '}
                <code className="font-mono bg-white px-1 border rounded">prompt</code> (full statement/stem — never empty),{' '}
                <code className="font-mono bg-white px-1 border rounded">type</code>, and{' '}
                <code className="font-mono bg-white px-1 border rounded">acceptedAnswers</code>. Repeat the group instruction
                verbatim in <code className="font-mono bg-white px-1 border rounded">instructionLine</code> on each question
                of the group (it renders once as “Questions A–B”). Completion prompts mark one gap with{' '}
                <code className="font-mono bg-white px-1 border rounded">___</code> (table_completion marks gaps inside{' '}
                <code className="font-mono bg-white px-1 border rounded">tableDef.rows</code> instead — layout on the first
                question only, gaps in row-major order, several gaps may share one cell; flowchart_completion_text marks
                gaps inside <code className="font-mono bg-white px-1 border rounded">flowDef.boxes</code> — one box per
                line top-to-bottom, no bank); matching options carry full text
                (e.g. “E mixed”), choice options start with their letter (“A …”). If the reply is cut off, paste the
                remainder afterwards — it merges into the same draft.
              </p>
              <pre className="mt-1.5 p-2 bg-slate-900 text-emerald-100 rounded-lg overflow-x-auto font-mono text-[10px] leading-relaxed">{`{"passages": [{"passageTitle": "...",
"passageText": "Para 1...\\n\\nPara 2...",
"questions": [
 {"type": "sentence_completion",
  "prompt": "The vault held _______ coins.",
  "acceptedAnswers": ["40 gold"],
  "instructionLine": "Choose ONE WORD ONLY from the text.",
  "wordLimit": 1, "options": []},
 {"type": "true_false_not_given",
  "prompt": "Full statement text here.",
  "acceptedAnswers": ["TRUE"]},
 {"type": "multiple_choice",
  "prompt": "Full stem text here?",
  "options": ["A first", "B second"],
  "acceptedAnswers": ["B"]}
]}]}`}</pre>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard?.writeText(AI_PARSER_PROMPT);
                    setCopyMsg('Prompt copied — paste it into ChatGPT (or any AI) with your document. The AI replies with ONE JSON holding all passages: paste it above → Load draft.');
                  } catch {
                    setJsonText(AI_PARSER_PROMPT);
                    setCopyMsg('Clipboard blocked — the prompt was placed in the textarea above instead. Copy it manually.');
                  }
                  setTimeout(() => setCopyMsg(null), 8000);
                }}
                className="mt-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:border-orange-400 rounded-lg text-[11px] font-semibold text-slate-700 cursor-pointer transition"
              >
                Copy AI prompt (for ChatGPT)
              </button>
              {copyMsg && (
                <p className="mt-1.5 text-[11px] text-emerald-700 font-medium">{copyMsg}</p>
              )}
            </details>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} className="accent-orange-600" />
                <span className="text-slate-700 font-medium">Append</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-orange-600" />
                <span className="text-slate-700 font-medium">Replace passages</span>
              </label>
              <button
                type="button"
                onClick={loadJsonDraft}
                disabled={!jsonText.trim()}
                className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer transition"
              >
                <span>{draft ? `Merge into draft (${draft.passages.length}/3)` : 'Load draft (0/3)'}</span>
              </button>
            </div>
          </div>
        ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-52 flex-1">
            <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">Document (PDF or JSON)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.json,application/pdf,application/json"
              className="hidden"
              onChange={e => pickFile(e.target.files?.[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer transition truncate"
            >
              {file ? file.name : 'Choose file…'}
            </button>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs mt-4">
            <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} className="accent-orange-600" />
            <span className="text-slate-700 font-medium">Append</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs mt-4">
            <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-orange-600" />
            <span className="text-slate-700 font-medium">Replace passages</span>
          </label>
          <button
            onClick={parse}
            disabled={loading || !file}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer transition mt-4"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{loading ? 'AI parsing…' : 'Parse with AI'}</span>
          </button>
        </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded-xl text-[11px] text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}

        {draft && (
          <div className="space-y-4 border-t border-slate-100 pt-3">
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              <span>Draft ready — {draft.passages.length} passage(s), {totalQuestions} question(s). Review, map targets, then insert.</span>
            </div>
            {draft.passages.map((dp, pi) => (
              <div key={pi} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-orange-700">Draft Passage {pi + 1}</span>
                  <select
                    value={dp.targetIdx}
                    onChange={e => patchPassage(pi, { targetIdx: Number(e.target.value) })}
                    className="ml-auto p-1.5 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    aria-label={`Target exam passage for draft ${pi + 1}`}
                  >
                    {passages.map((p, i) => (
                      <option key={p.id} value={i}>
                        → Passage {p.passageNumber}{p.title ? ` — ${p.title}` : ''}
                      </option>
                    ))}
                  </select>
                  {draft.passages.length > 1 && (
                    <button
                      onClick={() => setDraft({ ...draft, passages: draft.passages.filter((_, j) => j !== pi) })}
                      className="p-1 rounded hover:bg-red-100 cursor-pointer"
                      aria-label={`Drop draft passage ${pi + 1}`}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  )}
                </div>
                <input
                  value={dp.passageTitle}
                  onChange={e => patchPassage(pi, { passageTitle: e.target.value })}
                  placeholder="Passage title"
                  className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <textarea
                  rows={4}
                  value={dp.passageText}
                  onChange={e => patchPassage(pi, { passageText: e.target.value })}
                  placeholder="Passage text"
                  className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <div className="space-y-1.5">
                  {dp.questions.map((q, i) => {
                    // Warn (allow save) when a table/flow sub-group's gap count
                    // differs from its question count — same contract as
                    // QuestionEditor. Back-to-back tables/flows warn separately.
                    let tableWarn: string | null = null;
                    let flowWarn: string | null = null;
                    if (q.type === 'table_completion' && q.tableDef?.rows?.length) {
                      const sub = layoutSubGroup(dp.questions, i);
                      if (sub[0] === q) {
                        const gaps = countDraftTableGaps(q.tableDef);
                        if (gaps !== sub.length) tableWarn = `Table holds ${gaps} gap(s) for ${sub.length} question(s) — check row-major order before Insert.`;
                      }
                    }
                    if (q.type === 'flowchart_completion_text' && q.flowDef?.boxes?.length) {
                      const sub = layoutSubGroup(dp.questions, i);
                      if (sub[0] === q) {
                        const gaps = countDraftFlowGaps(q.flowDef);
                        if (gaps !== sub.length) flowWarn = `Flow-chart holds ${gaps} gap(s) for ${sub.length} question(s) — check top-to-bottom order before Insert.`;
                      }
                    }
                    return (
                    <div key={i} className="p-2 bg-white border border-slate-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-mono font-bold text-slate-400">Q{i + 1}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                          {q.type}
                        </span>
                        {q.type === 'table_completion' && q.tableDef?.rows?.length ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-sky-100 text-sky-800 rounded">
                            table: {countDraftTableGaps(q.tableDef)} gap(s){q.tableDef.title ? ` · ${q.tableDef.title}` : ''}
                          </span>
                        ) : q.type === 'table_completion' ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                            table: no layout (first question needs tableDef)
                          </span>
                        ) : null}
                        {q.type === 'flowchart_completion_text' && q.flowDef?.boxes?.length ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-sky-100 text-sky-800 rounded">
                            flow: {countDraftFlowGaps(q.flowDef)} gap(s){q.flowDef.title ? ` · ${q.flowDef.title}` : ''}
                          </span>
                        ) : q.type === 'flowchart_completion_text' ? (
                          q.prompt.trim() ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                              flow: prompts as boxes
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                              flow: empty — box will render blank (add prompt text or flowDef)
                            </span>
                          )
                        ) : null}
                        <button
                          onClick={() => patchPassage(pi, { questions: dp.questions.filter((_, j) => j !== i) })}
                          className="ml-auto p-1 rounded hover:bg-red-100 cursor-pointer"
                          aria-label={`Remove question ${i + 1}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </button>
                      </div>
                      <p className="text-xs text-slate-800">{q.prompt || (q.type === 'table_completion' && layoutSubGroup(dp.questions, i).some(x => x.tableDef?.rows?.length)
                        ? <em className="text-slate-400">prompt intentionally empty — text lives in the table layout</em>
                        : q.type === 'flowchart_completion_text' && layoutSubGroup(dp.questions, i).some(x => x.flowDef?.boxes?.length)
                          ? <em className="text-slate-400">prompt intentionally empty — text lives in the flow layout</em>
                          : <em className="text-slate-400">empty stem</em>)}</p>
                      <p className="text-[11px] text-emerald-700 mt-0.5 font-medium">
                        Answer: {(q.acceptedAnswers || []).join(' / ') || '—'}
                      </p>
                      {tableWarn && (
                        <p className="text-[11px] text-amber-700 mt-0.5 font-semibold">⚠ {tableWarn}</p>
                      )}
                      {flowWarn && (
                        <p className="text-[11px] text-amber-700 mt-0.5 font-semibold">⚠ {flowWarn}</p>
                      )}
                    </div>
                    );
                  })}
                  {dp.questions.length === 0 && (
                    <p className="text-[11px] text-slate-500">No questions in this draft passage.</p>
                  )}
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                onClick={insert}
                disabled={totalQuestions === 0 && draft.passages.every(p => !p.passageText.trim())}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer transition"
              >
                Insert all into exam
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
