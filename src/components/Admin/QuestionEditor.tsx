import React, { useState } from 'react';
import { Plus, Trash2, Copy, ChevronDown, ChevronUp, ArrowUp, ArrowDown, ListPlus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Question, QuestionType, QUESTION_TYPE_META, getQuestionFamily, getQuestionLabel } from '../../types';
import { buildTableDefFromPrompts, layoutSubGroup } from '../../utils/tableLayout';
import { getMultiLetters, questionSlots, spanEndNumber } from '../../utils/ieltsScoring';

interface QuestionEditorProps {
  questions: Question[];
  onChange: (questions: Question[]) => void;
  idPrefix: string;
  module: 'listening' | 'reading';
}

function makeId(prefix: string): string {
  return `${prefix}-q-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
}

export function createBlankQuestion(type: QuestionType, number: number, idPrefix: string): Question {
  const family = QUESTION_TYPE_META.find(m => m.type === type)?.family || 'text';
  const base: Question = {
    id: makeId(idPrefix),
    number,
    type,
    prompt: '',
    acceptedAnswers: [''],
    explanation: ''
  };
  if (family === 'single_choice' || family === 'multi_choice') {
    const count = type === 'matching_headings' ? 6 : 4;
    base.options = Array.from({ length: count }, (_, i) => `${String.fromCharCode(65 + i)}. `);
    base.acceptedAnswers = family === 'multi_choice' ? [''] : ['A'];
  } else if (type === 'true_false_not_given') {
    base.acceptedAnswers = ['TRUE'];
  } else if (type === 'yes_no_not_given') {
    base.acceptedAnswers = ['YES'];
  }
  if (family === 'diagram') {
    base.diagramConfig = {
      diagramType: type === 'map_label' ? 'map' : 'process',
      title: type === 'map_label' ? 'Plan / Map' : 'Diagram',
      labels: [0, 1, 2].map(i => ({
        id: `${base.id}-lbl-${i + 1}`,
        labelNumber: i + 1,
        x: 15 + ((i * 60) % 70),
        y: 20 + ((i * 37) % 60),
        placeholder: `Label ${i + 1}`
      }))
    };
  }
  return base;
}

function isChoiceFamily(type: QuestionType): boolean {
  const f = QUESTION_TYPE_META.find(m => m.type === type)?.family;
  return f === 'single_choice' || f === 'multi_choice';
}

function questionIssues(q: Question): string[] {
  const issues: string[] = [];
  const hasFlowLayout = q.type === 'flowchart_completion_text' && !!q.flowDef?.boxes?.length;
  if (!q.prompt.trim() && q.type !== 'table_completion' && !hasFlowLayout) issues.push('missing prompt');
  if (!q.acceptedAnswers.some(a => a.trim())) issues.push('missing answer key');
  if (q.type === 'multiple_choice_multi') {
    const letters = getMultiLetters(q);
    if (letters.length === 0) issues.push('add one accepted letter per row (e.g. B, then D)');
    else if (typeof q.maxSelections === 'number' && q.maxSelections > 0 && q.maxSelections !== letters.length) {
      issues.push(`keys (${letters.length}) must match Must Choose (${q.maxSelections})`);
    }
  }
  if (isChoiceFamily(q.type) && (!q.options || q.options.filter(o => o.trim()).length < 2)) {
    issues.push('needs 2+ options');
  }
  if (q.type === 'table_completion' && (!q.tableDef || !q.tableDef.rows || q.tableDef.rows.length === 0)) {
    issues.push('missing table layout');
  }
  if (q.type === 'image_map' && !q.imageUrl) {
    issues.push('missing plan image');
  }
  return issues;
}

const TYPE_HINT: Partial<Record<QuestionType, string>> = {
  table_completion: 'Consecutive table questions render as ONE table (layout from the first). Mark gaps with ___.',
  flowchart_completion: 'Consecutive questions with identical options share ONE bank beside the flow steps.',
  flowchart_completion_text: 'Consecutive type-in flow questions render as ONE chart (layout from the first). Mark gaps with ___. A line with only || branches the boxes below it into 2 columns. No word bank needed.',
  image_map: 'Upload the plan on the first question. The plan is shown clean; candidates answer from the numbered list beside it. Identical options share ONE bank.'
};

/** Count gap markers across flow boxes. */
function countFlowGaps(def?: { boxes: string[] }): number {
  if (!def?.boxes) return 0;
  return def.boxes.join('|').split(/_{2,}|…|\*{3,}/).length - 1;
}

/** Count gap markers across table cells. */
function countTableGaps(def?: { rows: string[][] }): number {
  if (!def?.rows) return 0;
  return def.rows.flat().join('|').split(/_{2,}|…|\*{3,}/).length - 1;
}

const FAMILY_KEY_HINT: Record<string, string> = {
  single_choice: 'Answer key = option letter (e.g. B) for choice; FULL option text for matching (e.g. the complete heading).',
  multi_choice: 'ONE row per correct letter, e.g. B then D (each letter earns its own question number).',
  tfng: 'One of TRUE, FALSE, NOT GIVEN.',
  ynng: 'One of YES, NO, NOT GIVEN.',
  text: 'All accepted variants, one per row (e.g. colour / color).',
  diagram: 'All accepted label texts, one per row.'
};

/** Table layout editor: title, headers, pipe-delimited rows, ___ = gap. */
const TableDefEditor: React.FC<{
  q: Question;
  siblingGapMismatch: { groupSize: number; gaps: number } | null;
  /** Prompts of the whole consecutive table group (for auto-build). */
  groupPrompts: string[];
  onChange: (patch: Partial<Question>) => void;
}> = ({ q, siblingGapMismatch, groupPrompts, onChange }) => {
  const def = q.tableDef || { headers: [], rows: [] as string[][] };
  const setDef = (patch: Partial<NonNullable<Question['tableDef']>>) => {
    const next = { headers: def.headers || [], rows: def.rows || [], title: def.title, ...patch };
    const width = Math.max(next.headers.length, ...next.rows.map(r => r.length), 1);
    next.rows = next.rows.map(r => {
      const row = [...r];
      while (row.length < width) row.push('');
      return row.slice(0, width);
    });
    onChange({ tableDef: next });
  };
  const hasLayout = (def.rows || []).some(r => r.some(c => c.trim()));
  const canBuild = groupPrompts.some(p => p.trim());
  const autoBuild = () => {
    if (hasLayout && !window.confirm('Replace the current table layout with an auto-built one from the question prompts (| and • split into columns)?')) return;
    const built = buildTableDefFromPrompts(groupPrompts);
    if (!built) return;
    onChange({ tableDef: { ...built, ...(def.title ? { title: def.title } : {}) } });
  };
  return (
    <div className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-600 uppercase font-bold block flex-1">
          Table Layout <span className="normal-case font-medium text-slate-400">(taken from the first question of the group)</span>
        </span>
        <button
          type="button"
          onClick={autoBuild}
          disabled={!canBuild}
          title={canBuild ? 'Build rows from the group question prompts (| and • split into columns)' : 'No question prompts to build from'}
          className="px-2.5 py-1 bg-white border border-dashed border-slate-300 hover:border-orange-400 disabled:opacity-40 text-slate-600 hover:text-orange-700 rounded-lg text-[11px] font-semibold transition cursor-pointer"
        >
          Auto-build from prompts
        </button>
      </div>
      <input
        type="text"
        value={def.title || ''}
        onChange={e => setDef({ title: e.target.value })}
        placeholder="Table title, e.g. Research findings"
        className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <input
        type="text"
        value={(def.headers || []).join(', ')}
        onChange={e => setDef({ headers: e.target.value.split(',').map(s => s.trim()) })}
        placeholder="Headers, comma separated (first may be empty)"
        className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <textarea
        rows={4}
        value={(def.rows || []).map(r => r.join(' | ')).join('\n')}
        onChange={e => setDef({
          rows: e.target.value.split('\n').map(line => line.split('|').map(c => c.trim()))
        })}
        placeholder={'One row per line, cells split by |, ___ marks a gap\nE.g. First level | Effective support | Enjoyment of a ___'}
        className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <div className="text-[11px] text-slate-500">
        Gaps in layout: <strong className="font-mono">{countTableGaps(q.tableDef)}</strong>
        {siblingGapMismatch && (
          <span className="ml-2 text-amber-700 font-semibold">
            ⚠ Group has {siblingGapMismatch.groupSize} question(s) but layout holds {siblingGapMismatch.gaps} gap(s).
          </span>
        )}
      </div>
    </div>
  );
};

/** Flow-chart layout editor: title + one box per line, ___ = gap. */
const FlowDefEditor: React.FC<{
  q: Question;
  siblingGapMismatch: { groupSize: number; gaps: number } | null;
  onChange: (patch: Partial<Question>) => void;
}> = ({ q, siblingGapMismatch, onChange }) => {
  const def = q.flowDef || { boxes: [] as string[] };
  const setDef = (patch: Partial<NonNullable<Question['flowDef']>>) => {
    const next = { boxes: def.boxes || [], title: def.title, ...patch };
    onChange({ flowDef: next });
  };
  return (
    <div className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-2">
      <span className="text-[10px] text-slate-600 uppercase font-bold block">
        Flow-Chart Layout <span className="normal-case font-medium text-slate-400">(taken from the first question of the group; leave empty to use each prompt as its own box)</span>
      </span>
      <input
        type="text"
        value={def.title || ''}
        onChange={e => setDef({ title: e.target.value })}
        placeholder="Chart title, e.g. Honey production"
        className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <textarea
        rows={5}
        value={(def.boxes || []).join('\n')}
        onChange={e => setDef({ boxes: e.target.value.split('\n').map(s => s.trim()) })}
        placeholder={'One box per line, top-to-bottom, ___ marks a gap\nA line with only || branches the boxes below into 2 columns\nE.g. Gigartina (also called as ___)\n||\n___ canned or bottled food'}
        className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <div className="text-[11px] text-slate-500">
        Gaps in layout: <strong className="font-mono">{countFlowGaps(q.flowDef)}</strong>
        {siblingGapMismatch && (
          <span className="ml-2 text-amber-700 font-semibold">
            ⚠ Group has {siblingGapMismatch.groupSize} question(s) but layout holds {siblingGapMismatch.gaps} gap(s).
          </span>
        )}
      </div>
    </div>
  );
};

/** Plan image upload (shown clean to candidates; answers go in the side list). */
const ImageMapEditor: React.FC<{
  q: Question;
  groupImage?: string;
  onChange: (patch: Partial<Question>) => void;
}> = ({ q, groupImage, onChange }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const preview = q.imageUrl || groupImage;

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file (PNG/JPG).');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('type', 'diagram');
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error || `Upload failed (${res.status}).`);
      onChange({ imageUrl: data.url as string });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-2">
      <span className="text-[10px] text-slate-600 uppercase font-bold block">
        Plan Image <span className="normal-case font-medium text-slate-400">(image + bank taken from the first question of the group)</span>
      </span>
      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-dashed border-slate-300 hover:border-orange-400 text-slate-600 hover:text-orange-700 rounded-lg text-[11px] font-semibold transition cursor-pointer">
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        {uploading ? 'Uploading…' : q.imageUrl ? 'Replace plan image' : 'Upload plan image'}
      </label>
      {uploadError && <p className="text-[11px] text-rose-700">{uploadError}</p>}
      {preview && (
        <div className="inline-block max-w-full border border-slate-300 rounded-lg overflow-hidden">
          <img src={preview} alt="Plan preview" className="block max-w-full h-auto" />
        </div>
      )}
    </div>
  );
};

export const QuestionEditor: React.FC<QuestionEditorProps> = ({
  questions,
  onChange,
  idPrefix,
  module
}) => {
  const [pickerAt, setPickerAt] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const availableTypes = QUESTION_TYPE_META.filter(m => m.modules.includes(module));
  const groups = Array.from(new Set(availableTypes.map(m => m.group)));

  const updateQuestion = (id: string, patch: Partial<Question>) => {
    onChange(questions.map(q => (q.id === id ? { ...q, ...patch } : q)));
  };

  const handleAdd = (type: QuestionType, index: number = questions.length) => {
    // Provisional number only — the parent renumbers everything by position
    // (slot-aware), so the inserted row and all rows after it shift cleanly.
    const prev = index > 0 ? questions[index - 1] : undefined;
    const provisional = prev
      ? spanEndNumber(prev) + 1
      : questions.reduce((max, q) => Math.max(max, spanEndNumber(q)), 0) + 1;
    const created = createBlankQuestion(type, provisional, idPrefix);
    const next = [...questions];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, created);
    onChange(next);
    setExpandedId(created.id);
    setPickerAt(null);
  };

  const moveQuestion = (id: string, dir: -1 | 1) => {
    const idx = questions.findIndex(q => q.id === id);
    const ni = idx + dir;
    if (idx < 0 || ni < 0 || ni >= questions.length) return;
    const next = [...questions];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    onChange(next);
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Delete this question? Numbers will shift up automatically.')) return;
    onChange(questions.filter(q => q.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const handleDuplicate = (id: string) => {
    const idx = questions.findIndex(q => q.id === id);
    if (idx < 0) return;
    const copy: Question = {
      ...JSON.parse(JSON.stringify(questions[idx])),
      id: makeId(idPrefix)
    };
    const next = [...questions];
    next.splice(idx + 1, 0, copy);
    onChange(next);
    setExpandedId(copy.id);
  };

  const handleTypeSwitch = (id: string, nextType: QuestionType) => {
    const q = questions.find(x => x.id === id);
    if (!q || q.type === nextType) return;
    const patch: Partial<Question> = { type: nextType };
    if (isChoiceFamily(nextType) && (!q.options || q.options.length === 0)) {
      patch.options = ['A. ', 'B. ', 'C. ', 'D. '];
      patch.acceptedAnswers = nextType === 'multiple_choice_multi' ? [''] : ['A'];
    }
    if (!isChoiceFamily(nextType)) {
      patch.options = undefined;
    }
    if (nextType === 'true_false_not_given') patch.acceptedAnswers = ['TRUE'];
    if (nextType === 'yes_no_not_given') patch.acceptedAnswers = ['YES'];
    updateQuestion(id, patch);
  };

  const renderPicker = (index: number) => (
    <div className="bg-white border-2 border-orange-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
          <ListPlus className="w-4 h-4 text-orange-600" />
          Choose question type
        </span>
        <button
          type="button"
          onClick={() => setPickerAt(null)}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
        >
          Cancel
        </button>
      </div>
      {groups.map(g => (
        <div key={g}>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{g}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {availableTypes.filter(m => m.group === g).map(m => (
              <button
                key={m.type}
                type="button"
                onClick={() => handleAdd(m.type, index)}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-orange-500 hover:bg-orange-50/50 text-left transition cursor-pointer group"
              >
                <span className="block text-xs font-bold text-slate-800 group-hover:text-orange-900">{m.label}</span>
                <span className="text-[11px] text-slate-500 block mt-0.5 leading-snug">{m.description}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderDivider = (index: number) => {
    if (pickerAt === index) return renderPicker(index);
    const prev = index > 0 ? questions[index - 1] : undefined;
    const atNum = prev ? spanEndNumber(prev) + 1 : 1;
    return (
      <button
        type="button"
        onClick={() => setPickerAt(index)}
        title={`Insert new question here (Q${atNum})`}
        aria-label={`Insert question here (becomes Q${atNum})`}
        className="group w-full flex items-center gap-2 py-1 cursor-pointer"
      >
        <span className="flex-1 border-t-2 border-dotted border-slate-200 group-hover:border-orange-400 transition" />
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white border border-slate-300 text-slate-400 group-hover:border-orange-500 group-hover:text-orange-600 group-hover:bg-orange-50 transition">
          <Plus className="w-3 h-3" />
        </span>
        <span className="flex-1 border-t-2 border-dotted border-slate-200 group-hover:border-orange-400 transition" />
      </button>
    );
  };

  return (
    <div className="space-y-2">
      {questions.map((q, qi) => {
        const issues = questionIssues(q);
        // Number-range overlap: multi records cover number..spanEnd, so two
        // records must never claim the same number.
        const rangeOverlap = questions.some(
          o => o.id !== q.id &&
            (q.number || 0) <= spanEndNumber(o) &&
            (o.number || 0) <= spanEndNumber(q)
        );
        if (rangeOverlap) issues.push('number range overlaps another question');
        const expanded = expandedId === q.id;
        const family = getQuestionFamily(q.type);
        return (
          <React.Fragment key={q.id}>
            {renderDivider(qi)}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Collapsed header row */}
            <div className="flex items-center gap-2 p-2.5">
              <span className={`h-6 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 font-mono font-bold text-[11px] flex items-center justify-center shrink-0 ${q.type === 'multiple_choice_multi' && questionSlots(q) > 1 ? 'w-auto px-1.5' : 'w-6'}`} title={q.type === 'multiple_choice_multi' && questionSlots(q) > 1 ? `Covers questions ${q.number}–${spanEndNumber(q)} (one mark per letter)` : `Question ${q.number}`}>
                {q.type === 'multiple_choice_multi' && questionSlots(q) > 1 ? `${q.number}–${spanEndNumber(q)}` : q.number}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 shrink-0">
                {getQuestionLabel(q.type)}
              </span>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : q.id)}
                className="flex-1 min-w-0 text-left text-xs text-slate-700 truncate hover:text-slate-900 cursor-pointer"
                title={q.prompt || 'Empty prompt — click to edit'}
              >
                {q.prompt || <span className="text-slate-400 italic">Empty prompt — click to edit</span>}
              </button>
              {issues.length > 0 ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 shrink-0" title={issues.join('; ')}>
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Incomplete</span>
                </span>
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => moveQuestion(q.id, -1)}
                disabled={qi === 0}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer disabled:opacity-30 disabled:cursor-default"
                title="Move question up"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveQuestion(q.id, 1)}
                disabled={qi === questions.length - 1}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer disabled:opacity-30 disabled:cursor-default"
                title="Move question down"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleDuplicate(q.id)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                title="Duplicate question"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(q.id)}
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                title="Delete question"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : q.id)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                title={expanded ? 'Collapse' : 'Expand'}
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Expanded editor */}
            {expanded && (
              <div className="border-t border-slate-100 p-3 space-y-3 bg-slate-50/50">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">No.</label>
                    <input
                      type="number"
                      value={q.number}
                      onChange={e => updateQuestion(q.id, { number: parseInt(e.target.value) || q.number })}
                      className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">Question Type</label>
                    <select
                      value={q.type}
                      onChange={e => handleTypeSwitch(q.id, e.target.value as QuestionType)}
                      className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {availableTypes.map(m => (
                        <option key={m.type} value={m.type}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">Question Prompt</label>
                  <textarea
                    rows={2}
                    value={q.prompt}
                    onChange={e => updateQuestion(q.id, { prompt: e.target.value })}
                    placeholder={
                      family === 'text' || family === 'diagram'
                        ? 'e.g. The library opens at _______ (one gap per question renders inline)'
                        : 'e.g. Which floor is the café on?'
                    }
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                      Instruction Line <span className="normal-case font-medium text-slate-400">(shown above the question, optional)</span>
                    </label>
                    <input
                      type="text"
                      value={q.instructionLine || ''}
                      onChange={e => updateQuestion(q.id, { instructionLine: e.target.value || undefined })}
                      placeholder="e.g. Write NO MORE THAN TWO WORDS AND/OR A NUMBER."
                      className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  {(family === 'text' || family === 'diagram') && (
                    <div>
                      <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">Word Limit</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={q.wordLimit ?? ''}
                        onChange={e => {
                          const v = parseInt(e.target.value);
                          updateQuestion(q.id, { wordLimit: isNaN(v) ? undefined : Math.max(1, Math.min(10, v)) });
                        }}
                        placeholder="e.g. 2"
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  )}
                  {q.type === 'multiple_choice_multi' && (
                    <div>
                      <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">Must Choose</label>
                      <input
                        type="number"
                        min={2}
                        max={9}
                        value={q.maxSelections ?? ''}
                        onChange={e => {
                          const v = parseInt(e.target.value);
                          updateQuestion(q.id, { maxSelections: isNaN(v) ? undefined : Math.max(2, Math.min(9, v)) });
                        }}
                        placeholder="e.g. 2"
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  )}
                </div>

                {/* Options editor for choice families */}
                {(family === 'single_choice' || family === 'multi_choice') && (
                  <div>
                    <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                      Answer Options <span className="normal-case font-medium text-slate-400">(start each with its key letter: A. … / i. …)</span>
                    </label>
                    <div className="space-y-1.5">
                      {(q.options || []).map((opt, oIdx) => (
                        <div key={oIdx} className="flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded bg-slate-100 border border-slate-200 text-slate-600 font-mono font-bold text-[11px] flex items-center justify-center shrink-0">
                            {opt.charAt(0) || '?'}
                          </span>
                          <input
                            type="text"
                            value={opt}
                            onChange={e => {
                              const next = [...(q.options || [])];
                              next[oIdx] = e.target.value;
                              updateQuestion(q.id, { options: next });
                            }}
                            placeholder="A. Option text"
                            className="flex-1 p-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                          />
                          <button
                            type="button"
                            onClick={() => updateQuestion(q.id, { options: (q.options || []).filter((_, i) => i !== oIdx) })}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title="Remove option"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...(q.options || [])];
                          next.push(`${String.fromCharCode(65 + next.length)}. `);
                          updateQuestion(q.id, { options: next });
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-dashed border-slate-300 hover:border-orange-400 text-slate-600 hover:text-orange-700 rounded-lg text-[11px] font-semibold transition cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add option</span>
                      </button>
                    </div>
                  </div>
                )}

                {TYPE_HINT[q.type] && (
                  <div className="p-2 bg-blue-50/70 border border-blue-200 rounded-lg text-[11px] text-blue-900">
                    {TYPE_HINT[q.type]}
                  </div>
                )}

                {/* Table layout editor */}
                {q.type === 'table_completion' && (
                  <TableDefEditor
                    q={q}
                    siblingGapMismatch={(() => {
                      const sub = layoutSubGroup(questions, questions.findIndex(x => x.id === q.id));
                      const gaps = countTableGaps(q.tableDef);
                      return sub.length !== gaps ? { groupSize: sub.length, gaps } : null;
                    })()}
                    groupPrompts={layoutSubGroup(questions, questions.findIndex(x => x.id === q.id)).map(g => g.prompt)}
                    onChange={patch => updateQuestion(q.id, patch)}
                  />
                )}

                {/* Flow-chart (type-in) layout editor */}
                {q.type === 'flowchart_completion_text' && (
                  <FlowDefEditor
                    q={q}
                    siblingGapMismatch={(() => {
                      if (!q.flowDef?.boxes?.length) return null;
                      const sub = layoutSubGroup(questions, questions.findIndex(x => x.id === q.id));
                      const gaps = countFlowGaps(q.flowDef);
                      return sub.length !== gaps ? { groupSize: sub.length, gaps } : null;
                    })()}
                    onChange={patch => updateQuestion(q.id, patch)}
                  />
                )}

                {/* Plan image + gap placement editor */}
                {q.type === 'image_map' && (
                  <ImageMapEditor
                    q={q}
                    groupImage={questions.find(x => x.type === 'image_map' && x.imageUrl)?.imageUrl}
                    onChange={patch => updateQuestion(q.id, patch)}
                  />
                )}

                {/* Accepted answer keys */}
                <div>
                  <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                    Accepted Answer Keys <span className="normal-case font-medium text-slate-400">({FAMILY_KEY_HINT[family]})</span>
                  </label>
                  <div className="space-y-1.5">
                    {q.acceptedAnswers.map((ans, aIdx) => (
                      <div key={aIdx} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={ans}
                          onChange={e => {
                            const next = [...q.acceptedAnswers];
                            next[aIdx] = e.target.value;
                            updateQuestion(q.id, { acceptedAnswers: next });
                          }}
                          placeholder={family === 'multi_choice' ? 'e.g. B (one letter per row)' : 'e.g. answer variant'}
                          className="flex-1 p-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (q.acceptedAnswers.length <= 1) return;
                            updateQuestion(q.id, { acceptedAnswers: q.acceptedAnswers.filter((_, i) => i !== aIdx) });
                          }}
                          disabled={q.acceptedAnswers.length <= 1}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer disabled:opacity-30"
                          title="Remove key"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => updateQuestion(q.id, { acceptedAnswers: [...q.acceptedAnswers, ''] })}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-dashed border-slate-300 hover:border-orange-400 text-slate-600 hover:text-orange-700 rounded-lg text-[11px] font-semibold transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add accepted variant</span>
                    </button>
                  </div>
                </div>

                {/* Diagram labels */}
                {family === 'diagram' && (
                  <div>
                    <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                      Diagram Labels <span className="normal-case font-medium text-slate-400">(hotspots shown on the student map)</span>
                    </label>
                    <div className="space-y-1.5">
                      {(q.diagramConfig?.labels || []).map((lbl, lIdx) => (
                        <div key={lbl.id} className="flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded bg-slate-100 border border-slate-200 text-slate-600 font-mono font-bold text-[11px] flex items-center justify-center shrink-0">
                            {lbl.labelNumber}
                          </span>
                          <input
                            type="text"
                            value={lbl.placeholder}
                            onChange={e => {
                              const labels = [...(q.diagramConfig?.labels || [])];
                              labels[lIdx] = { ...labels[lIdx], placeholder: e.target.value };
                              updateQuestion(q.id, {
                                diagramConfig: {
                                  diagramType: q.diagramConfig?.diagramType || 'process',
                                  title: q.diagramConfig?.title || 'Diagram',
                                  labels
                                }
                              });
                            }}
                            placeholder="Label text"
                            className="flex-1 p-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const labels = (q.diagramConfig?.labels || []).filter((_, i) => i !== lIdx)
                                .map((l, i) => ({ ...l, labelNumber: i + 1 }));
                              updateQuestion(q.id, {
                                diagramConfig: {
                                  diagramType: q.diagramConfig?.diagramType || 'process',
                                  title: q.diagramConfig?.title || 'Diagram',
                                  labels
                                }
                              });
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title="Remove label"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const labels = [...(q.diagramConfig?.labels || [])];
                          const n = labels.length;
                          labels.push({
                            id: `${q.id}-lbl-${Date.now().toString(36)}`,
                            labelNumber: n + 1,
                            x: 15 + ((n * 60) % 70),
                            y: 20 + ((n * 37) % 60),
                            placeholder: `Label ${n + 1}`
                          });
                          updateQuestion(q.id, {
                            diagramConfig: {
                              diagramType: q.diagramConfig?.diagramType || 'process',
                              title: q.diagramConfig?.title || 'Diagram',
                              labels
                            }
                          });
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-dashed border-slate-300 hover:border-orange-400 text-slate-600 hover:text-orange-700 rounded-lg text-[11px] font-semibold transition cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add label</span>
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">Explanation <span className="normal-case font-medium text-slate-400">(optional, shown in review)</span></label>
                  <input
                    type="text"
                    value={q.explanation || ''}
                    onChange={e => updateQuestion(q.id, { explanation: e.target.value })}
                    placeholder="Why this answer is correct…"
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>
            )}
          </div>
          </React.Fragment>
        );
      })}

      {/* Add question at the end */}
      {pickerAt === questions.length ? (
        renderPicker(questions.length)
      ) : (
        <button
          type="button"
          onClick={() => setPickerAt(questions.length)}
          className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-orange-300 hover:border-orange-500 bg-orange-50/40 hover:bg-orange-50/80 text-orange-700 font-bold rounded-xl text-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Question</span>
        </button>
      )}
    </div>
  );
};
