import React from 'react';
import { HelpCircle, Pencil, Eye, EyeOff, Flag, ChevronLeft, ChevronRight, Check } from 'lucide-react';

/** IDP-style clinical exam shell: slate-900 / gray-100 / white, minimal rounding. */

export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export const IdpTopBar: React.FC<{
  left: string;
  sub?: string;
  timerText: string;
  urgent?: boolean;
  timerNote?: string;
  onHelp: () => void;
  hideToggle?: { hidden: boolean; onToggle: () => void };
  /** Optional pen button that highlights the current text selection. */
  highlightAction?: { onHighlight: () => void; disabled?: boolean; title?: string };
  extra?: React.ReactNode;
}> = ({ left, sub, timerText, urgent, timerNote, onHelp, hideToggle, highlightAction, extra }) => (
  <div className="sticky top-0 z-40 bg-slate-900 text-white border-b border-black">
    <div className="max-w-[1400px] mx-auto px-3 h-11 flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-baseline gap-2">
        <span className="text-[13px] font-bold tracking-wide truncate">{left}</span>
        {sub && <span className="text-[11px] text-slate-300 truncate hidden sm:inline">{sub}</span>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {extra}
        {hideToggle && (
          <button
            type="button"
            onClick={hideToggle.onToggle}
            title={hideToggle.hidden ? 'Show text' : 'Hide text'}
            className="flex items-center gap-1 px-2 h-7 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 border border-slate-600 rounded-sm transition cursor-pointer"
          >
            {hideToggle.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{hideToggle.hidden ? 'Show text' : 'Hide text'}</span>
          </button>
        )}
        {highlightAction && (
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={highlightAction.onHighlight}
            disabled={highlightAction.disabled}
            title={highlightAction.title || 'Highlight selection'}
            aria-label="Highlight selection"
            className="flex items-center gap-1 px-2 h-7 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 border border-slate-600 rounded-sm transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onHelp}
          title="Help"
          className="flex items-center gap-1 px-2 h-7 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 border border-slate-600 rounded-sm transition cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Help</span>
        </button>
        <span
          title={timerNote || 'Time remaining'}
          className={`px-2.5 h-7 inline-flex items-center font-mono text-[13px] font-bold border rounded-sm tabular-nums ${
            urgent ? 'bg-red-700 border-red-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-100'
          }`}
        >
          {timerText}
        </span>
      </div>
    </div>
  </div>
);

export interface PaletteItem {
  id: string;
  number: number;
  answered: boolean;
}

export const IdpFooterNav: React.FC<{
  items: PaletteItem[];
  currentId: string | null;
  flagged: Set<string>;
  onJump: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
  onToggleFlag: () => void;
  backDisabled?: boolean;
  nextDisabled?: boolean;
  nextLabel?: string;
  finish?: { label: string; onClick: () => void; disabled?: boolean } | null;
  statusText?: string;
}> = ({
  items, currentId, flagged, onJump, onBack, onNext, onToggleFlag,
  backDisabled, nextDisabled, nextLabel, finish, statusText
}) => {
  const answeredCount = items.filter(i => i.answered).length;
  return (
    <div className="sticky bottom-0 z-40 bg-gray-100 border-t-2 border-slate-900">
      <div className="max-w-[1400px] mx-auto px-3 py-1.5 flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleFlag}
          title="Flag current question for review"
          className={`flex items-center gap-1 px-2 h-7 text-[11px] font-bold border rounded-sm transition cursor-pointer shrink-0 ${
            currentId && flagged.has(currentId)
              ? 'bg-amber-400 border-amber-500 text-black'
              : 'bg-white border-slate-400 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Flag className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Flag</span>
        </button>
        <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap hidden sm:block" title="Answered questions">
          {answeredCount}/{items.length}
        </span>
        <div className="flex-1 flex items-center gap-1 overflow-x-auto py-0.5" role="navigation" aria-label="Question navigation">
          {items.map(it => {
            const isCurrent = it.id === currentId;
            const isFlagged = flagged.has(it.id);
            return (
              <button
                key={`${it.id}#${it.number}`}
                type="button"
                onClick={() => onJump(it.id)}
                title={`Question ${it.number}${it.answered ? ' (answered)' : ''}${isFlagged ? ' (flagged)' : ''}`}
                className={`relative w-7 h-7 shrink-0 rounded-full border text-[11px] font-mono font-bold transition cursor-pointer ${
                  isCurrent
                    ? 'border-blue-800 ring-2 ring-blue-700 bg-white text-slate-900'
                    : it.answered
                    ? 'bg-slate-800 border-slate-800 text-white'
                    : 'bg-white border-slate-400 text-slate-700 hover:border-slate-800'
                }`}
              >
                {it.answered && !isCurrent ? (
                  <span className="inline-flex items-center justify-center w-full h-full">
                    <Check className="w-3 h-3" strokeWidth={3.5} />
                  </span>
                ) : (
                  it.number
                )}
                {isFlagged && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-600" />
                )}
              </button>
            );
          })}
        </div>
        {statusText && <span className="text-[10px] text-slate-500 whitespace-nowrap hidden xl:block">{statusText}</span>}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            className="flex items-center gap-1 px-3 h-7 text-[11px] font-bold bg-white border border-slate-500 text-slate-800 rounded-sm hover:bg-slate-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled}
            className="flex items-center gap-1 px-3 h-7 text-[11px] font-bold bg-slate-900 border border-slate-900 text-white rounded-sm hover:bg-slate-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {nextLabel || 'Next'}
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          {finish && (
            <button
              type="button"
              onClick={finish.onClick}
              disabled={finish.disabled}
              className="px-3 h-7 text-[11px] font-bold bg-blue-800 border border-blue-900 text-white rounded-sm hover:bg-blue-700 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              {finish.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const IdpHelpModal: React.FC<{
  title: string;
  lines: string[];
  onClose: () => void;
}> = ({ title, lines, onClose }) => (
  <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="max-w-lg w-full bg-white border-2 border-slate-900 rounded-sm shadow-2xl max-h-[80vh] flex flex-col"
      onClick={e => e.stopPropagation()}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between px-4 h-11 bg-slate-900 text-white shrink-0">
        <span className="text-[13px] font-bold">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="px-2 h-7 text-[11px] font-bold border border-slate-500 rounded-sm hover:bg-slate-700 transition cursor-pointer"
        >
          Close
        </button>
      </div>
      <ul className="p-4 space-y-2 overflow-y-auto text-[12px] text-slate-800 leading-relaxed list-disc list-inside">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  </div>
);
