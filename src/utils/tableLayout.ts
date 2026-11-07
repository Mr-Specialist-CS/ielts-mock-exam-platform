import type { TableDef } from '../types';

/** Minimal shape satisfied by both Question and import-draft questions. */
export interface TableLayoutHolder {
  type: string;
  prompt: string;
  tableDef?: { title?: string; headers?: string[]; rows?: string[][] };
  flowDef?: { title?: string; boxes?: string[] };
}

/**
 * Split one question prompt into table cells: explicit `|` columns win;
 * otherwise `•` bullets; otherwise the whole prompt is a single cell.
 * Trims parts, drops empties, collapses inner whitespace. `___` gap markers
 * ride along untouched so row-major gap order is preserved.
 */
function splitPromptCells(prompt: string): string[] {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (prompt.includes('|')) {
    const cells = prompt.split('|').map(clean).filter(c => c !== '');
    if (cells.length > 0) return cells;
  }
  if (prompt.includes('•')) {
    const cells = prompt.split('•').map(clean).filter(c => c !== '');
    if (cells.length > 0) return cells;
  }
  const single = clean(prompt);
  return single ? [single] : [];
}

/**
 * Best-effort table layout from one-prompt-per-question drafts: each prompt
 * becomes one row (in question order), split into cells as above, rows padded
 * to a common width. Gap order stays row-major, matching the renderer, so
 * question i answers gap i. Returns undefined when every prompt is empty.
 */
export function buildTableDefFromPrompts(prompts: string[]): TableDef | undefined {
  if (!prompts.length) return undefined;
  const rows = prompts.map(splitPromptCells);
  if (rows.every(r => r.length === 0)) return undefined;
  const width = Math.max(...rows.map(r => r.length), 1);
  const padded = rows.map(r => {
    const row = [...r];
    while (row.length < width) row.push('');
    return row;
  });
  if (padded.every(r => r.every(c => !c))) return undefined;
  return { headers: [], rows: padded };
}

/**
 * Fill a missing table layout for every consecutive table_completion run
 * that has none: the run's prompts become the layout on its FIRST question
 * (renderer + QuestionEditor contract). Runs that already carry a layout,
 * and runs whose prompts are all empty, are left untouched.
 */
export function autoBuildMissingTableLayouts<T extends TableLayoutHolder>(questions: T[]): T[] {
  let i = 0;
  while (i < questions.length) {
    if (questions[i].type !== 'table_completion') { i++; continue; }
    let j = i;
    while (j + 1 < questions.length && questions[j + 1].type === 'table_completion') j++;
    // A fresh tableDef starts a new table: build per sub-group so two
    // back-to-back tables (e.g. Q1–4 notes + Q5–10 grid) stay separate.
    for (const sub of splitLayoutGroups(questions.slice(i, j + 1))) {
      if (!sub.some(q => q.tableDef?.rows?.length)) {
        const built = buildTableDefFromPrompts(sub.map(q => q.prompt));
        if (built) {
          sub.forEach(q => { delete q.tableDef; });
          sub[0].tableDef = built;
        }
      }
    }
    i = j + 1;
  }
  return questions;
}

const hasFreshLayout = (q: TableLayoutHolder) =>
  !!q.tableDef?.rows?.length || !!q.flowDef?.boxes?.length;

/**
 * Split a consecutive same-type run into visual sub-groups: a fresh layout
 * object (tableDef/flowDef) on a non-first question starts a NEW group
 * (e.g. Q1–4 notes table followed by a Q5–10 entertainment table).
 */
export function splitLayoutGroups<T extends TableLayoutHolder>(run: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const q of run) {
    if (cur.length > 0 && hasFreshLayout(q)) { out.push(cur); cur = []; }
    cur.push(q);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The visual sub-group containing questions[idx]: the same-type run around
 * it, split on fresh layouts. Used by render grouping, validation, and
 * draft review so back-to-back tables/flows never merge.
 */
export function layoutSubGroup<T extends TableLayoutHolder>(questions: T[], idx: number): T[] {
  const type = questions[idx]?.type;
  if (!type) return [];
  let s = idx, e = idx;
  while (s - 1 >= 0 && questions[s - 1].type === type) s--;
  while (e + 1 < questions.length && questions[e + 1].type === type) e++;
  const run = questions.slice(s, e + 1);
  let off = idx - s;
  for (const sub of splitLayoutGroups(run)) {
    if (off < sub.length) return sub;
    off -= sub.length;
  }
  return [];
}
