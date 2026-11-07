import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Question } from '../../types';
import { HlText } from './highlight';

/** Shared IDP-style input widgets. Tab order follows DOM order (native controls). */

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function enforceWordLimit(text: string, limit?: number): string {
  if (!limit || limit <= 0) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text;
  // Preserve leading spacing style minimally: rejoin truncated words.
  const leadingSpace = /^\s/.test(text) ? ' ' : '';
  return leadingSpace + words.slice(0, limit).join(' ');
}

/** Split a prompt on gap markers (___ or … or ***). Returns text parts; gaps = parts.length - 1. */
export function splitBlanks(prompt: string): string[] {
  return prompt.split(/_{2,}|…|\*{3,}/);
}

/** Group header: "Question 20" for a single question, "Questions 11–14" for a range. */
export function groupRangeLabel(first: number | undefined, last: number | undefined): string {
  return first === last ? `Question ${first}` : `Questions ${first}–${last}`;
}

const inputCls =
  'bg-white border border-slate-500 text-slate-900 text-[13px] rounded-sm focus:outline-none focus:border-blue-800 focus:ring-1 focus:ring-blue-800';

/** Vertical/horizontal native radios for TRUE/FALSE/NOT GIVEN etc. */
export const IdpRadio3: React.FC<{
  qid: string;
  value: string;
  choices: string[];
  onPick: (v: string) => void;
  horizontal?: boolean;
  /** Highlight scope root. Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ qid, value, choices, onPick, horizontal, hlPrefix }) => (
  <div className={horizontal ? 'flex flex-wrap gap-4 pt-1' : 'space-y-1.5 pt-1'} role="radiogroup" aria-label={`Question choices`}>
    {choices.map((c, ci) => (
      <label
        key={c}
        className="inline-flex items-center gap-2 text-[13px] text-slate-900 cursor-pointer py-0.5"
      >
        <input
          type="radio"
          name={`q-${qid}`}
          checked={value.toUpperCase() === c}
          onChange={() => onPick(c)}
          className="w-4 h-4 accent-slate-900 cursor-pointer"
        />
        <span>{hlPrefix ? <HlText text={c} unitKey={`${hlPrefix}|tf|${qid}|opt${ci}`} interactive={false} /> : c}</span>
      </label>
    ))}
  </div>
);

/** Single-select option list (multiple choice). Stored value = option key (first letter). */
export const IdpSingleList: React.FC<{
  qid: string;
  value: string;
  options: string[];
  onPick: (key: string) => void;
  /** Listening highlight scope root (section id). Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ qid, value, options, onPick, hlPrefix }) => (
  <div className="space-y-1 pt-1" role="radiogroup" aria-label="Answer options">
    {options.map((opt, oi) => {
      const key = opt.charAt(0);
      const selected = value === key || value === opt;
      return (
        <label
          key={opt}
          className={`flex items-start gap-2 px-2 py-1.5 border text-[13px] cursor-pointer transition rounded-sm ${
            selected ? 'border-slate-900 bg-slate-100' : 'border-slate-300 bg-white hover:border-slate-500'
          }`}
        >
          <input
            type="radio"
            name={`q-${qid}`}
            checked={selected}
            onChange={() => onPick(key)}
            className="w-4 h-4 mt-0.5 accent-slate-900 cursor-pointer shrink-0"
          />
          <span className="text-slate-900">
            {hlPrefix ? <HlText text={opt} unitKey={`${hlPrefix}|mc|${qid}|opt${oi}`} interactive={false} /> : opt}
          </span>
        </label>
      );
    })}
  </div>
);

/** Multi-select checkboxes. Stored value = sorted combined keys, e.g. "B, D". */
export const IdpMultiList: React.FC<{
  qid: string;
  value: string;
  options: string[];
  max?: number;
  onPick: (csv: string) => void;
  /** Listening highlight scope root (section id). Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ qid, value, options, max, onPick, hlPrefix }) => {
  const selected = value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const toggle = (key: string) => {
    const k = key.toUpperCase();
    let next = selected.includes(k) ? selected.filter(x => x !== k) : [...selected, k];
    if (max && max > 0 && next.length > max) return;
    next = next.sort();
    onPick(next.join(', '));
  };
  return (
    <div>
      {max && max > 0 && (
        <p className="text-[11px] text-slate-600 italic pt-1">Choose {max > 1 ? `${max} answers` : '1 answer'}.</p>
      )}
      <div className="space-y-1 pt-1" role="group" aria-label="Answer options (multiple)">
        {options.map((opt, oi) => {
          const key = opt.charAt(0).toUpperCase();
          const isOn = selected.includes(key);
          return (
            <label
              key={opt}
              className={`flex items-start gap-2 px-2 py-1.5 border text-[13px] cursor-pointer transition rounded-sm ${
                isOn ? 'border-slate-900 bg-slate-100' : 'border-slate-300 bg-white hover:border-slate-500'
              }`}
            >
              <input
                type="checkbox"
                checked={isOn}
                onChange={() => toggle(key)}
                className="w-4 h-4 mt-0.5 accent-slate-900 cursor-pointer shrink-0"
              />
              <span className="text-slate-900">
                {hlPrefix ? <HlText text={opt} unitKey={`${hlPrefix}|mc|${qid}|opt${oi}`} interactive={false} /> : opt}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

/** Native dropdown. Stored value = full option text (matching families). */
export const IdpSelect: React.FC<{
  qid: string;
  value: string;
  options: string[];
  onPick: (v: string) => void;
  ariaLabel?: string;
}> = ({ qid, value, options, onPick, ariaLabel }) => (
  <select
    aria-label={ariaLabel || `Answer for question`}
    value={options.includes(value) ? value : ''}
    onChange={e => onPick(e.target.value)}
    className={`mt-1 max-w-full px-2 py-1.5 text-[13px] cursor-pointer ${inputCls}`}
  >
    <option value="">Select…</option>
    {options.map(opt => (
      <option key={opt} value={opt}>
        {opt}
      </option>
    ))}
  </select>
);

/** Text input with word-limit counter + truncation. */
export const IdpText: React.FC<{
  qid: string;
  value: string;
  onEdit: (v: string) => void;
  wordLimit?: number;
  placeholder?: string;
  small?: boolean;
}> = ({ qid, value, onEdit, wordLimit, placeholder, small }) => {
  const n = countWords(value);
  return (
    <div className="pt-1 max-w-md">
      <input
        type="text"
        aria-label={`Answer input`}
        value={value}
        onChange={e => onEdit(enforceWordLimit(e.target.value, wordLimit))}
        placeholder={placeholder || 'Type your answer here'}
        className={`w-full px-2 ${small ? 'py-1 text-[12px]' : 'py-1.5 text-[13px]'} ${inputCls}`}
      />
      {wordLimit !== undefined && wordLimit > 0 && (
        <p className={`text-[10px] font-mono mt-0.5 ${n > wordLimit ? 'text-red-700' : 'text-slate-500'}`}>
          {n} / {wordLimit} words
        </p>
      )}
    </div>
  );
};

/**
 * Prompt with gap markers. Single gap → inline input/select embedded in the
 * sentence. Multiple gaps → prompt rendered as-is; caller renders the shared
 * input below (admin guidance: one gap per question).
 */
export const IdpInlineBlanks: React.FC<{
  prompt: string;
  value: string;
  onEdit: (v: string) => void;
  wordLimit?: number;
  selectOptions?: string[];
  /** Exact highlight unit base (e.g. `${sectionId}|rq|${qid}`). Absent = plain. */
  hlUnit?: string;
}> = ({ prompt, value, onEdit, wordLimit, selectOptions, hlUnit }) => {
  const parts = splitBlanks(prompt);
  const hl = (suffix: string, t: string) =>
    hlUnit && t ? <HlText text={t} unitKey={`${hlUnit}|${suffix}`} /> : t;
  if (parts.length <= 1) return <p className="text-[13px] text-slate-900 leading-relaxed">{hl('prompt', prompt)}</p>;
  if (parts.length > 2) return <p className="text-[13px] text-slate-900 leading-relaxed">{hl('prompt', prompt)}</p>;
  return (
    <p className="text-[13px] text-slate-900 leading-loose">
      {hl('gapA', parts[0])}
      {selectOptions ? (
        <IdpSelect qid="inline" value={value} options={selectOptions} onPick={onEdit} ariaLabel="Choose ending" />
      ) : (
        <input
          type="text"
          aria-label="Gap answer"
          value={value}
          onChange={e => onEdit(enforceWordLimit(e.target.value, wordLimit))}
          className={`inline-block w-40 mx-1 px-2 py-0.5 text-[13px] align-baseline ${inputCls}`}
        />
      )}
      {hl('gapB', parts[1])}
    </p>
  );
};

/** Number-inside-the-box gap input (Inspera pattern). Shared by sentences, tables, flows. */
export const GapBox: React.FC<{
  number: number;
  value: string;
  onEdit: (v: string) => void;
  wordLimit?: number;
  dashed?: boolean;
  onActivate?: () => void;
  active?: boolean;
}> = ({ number, value, onEdit, wordLimit, dashed, onActivate, active }) => (
  <span className="inline-flex items-center gap-1 align-baseline">
    <input
      type="text"
      aria-label={`Answer ${number}`}
      value={value}
      placeholder={String(number)}
      onChange={e => onEdit(enforceWordLimit(e.target.value, wordLimit))}
      onClick={onActivate}
      className={`inline-block w-28 px-2 py-0.5 text-[13px] text-slate-900 bg-white rounded-[3px] focus:outline-none focus:border-blue-700 align-baseline ${
        dashed ? 'border border-dashed border-slate-500' : 'border border-slate-500'
      } placeholder:text-center placeholder:font-bold placeholder:text-slate-900 ${
        active ? 'ring-2 ring-blue-700' : ''
      }`}
    />
    {wordLimit !== undefined && wordLimit > 0 && value.trim() !== '' && (
      <span className="text-[10px] font-mono text-slate-500">
        {value.trim().split(/\s+/).filter(Boolean).length}/{wordLimit}
      </span>
    )}
  </span>
);

/** Inline drop gap for drag families (flow steps, map points). Click assigns the selected card. */
export const InlineDropGap: React.FC<{
  number: number;
  value: string;
  selected: string | null;
  onAssign: () => void;
  onDropKey: (key: string) => void;
  onClear: () => void;
}> = ({ number, value, selected, onAssign, onDropKey, onClear }) => {
  const [over, setOver] = useState(false);
  return (
    <span className="inline-flex items-center gap-0.5 align-baseline">
      <button
        type="button"
        aria-label={value ? `Gap ${number} filled with ${value}` : `Gap ${number} empty`}
        onClick={onAssign}
        onDragOver={e => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault();
          setOver(false);
          const k = e.dataTransfer.getData('text/plain');
          if (k) onDropKey(k);
        }}
        className={`inline-block min-w-[3rem] px-2 py-0.5 text-[13px] font-bold text-center rounded-[3px] transition cursor-pointer border border-dashed align-baseline ${
          over || selected ? 'border-blue-700 bg-blue-50 text-blue-900' : value ? 'border-slate-500 bg-white text-slate-900' : 'border-slate-500 bg-white text-slate-900'
        }`}
      >
        {value || number}
      </button>
      {value && (
        <button
          type="button"
          aria-label={`Clear gap ${number}`}
          onClick={onClear}
          className="text-slate-400 hover:text-slate-900 font-bold cursor-pointer leading-none"
        >
          ×
        </button>
      )}
    </span>
  );
};

/** Split bank pills shared by a drag group. */
export const BankPills: React.FC<{
  bank: string[];
  selected: string | null;
  onSelect: (opt: string | null) => void;
  /** Listening highlight scope root (section id). Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ bank, selected, onSelect, hlPrefix }) => (
  <div className="flex flex-wrap content-start gap-1.5">
    {bank.map((opt, bi) => (
      <button
        key={opt}
        type="button"
        draggable
        onDragStart={e => e.dataTransfer.setData('text/plain', opt)}
        onClick={() => onSelect(selected === opt ? null : opt)}
        title="Activate, then activate a gap — or drag into a gap"
        className={`px-2.5 py-1 border text-[12px] rounded-[3px] transition cursor-grab active:cursor-grabbing ${
          selected === opt ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-800 border-slate-400 hover:border-slate-800'
        }`}
      >
        {hlPrefix ? <HlText text={opt} unitKey={`${hlPrefix}|bank${bi}`} interactive={false} /> : opt}
      </button>
    ))}
    {bank.length === 0 && (
      <span className="text-[11px] text-slate-400 italic">All options placed.</span>
    )}
  </div>
);

/** Table completion group: type answers directly into table cells. */
export const IdpTableGroup: React.FC<{
  qs: Question[];
  answers: Record<string, string>;
  onEdit: (qid: string, v: string) => void;
  flagged?: Set<string>;
  onFocus?: (qid: string) => void;
  /** Listening highlight scope root (section id). Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ qs, answers, onEdit, flagged, onFocus, hlPrefix }) => {
  const def = qs[0]?.tableDef;
  const first = qs[0]?.number;
  const last = qs[qs.length - 1]?.number;
  const instruction =
    qs.find(q => q.instructionLine)?.instructionLine || 'Complete the table below.';
  if (!def || !def.rows || def.rows.length === 0) {
    return null;
  }
  const hl = (suffix: string, t: string, interactive = true) =>
    hlPrefix && t ? <HlText text={t} unitKey={`${hlPrefix}|tbl|${suffix}`} interactive={interactive} /> : t;
  let gi = 0;
  return (
    <div>
      <p className="text-[13px] font-bold text-slate-900">
        {groupRangeLabel(first, last)}
      </p>
      <p className="text-[13px] text-slate-900 mt-0.5">{hl('instr', instruction)}</p>
      {def.title && <p className="text-[13px] font-bold text-slate-900 text-center mt-2">{hl('title', def.title)}</p>}
      <div className="overflow-x-auto mt-2">
        <table className="w-full border-collapse text-[13px]">
          {def.headers && def.headers.length > 0 && (
            <thead>
              <tr>
                {def.headers.map((h, i) => (
                  <th key={i} className="border border-slate-800 px-2 py-1.5 text-center font-bold text-slate-900 bg-gray-50">
                    {hl(`h${i}`, h)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {def.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  const parts = splitBlanks(cell);
                  const isFirstCol = ci === 0;
                  if (parts.length <= 1) {
                    return (
                      <td
                        key={ci}
                        className={`border border-slate-800 px-2 py-1.5 text-slate-900 whitespace-pre-line ${isFirstCol ? 'font-bold' : ''}`}
                      >
                        {hl(`c${ri}-${ci}`, cell)}
                      </td>
                    );
                  }
                  // One input per gap marker, in row-major order. Multiple
                  // gaps may share a single cell ("___ to ___").
                  const nodes: React.ReactNode[] = [];
                  nodes.push(<span key="t0">{hl(`c${ri}-${ci}a0`, parts[0])}</span>);
                  for (let pi = 0; pi < parts.length - 1; pi++) {
                    const q = qs[gi++];
                    if (!q) {
                      nodes.push(<span key={`m${pi}`} className="inline-block w-16 border-b border-slate-400" />);
                    } else {
                      const v = answers[q.id] || '';
                      nodes.push(
                        <span key={`g${pi}-${q.id}`} onClick={() => onFocus && onFocus(q.id)}>
                          <GapBox
                            number={q.number}
                            value={v}
                            onEdit={val => onEdit(q.id, val)}
                            wordLimit={q.wordLimit}
                          />
                          {flagged && flagged.has(q.id) && (
                            <span className="ml-1 text-[10px] font-bold uppercase text-amber-700">Flagged</span>
                          )}
                        </span>
                      );
                    }
                    nodes.push(<span key={`t${pi + 1}`}>{hl(`c${ri}-${ci}a${pi + 1}`, parts[pi + 1])}</span>);
                  }
                  return (
                    <td
                      key={ci}
                      className={`border border-slate-800 px-2 py-1.5 text-slate-900 whitespace-pre-line ${isFirstCol ? 'font-bold' : ''}`}
                    >
                      {nodes}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Flow-chart completion group (type answers): consecutive questions render
 *  as ONE flow. Layout comes from the first question's flowDef (boxes
 *  top-to-bottom, ___ = gap in order); without it each question's prompt is
 *  used as its own box. Several gaps may share one box. A line containing
 *  only `||` branches the boxes below it into a 2-column row (e.g. Q9/Q10
 *  side-by-side like the paper). */
export const IdpFlowTextGroup: React.FC<{
  qs: Question[];
  answers: Record<string, string>;
  onEdit: (qid: string, v: string) => void;
  flagged?: Set<string>;
  onFocus?: (qid: string) => void;
  /** Listening highlight scope root (section id). Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ qs, answers, onEdit, flagged, onFocus, hlPrefix }) => {
  const def = qs[0]?.flowDef;
  const boxes = def?.boxes?.length ? def.boxes : qs.map(q => q.prompt || '');
  const first = qs[0]?.number;
  const last = qs[qs.length - 1]?.number;
  const instruction =
    qs.find(q => q.instructionLine)?.instructionLine || 'Complete the flow-chart below.';
  const hl = (suffix: string, t: string) =>
    hlPrefix && t ? <HlText text={t} unitKey={`${hlPrefix}|ft|${suffix}`} /> : t;
  // Rows of 1 (full width) or 2 (side-by-side) boxes. A `||` marker line
  // switches the boxes below it into 2-column branch rows; bi keeps the
  // original box indices for stable highlight keys.
  const isBranchMarker = (b: string) => b.trim() === '||';
  const rows: { boxes: string[]; bi: number[] }[] = [];
  {
    let grid: { b: string; i: number }[] = [];
    let inGrid = false;
    const flushGrid = () => {
      for (let k = 0; k < grid.length; k += 2) {
        const slice = grid.slice(k, k + 2);
        rows.push({ boxes: slice.map(s => s.b), bi: slice.map(s => s.i) });
      }
      grid = [];
    };
    boxes.forEach((b, i) => {
      if (isBranchMarker(b)) { inGrid = true; return; }
      if (!inGrid) rows.push({ boxes: [b], bi: [i] });
      else grid.push({ b, i });
    });
    flushGrid();
  }
  let gi = 0;
  const renderBox = (box: string, bi: number) => {
    const parts = splitBlanks(box);
    const nodes: React.ReactNode[] = [];
    if (parts.length <= 1) {
      // No gap marker in this box: show its text (if any) plus the next
      // unanswered question's input so no question is ever dropped.
      if (box.trim()) nodes.push(<span key="t">{hl(`b${bi}`, box)}</span>);
      const q = qs[gi++];
      if (q) {
        const v = answers[q.id] || '';
        nodes.push(
          <span key={`g-${q.id}`} onClick={() => onFocus && onFocus(q.id)}>
            <GapBox number={q.number} value={v} onEdit={val => onEdit(q.id, val)} wordLimit={q.wordLimit} />
            {flagged && flagged.has(q.id) && (
              <span className="ml-1 text-[10px] font-bold uppercase text-amber-700">Flagged</span>
            )}
          </span>
        );
      } else if (!box.trim()) {
        nodes.push(<span key="e" className="inline-block w-16 border-b border-slate-400" />);
      }
      return nodes;
    }
    nodes.push(<span key="t0">{hl(`b${bi}a0`, parts[0])}</span>);
    for (let pi = 0; pi < parts.length - 1; pi++) {
      const q = qs[gi++];
      if (!q) {
        nodes.push(<span key={`m${pi}`} className="inline-block w-16 border-b border-slate-400" />);
      } else {
        const v = answers[q.id] || '';
        nodes.push(
          <span key={`g${pi}-${q.id}`} onClick={() => onFocus && onFocus(q.id)}>
            <GapBox number={q.number} value={v} onEdit={val => onEdit(q.id, val)} wordLimit={q.wordLimit} />
            {flagged && flagged.has(q.id) && (
              <span className="ml-1 text-[10px] font-bold uppercase text-amber-700">Flagged</span>
            )}
          </span>
        );
      }
      nodes.push(<span key={`t${pi + 1}`}>{hl(`b${bi}a${pi + 1}`, parts[pi + 1])}</span>);
    }
    return nodes;
  };
  return (
    <div>
      <p className="text-[13px] font-bold text-slate-900">
        {groupRangeLabel(first, last)}
      </p>
      <p className="text-[13px] text-slate-900 mt-0.5">{hl('instr', instruction)}</p>
      {def?.title && <p className="text-[13px] font-bold text-slate-900 text-center mt-2">{hl('title', def.title)}</p>}
      <div className="mt-2 space-y-0 max-w-xl mx-auto">
        {rows.map((row, ri) => (
          <div key={ri}>
            {ri > 0 && (
              row.boxes.length === 1 ? (
                <div className="flex justify-center py-0.5">
                  <ChevronDown className="w-5 h-5 text-slate-900" strokeWidth={2.5} />
                </div>
              ) : (
                <div className="grid grid-cols-2 py-0.5" aria-hidden="true">
                  <div className="flex justify-center">
                    <ChevronDown className="w-5 h-5 text-slate-900" strokeWidth={2.5} />
                  </div>
                  <div className="flex justify-center">
                    <ChevronDown className="w-5 h-5 text-slate-900" strokeWidth={2.5} />
                  </div>
                </div>
              )
            )}
            {row.boxes.length === 1 ? (
              <div className="border border-slate-800 rounded-[3px] px-3 py-2 text-[13px] text-slate-900 bg-white text-center leading-loose whitespace-pre-line">
                {renderBox(row.boxes[0], row.bi[0])}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {row.boxes.map((b, ci) => (
                  <div
                    key={ci}
                    className="border border-slate-800 rounded-[3px] px-3 py-2 text-[13px] text-slate-900 bg-white text-center leading-loose whitespace-pre-line"
                  >
                    {renderBox(b, row.bi[ci])}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {/* Surplus questions with no box left (fewer gaps than questions). */}
        {(() => {
          const extra: React.ReactNode[] = [];
          while (gi < qs.length) {
            const q = qs[gi++];
            const v = answers[q.id] || '';
            extra.push(
              <div key={`x-${q.id}`}>
                <div className="flex justify-center py-0.5">
                  <ChevronDown className="w-5 h-5 text-slate-900" strokeWidth={2.5} />
                </div>
                <div
                  className="border border-slate-800 rounded-[3px] px-3 py-2 text-[13px] text-slate-900 bg-white text-center"
                  onClick={() => onFocus && onFocus(q.id)}
                >
                  <GapBox number={q.number} value={v} onEdit={val => onEdit(q.id, val)} wordLimit={q.wordLimit} />
                  {flagged && flagged.has(q.id) && (
                    <span className="ml-1 text-[10px] font-bold uppercase text-amber-700">Flagged</span>
                  )}
                </div>
              </div>
            );
          }
          return extra;
        })()}
      </div>
    </div>
  );
};

/** Flow-chart group: drag bank pills into step boxes. */
export const IdpFlowGroup: React.FC<{
  qs: Question[];
  answers: Record<string, string>;
  onPick: (qid: string, v: string) => void;
  flagged?: Set<string>;
  onFocus?: (qid: string) => void;
  /** Listening highlight scope root (section id). Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ qs, answers, onPick, flagged, onFocus, hlPrefix }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const options = qs[0]?.options || [];
  const assigned = qs.map(q => answers[q.id] || '').filter(Boolean);
  const bank = options.filter(o => !assigned.includes(o));
  const first = qs[0]?.number;
  const last = qs[qs.length - 1]?.number;
  const instruction =
    qs.find(q => q.instructionLine)?.instructionLine ||
    'Complete the flow-chart. Choose the correct answer and move it into the gap.';

  const place = (qid: string) => {
    if (selected) {
      onPick(qid, selected);
      setSelected(null);
    }
  };

  return (
    <div>
      <p className="text-[13px] font-bold text-slate-900">
        {groupRangeLabel(first, last)}
      </p>
      <p className="text-[13px] text-slate-900 mt-0.5">{hlPrefix ? <HlText text={instruction} unitKey={`${hlPrefix}|fl|instr`} /> : instruction}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 mt-2">
        <div className="space-y-0">
          {qs.map((q, i) => {
            const v = answers[q.id] || '';
            const parts = splitBlanks(q.prompt);
            const stepHl = (suffix: string, t: string) =>
              hlPrefix && t ? <HlText text={t} unitKey={`${hlPrefix}|fl|${q.id}|${suffix}`} /> : t;
            return (
              <div key={q.id} onClick={() => onFocus && onFocus(q.id)}>
                <div className="border border-slate-800 rounded-[3px] px-2 py-1.5 text-[13px] text-slate-900 bg-white">
                  {parts.length === 2 ? (
                    <>
                      {stepHl('a', parts[0])}
                      <InlineDropGap
                        number={q.number}
                        value={v}
                        selected={selected}
                        onAssign={() => place(q.id)}
                        onDropKey={k => {
                          if (options.includes(k)) {
                            onPick(q.id, k);
                            setSelected(null);
                          }
                        }}
                        onClear={() => onPick(q.id, '')}
                      />
                      {stepHl('b', parts[1])}
                    </>
                  ) : (
                    <>
                      {stepHl('full', q.prompt)}{' '}
                      <InlineDropGap
                        number={q.number}
                        value={v}
                        selected={selected}
                        onAssign={() => place(q.id)}
                        onDropKey={k => {
                          if (options.includes(k)) {
                            onPick(q.id, k);
                            setSelected(null);
                          }
                        }}
                        onClear={() => onPick(q.id, '')}
                      />
                    </>
                  )}
                  {flagged && flagged.has(q.id) && (
                    <span className="ml-2 text-[10px] font-bold uppercase text-amber-700">Flagged</span>
                  )}
                </div>
                {i < qs.length - 1 && (
                  <div className="flex justify-start py-0.5 pl-6">
                    <ChevronDown className="w-5 h-5 text-slate-900" strokeWidth={2.5} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <BankPills bank={bank} selected={selected} onSelect={setSelected} hlPrefix={hlPrefix ? `${hlPrefix}|fl|bank` : undefined} />
      </div>
    </div>
  );
};

/** Map-on-image group: plan shown clean (no overlays); candidates answer
 *  from the numbered list on the side. */
export const IdpMapGroup: React.FC<{
  qs: Question[];
  imageUrl: string;
  answers: Record<string, string>;
  onPick: (qid: string, v: string) => void;
  flagged?: Set<string>;
  onFocus?: (qid: string) => void;
  /** Listening highlight scope root (section id). Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ qs, imageUrl, answers, onPick, flagged, onFocus, hlPrefix }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const options = qs[0]?.options || [];
  const assigned = qs.map(q => answers[q.id] || '').filter(Boolean);
  const bank = options.filter(o => !assigned.includes(o));
  const first = qs[0]?.number;
  const last = qs[qs.length - 1]?.number;
  const instruction =
    qs.find(q => q.instructionLine)?.instructionLine ||
    'Label the map. Choose the correct answer and move it into the gap.';

  const assignTo = (qid: string) => {
    if (onFocus) onFocus(qid);
    if (selected) {
      onPick(qid, selected);
      setSelected(null);
    }
  };

  const dropTo = (qid: string, k: string) => {
    if (options.includes(k)) {
      if (onFocus) onFocus(qid);
      onPick(qid, k);
      setSelected(null);
    }
  };

  return (
    <div>
      <p className="text-[13px] font-bold text-slate-900">
        {groupRangeLabel(first, last)}
      </p>
      <p className="text-[13px] text-slate-900 mt-0.5">{hlPrefix ? <HlText text={instruction} unitKey={`${hlPrefix}|mp|instr`} /> : instruction}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 mt-2">
        <div className="border border-slate-400 rounded-[3px] bg-white inline-block max-w-full self-start">
          <img src={imageUrl} alt="Plan diagram" className="block max-w-full h-auto select-none" draggable={false} />
        </div>
        <div className="space-y-3 min-w-0">
          <BankPills bank={bank} selected={selected} onSelect={setSelected} hlPrefix={hlPrefix ? `${hlPrefix}|mp|bank` : undefined} />
          <div className="space-y-1.5">
            {qs.map(q => {
              const v = answers[q.id] || '';
              return (
                <div
                  key={q.id}
                  onClick={() => onFocus && onFocus(q.id)}
                  className="flex items-center gap-2 border border-slate-200 rounded-[3px] bg-gray-50 px-2 py-1.5"
                >
                  <span className="text-[13px] text-slate-900 flex-1 min-w-0 leading-snug">
                    <span className="font-bold font-mono mr-1">{q.number}.</span>
                    {q.prompt?.trim() ? (
                      hlPrefix ? <HlText text={q.prompt} unitKey={`${hlPrefix}|mp|${q.id}|prompt`} /> : q.prompt
                    ) : (
                      <span className="text-slate-400 italic">Label point {q.number}</span>
                    )}
                  </span>
                  <span className="shrink-0">
                    <InlineDropGap
                      number={q.number}
                      value={v}
                      selected={selected}
                      onAssign={() => assignTo(q.id)}
                      onDropKey={k => dropTo(q.id, k)}
                      onClear={() => onPick(q.id, '')}
                    />
                  </span>
                  {flagged && flagged.has(q.id) && (
                    <span className="text-[10px] font-bold uppercase text-amber-700 shrink-0">Flagged</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Summary completion group: ONE boxed summary with inline numbered gaps,
 * exactly like the paper (title once, instruction once, word bank once).
 *
 * Importers split a multi-gap summary into one single-gap question per gap,
 * duplicating the sentence text and filling sibling gaps with their answers
 * (which leaks answers). This component reverses that: it masks sibling
 * answers inside each prompt, merges duplicate sentences, and renders each
 * gap once as an inline input/dropdown.
 */
export const IdpSummaryGroup: React.FC<{
  qs: Question[];
  answers: Record<string, string>;
  onAnswer: (qid: string, v: string) => void;
  flagged?: Set<string>;
  onFocus?: (qid: string) => void;
  /** Listening highlight scope root (section id). Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ qs, answers, onAnswer, flagged, onFocus, hlPrefix }) => {
  const sorted = [...qs].sort((a, b) => a.number - b.number);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const instruction =
    sorted.find(q => q.instructionLine?.trim())?.instructionLine ||
    'Complete the summary below.';
  const options = sorted.find(q => q.options && q.options.length)?.options || [];
  const hasBank = options.length > 0;

  const letterOf = (opt: string) => (opt.trim().charAt(0) || '').toUpperCase();
  const labelOf = (opt: string) => {
    const t = opt.trim();
    const rest = t.slice(1).replace(/^[\s.\)\-:]+/, '').trim();
    return rest ? `${t.charAt(0).toUpperCase()}  ${rest}` : t;
  };
  const valueToLetter = (v: string): string => {
    const t = (v || '').trim();
    if (!t) return '';
    if (/^[A-Za-z]$/.test(t)) return t.toUpperCase();
    const norm = t.toLowerCase();
    const hit = options.find(o => o.trim().toLowerCase() === norm);
    if (hit) return letterOf(hit);
    const hit2 = options.find(o => {
      const rest = o.trim().slice(1).replace(/^[\s.\)\-:]+/, '').trim().toLowerCase();
      return rest === norm;
    });
    if (hit2) return letterOf(hit2);
    return t;
  };

  // Common "Title:" prefix (e.g. "Limestone Processing:") shown once.
  let groupTitle = '';
  const heads = sorted.map(q => {
    const m = (q.prompt || '').trim().match(/^([^:_{]{1,60}):\s*/);
    return m ? m[1].trim() : null;
  });
  if (heads[0] && heads.every(h => h && h.toLowerCase() === heads[0]!.toLowerCase())) {
    groupTitle = heads[0]!;
  }
  const stripTitle = (p: string) => {
    if (!groupTitle) return (p || '').trim();
    return (p || '').trim().replace(new RegExp(`^${groupTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`), '');
  };

  // Phrases that reveal a sibling answer (must be masked elsewhere).
  const phrasesOf = (q: Question): string[] => {
    const out = new Set<string>();
    (q.acceptedAnswers || []).forEach(a => {
      const t = (a || '').trim();
      if (t) out.add(t);
    });
    // Map accepted letters to their option phrases (e.g. "D" -> "Mason").
    (q.acceptedAnswers || []).forEach(a => {
      const t = (a || '').trim();
      const m = t.match(/^([A-Za-z])\b/);
      if (m && hasBank) {
        const L = m[1].toUpperCase();
        options.forEach(o => {
          if (letterOf(o) === L) {
            out.add(o.trim());
            const rest = o.trim().slice(1).replace(/^[\s.\)\-:]+/, '').trim();
            if (rest) out.add(rest);
          }
        });
      }
    });
    if (hasBank) {
      // Also cover the case where the key holds the word but the bank holds "D word".
      (q.acceptedAnswers || []).forEach(a => {
        const norm = (a || '').trim().toLowerCase();
        if (!norm || norm.length < 2) return;
        options.forEach(o => {
          const rest = o.trim().slice(1).replace(/^[\s.\)\-:]+/, '').trim().toLowerCase();
          if (rest === norm || rest.endsWith(' ' + norm) || norm.endsWith(' ' + rest)) {
            out.add(o.trim());
          }
        });
      });
    }
    return [...out].filter(x => x.trim().length >= 3).sort((a, b) => b.length - a.length);
  };
  const phrasesById = new Map<string, string[]>(sorted.map(q => [q.id, phrasesOf(q)]));

  const GAP_TOKEN = (qid: string) => `\u0001GAP:${qid}\u0001`;
  const GAP_RE = /\u0001GAP:([^\u0001]+)\u0001/g;

  const maskSiblings = (text: string, ownIds: Set<string>): string => {
    let out = text;
    sorted.forEach(sib => {
      if (ownIds.has(sib.id)) return;
      (phrasesById.get(sib.id) || []).forEach(ph => {
        const needle = ph.trim();
        if (needle.length < 3) return;
        // Case-insensitive replace; never touch text inside a gap token.
        const insideToken = (str: string, pos: number): boolean => {
          const re = /\u0001GAP:[^\u0001]*\u0001/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(str)) !== null) {
            if (pos >= m.index && pos < m.index + m[0].length) return true;
          }
          return false;
        };
        let idx = out.toLowerCase().indexOf(needle.toLowerCase());
        while (idx !== -1) {
          if (insideToken(out, idx)) {
            idx = out.toLowerCase().indexOf(needle.toLowerCase(), idx + 1);
            continue;
          }
          out = out.slice(0, idx) + GAP_TOKEN(sib.id) + out.slice(idx + needle.length);
          idx = out.toLowerCase().indexOf(needle.toLowerCase(), idx + GAP_TOKEN(sib.id).length);
        }
      });
    });
    return out;
  };

  // Cluster questions sharing the identical sentence: a multi-gap summary
  // sentence is authored as N questions with the SAME prompt holding all N
  // ___ markers (emitted consecutively in gap order). Marker style
  // (___ vs _______ vs ***) and whitespace are ignored for clustering.
  const canonMarkers = (txt: string) => txt.replace(/_{2,}|…|\*{3,}/g, '___');
  const normBase = (p: string) => canonMarkers(stripTitle(p || '')).replace(/\s+/g, ' ').trim();
  const clusters: { key: string; prompt: string; qs: Question[] }[] = [];
  sorted.forEach(q => {
    const base = normBase(q.prompt || '');
    const found = clusters.find(c => c.key === base.toLowerCase());
    if (found) found.qs.push(q);
    else clusters.push({ key: base.toLowerCase(), prompt: base, qs: [q] });
  });
  clusters.sort((a, b) => a.qs[0].number - b.qs[0].number);
  clusters.forEach(c => c.qs.sort((a, b) => a.number - b.number));

  // One template per cluster. Gap i belongs to question i (number order):
  // exact for shared N-gap sentences; degrades gracefully on mismatches
  // (cycles over questions, appends surplus) so no gap is ever dropped.
  const clusterTemplates: string[] = clusters.map(c => {
    const parts = splitBlanks(c.prompt);
    const g = parts.length - 1;
    const k = c.qs.length;
    let tpl = parts[0];
    for (let i = 0; i < g; i++) tpl += GAP_TOKEN(c.qs[i % k].id) + parts[i + 1];
    for (let i = g; i < k; i++) tpl += ' ' + GAP_TOKEN(c.qs[i].id);
    // Mask leaked sibling answers from OTHER clusters (never own cluster).
    const ownIds = new Set(c.qs.map(q => q.id));
    GAP_RE.lastIndex = 0;
    const segs = tpl.split(GAP_RE);
    let rebuilt = '';
    for (let i = 0; i < segs.length; i++) {
      if (i % 2 === 0) rebuilt += maskSiblings(segs[i], ownIds);
      else rebuilt += GAP_TOKEN(segs[i]);
    }
    return rebuilt.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  });

  // Merge fully identical templates (same words AND same gaps), e.g. the
  // leaked-answer style converging after masking. Templates with different
  // gaps are always kept, so no question ever loses its input.
  const seen = new Set<string>();
  const sentences: string[] = [];
  clusterTemplates.forEach(t => {
    GAP_RE.lastIndex = 0;
    const textKey = t.split(GAP_RE).filter((_, i) => i % 2 === 0).join('[]').toLowerCase().replace(/\s+/g, ' ').trim();
    GAP_RE.lastIndex = 0;
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = GAP_RE.exec(t)) !== null) ids.push(m[1]);
    const key = `${textKey}||${ids.sort().join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      sentences.push(t);
    }
  });
  const byId = new Map(sorted.map(q => [q.id, q]));
  const renderGap = (qid: string) => {
    const q = byId.get(qid);
    if (!q) return null;
    const raw = answers[qid] || '';
    if (hasBank) {
      const letter = valueToLetter(raw);
      return (
        <span key={qid} className="inline-flex items-center gap-1 align-baseline" onClick={() => onFocus && onFocus(qid)}>
          <select
            aria-label={`Answer ${q.number}`}
            value={letter.length === 1 ? letter : ''}
            onChange={e => onAnswer(qid, e.target.value)}
            className={`inline-block min-w-[7rem] max-w-full mx-1 px-1.5 py-0.5 text-[13px] bg-white border border-slate-500 text-slate-900 rounded-[3px] focus:outline-none focus:border-blue-700 align-baseline cursor-pointer ${flagged && flagged.has(qid) ? 'ring-2 ring-amber-400' : ''}`}
          >
            <option value="">{q.number}</option>
            {options.map(opt => (
              <option key={opt} value={letterOf(opt)}>
                {labelOf(opt)}
              </option>
            ))}
          </select>
        </span>
      );
    }
    return (
      <span key={qid} onClick={() => onFocus && onFocus(qid)} className="inline-flex align-baseline">
        <GapBox number={q.number} value={raw} onEdit={v => onAnswer(qid, v)} wordLimit={q.wordLimit} active={false} />
        {flagged && flagged.has(qid) && (
          <span className="ml-1 text-[10px] font-bold uppercase text-amber-700 self-center">Flagged</span>
        )}
      </span>
    );
  };

  const renderSentence = (tpl: string, si: number) => {
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    let m: RegExpExecArray | null;
    GAP_RE.lastIndex = 0;
    let gi = 0;
    const segHl = (key: string, t: string) =>
      hlPrefix && t
        ? <HlText key={key} text={t} unitKey={`${hlPrefix}|sum|s${si}|${key}`} />
        : <span key={key}>{t}</span>;
    while ((m = GAP_RE.exec(tpl)) !== null) {
      if (m.index > cursor) nodes.push(segHl(`t-${gi}`, tpl.slice(cursor, m.index)));
      gi++;
      nodes.push(<span key={`g-${si}-${m[1]}-${gi++}`}>{renderGap(m[1])}</span>);
      cursor = m.index + m[0].length;
    }
    if (cursor < tpl.length) nodes.push(segHl('t-end', tpl.slice(cursor)));
    return <span key={si}>{nodes} </span>;
  };

  return (
    <div>
      <p className="text-[13px] font-bold text-slate-900">
        {groupRangeLabel(first.number, last.number)}
      </p>
      <p className="text-[13px] text-slate-900 mt-0.5 mb-2">{hlPrefix ? <HlText text={instruction} unitKey={`${hlPrefix}|sum|instr`} /> : instruction}</p>
      <div className="border border-slate-800 bg-white px-3 py-2.5">
        {groupTitle && <p className="text-[13px] font-bold text-slate-900 text-center mb-1.5">{hlPrefix ? <HlText text={`${groupTitle}:`} unitKey={`${hlPrefix}|sum|title`} /> : `${groupTitle}:`}</p>}
        <p className="text-[13px] text-slate-900 leading-loose">{sentences.map(renderSentence)}</p>
      </div>
      {hasBank && (
        <div className="mt-2 border border-slate-800">
          {Array.from({ length: Math.ceil(options.length / 4) }).map((_, r) => (
            <div key={r} className="grid grid-cols-2 md:grid-cols-4">
              {options.slice(r * 4, r * 4 + 4).map((opt, oi) => {
                const label = labelOf(opt);
                return (
                  <div key={opt} className="border border-slate-300 px-2 py-1.5 text-[12px] text-slate-900 bg-white">
                    {hlPrefix ? <HlText text={label} unitKey={`${hlPrefix}|sum|bank${r * 4 + oi}`} /> : label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Drag-and-drop matching (bank + slot) with click-to-assign fallback, so
 * touch and keyboard (Tab + Enter) both work. Stored value = full option text.
 */
export const IdpDragMatch: React.FC<{
  qid: string;
  options: string[];
  value: string;
  onPick: (v: string) => void;
  /** Highlight scope root. Absent = no highlight units. */
  hlPrefix?: string;
}> = ({ qid, options, value, onPick, hlPrefix }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const assigned = value || '';
  const bank = options.filter(o => o !== assigned);

  const assign = (opt: string) => {
    onPick(opt);
    setSelected(null);
  };

  return (
    <div className="pt-1 space-y-2">
      <button
        type="button"
        aria-label={assigned ? `Matched: ${assigned}. Activate to change.` : 'Drop zone: empty'}
        onClick={() => {
          if (selected) assign(selected);
        }}
        onDragOver={e => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          const key = e.dataTransfer.getData('text/plain');
          if (key && options.includes(key)) assign(key);
        }}
        className={`w-full min-h-[2.25rem] px-2 py-1.5 border-2 border-dashed text-[13px] text-left rounded-sm transition cursor-pointer ${
          dragOver ? 'border-blue-800 bg-blue-50' : assigned ? 'border-slate-700 bg-slate-100' : 'border-slate-400 bg-white'
        }`}
      >
        {assigned ? (
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">
              {hlPrefix ? <HlText text={assigned} unitKey={`${hlPrefix}|dm|${qid}|placed`} interactive={false} /> : assigned}
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear match"
              onClick={e => {
                e.stopPropagation();
                onPick('');
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onPick('');
                }
              }}
              className="text-slate-500 hover:text-slate-900 font-bold px-1 cursor-pointer"
            >
              ×
            </span>
          </span>
        ) : (
          <span className="text-slate-400">{selected ? 'Activate here to place…' : 'Drag here, or select a card below then activate here…'}</span>
        )}
      </button>
      <div
        className="flex flex-wrap gap-1.5"
        role="listbox"
        aria-label="Available options"
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          const key = e.dataTransfer.getData('text/plain');
          if (key && key === assigned) onPick('');
        }}
      >
        {bank.map((opt, bi) => {
          const isSel = selected === opt;
          return (
            <button
              key={opt}
              type="button"
              role="option"
              aria-selected={isSel}
              draggable
              onDragStart={e => e.dataTransfer.setData('text/plain', opt)}
              onClick={() => setSelected(isSel ? null : opt)}
              title="Activate to select, then activate the drop zone"
              className={`px-2 py-1 border text-[12px] rounded-sm transition cursor-grab active:cursor-grabbing ${
                isSel ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-800 border-slate-400 hover:border-slate-800'
              }`}
            >
              {hlPrefix ? <HlText text={opt} unitKey={`${hlPrefix}|dm|${qid}|bank${bi}`} interactive={false} /> : opt}
            </button>
          );
        })}
        {bank.length === 0 && <span className="text-[11px] text-slate-400 italic">All options placed. Drag back here or clear to change.</span>}
      </div>
    </div>
  );
};
