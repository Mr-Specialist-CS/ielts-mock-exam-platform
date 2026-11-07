import React, { createContext, useContext, useMemo } from 'react';
import type { TextHighlight } from '../../types';

/**
 * Shared candidate highlighting for Listening (Reading keeps its own
 * paragraph engine). Highlightable text units render via <HlText> inside a
 * <HighlightProvider>; the pen button converts the live DOM selection into
 * offsets with selectionToHl(). Marks are yellow, click-to-remove where
 * interactive, and persisted on the session like Reading marks.
 */

export interface HlSpan {
  id: string;
  start: number;
  end: number;
}

interface HlContextValue {
  highlightsFor: (unitKey: string) => TextHighlight[];
  removeMark: (id: string) => void;
}

const HlContext = createContext<HlContextValue>({ highlightsFor: () => [], removeMark: () => {} });

/** Resolve stored highlights to non-overlapping spans for one unit's text. */
function spansForUnit(text: string, highlights: TextHighlight[]): HlSpan[] {
  const out: HlSpan[] = [];
  for (const hl of highlights) {
    if (!hl.text || !hl.text.trim()) continue;
    const search = hl.text.trim();
    let start = -1;
    let end = -1;
    if (
      typeof hl.startOffset === 'number' &&
      typeof hl.endOffset === 'number' &&
      hl.endOffset > hl.startOffset
    ) {
      const s = Math.max(0, hl.startOffset);
      const e = Math.min(text.length, hl.endOffset);
      if (e > s && text.slice(s, e).trim() === search) {
        start = s;
        end = e;
      } else {
        // Text shifted slightly (re-render): search near the recorded offset.
        const ws = Math.max(0, s - 15);
        const rel = text.slice(ws, Math.min(text.length, e + 15)).indexOf(search);
        if (rel !== -1) {
          start = ws + rel;
          end = start + search.length;
        }
      }
    }
    if (start === -1) {
      const idx = text.indexOf(search);
      if (idx === -1) continue;
      start = idx;
      end = idx + search.length;
    }
    out.push({ id: hl.id, start, end });
  }
  out.sort((a, b) => a.start - b.start || a.end - a.start - (b.end - b.start));
  const clean: HlSpan[] = [];
  let lastEnd = 0;
  for (const m of out) {
    if (m.start >= lastEnd) {
      clean.push(m);
      lastEnd = m.end;
    }
  }
  return clean;
}

export const HighlightProvider: React.FC<{
  highlights: TextHighlight[];
  onRemove: (id: string) => void;
  children: React.ReactNode;
}> = ({ highlights, onRemove, children }) => {
  const grouped = useMemo(() => {
    const byUnit = new Map<string, TextHighlight[]>();
    for (const hl of highlights) {
      if (!hl.unitKey) continue;
      const list = byUnit.get(hl.unitKey);
      if (list) list.push(hl);
      else byUnit.set(hl.unitKey, [hl]);
    }
    return byUnit;
  }, [highlights]);
  const ctx = useMemo<HlContextValue>(
    () => ({
      highlightsFor: (unitKey: string) => grouped.get(unitKey) || [],
      removeMark: onRemove
    }),
    [grouped, onRemove]
  );
  return <HlContext.Provider value={ctx}>{children}</HlContext.Provider>;
};

/**
 * Highlightable text run. Marks render yellow; click removes the mark when
 * interactive. Set interactive={false} inside clickable controls (option
 * labels, bank cards) so clicks fall through to the control — removal there
 * happens via the Clear button.
 */
export const HlText: React.FC<{
  text: string;
  unitKey: string;
  interactive?: boolean;
}> = ({ text, unitKey, interactive = true }) => {
  const { highlightsFor, removeMark } = useContext(HlContext);
  const spans = useMemo(
    () => spansForUnit(text, highlightsFor(unitKey)),
    [text, unitKey, highlightsFor]
  );
  if (spans.length === 0) {
    return <span data-hl-unit={unitKey}>{text}</span>;
  }
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((m, i) => {
    if (m.start > cursor) nodes.push(text.slice(cursor, m.start));
    const snippet = text.slice(m.start, m.end);
    nodes.push(
      interactive ? (
        <mark
          key={`${m.id}-${i}`}
          data-hl-id={m.id}
          className="px-0.5 rounded-sm cursor-pointer bg-yellow-200 text-slate-900 border-b border-yellow-500"
          title="Click to remove highlight"
          onClick={e => {
            e.stopPropagation();
            removeMark(m.id);
          }}
        >
          {snippet}
        </mark>
      ) : (
        <mark
          key={`${m.id}-${i}`}
          data-hl-id={m.id}
          className="px-0.5 rounded-sm bg-yellow-200 text-slate-900 border-b border-yellow-500"
        >
          {snippet}
        </mark>
      )
    );
    cursor = m.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <span data-hl-unit={unitKey}>{nodes}</span>;
};

export interface PendingHl {
  unitKey: string;
  start: number;
  end: number;
  text: string;
}

function unitOffset(el: Element, node: Node, offset: number): number | null {
  try {
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(node, offset);
    return pre.toString().length;
  } catch {
    return null;
  }
}

/**
 * Multi-fragment conversion: EVERY [data-hl-unit] the live selection touches
 * contributes its own clipped mark. This is what makes selections spanning
 * answer inputs (gap sentences, option rows) or several questions highlight
 * instead of silently dropping. Units with no visible selected text are
 * skipped. Returns fragments in document order.
 */
export function selectionToHls(): PendingHl[] {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return [];
  const range = sel.getRangeAt(0);
  const out: PendingHl[] = [];
  const units = document.querySelectorAll('[data-hl-unit]');
  units.forEach(el => {
    let intersects = false;
    try {
      intersects = range.intersectsNode(el);
    } catch {
      return;
    }
    if (!intersects) return;
    const key = el.getAttribute('data-hl-unit');
    if (!key) return;
    const full = el.textContent || '';
    if (!full) return;
    let start: number | null;
    let end: number | null;
    try {
      const unitRange = document.createRange();
      unitRange.selectNodeContents(el);
      const startCmp = range.compareBoundaryPoints(Range.START_TO_START, unitRange);
      const endCmp = range.compareBoundaryPoints(Range.END_TO_END, unitRange);
      start = startCmp <= 0 ? 0 : unitOffset(el, range.startContainer, range.startOffset);
      end = endCmp >= 0 ? full.length : unitOffset(el, range.endContainer, range.endOffset);
    } catch {
      return;
    }
    if (start === null || end === null || !(end > start)) return;
    const raw = full.slice(start, end);
    if (!raw.trim()) return;
    out.push({ unitKey: key, start, end, text: raw });
  });
  return out;
}

/**
 * Convert the live DOM selection into highlight offsets. Only selections
 * fully inside ONE [data-hl-unit] element qualify; anything else (or a
 * collapsed caret) returns null so the pen stays a no-op.
 */
export function selectionToHl(): PendingHl | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const rawText = sel.toString();
  const text = rawText.trim();
  if (!text) return null;
  const elemOf = (n: Node | null): Element | null =>
    !n ? null : n.nodeType === Node.ELEMENT_NODE ? (n as Element) : (n.parentElement as Element | null);
  const anchorUnit = elemOf(sel.anchorNode)?.closest?.('[data-hl-unit]');
  const focusUnit = elemOf(sel.focusNode)?.closest?.('[data-hl-unit]');
  if (!anchorUnit || anchorUnit !== focusUnit) return null;
  const unitKey = anchorUnit.getAttribute('data-hl-unit');
  if (!unitKey) return null;
  const range = sel.getRangeAt(0);
  try {
    const pre = document.createRange();
    pre.selectNodeContents(anchorUnit);
    pre.setEnd(range.startContainer, range.startOffset);
    const leading = rawText.length - rawText.trimStart().length;
    const start = pre.toString().length + leading;
    const end = start + text.length;
    if (!(end > start)) return null;
    return { unitKey, start, end, text };
  } catch {
    return null;
  }
}

/** True when the live selection is non-collapsed inside `selector`. */
export function hasSelectionIn(selector: string): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  if (!sel.toString().trim()) return false;
  const elemOf = (n: Node | null): Element | null =>
    !n ? null : n.nodeType === Node.ELEMENT_NODE ? (n as Element) : (n.parentElement as Element | null);
  const a = elemOf(sel.anchorNode)?.closest?.(selector);
  const f = elemOf(sel.focusNode)?.closest?.(selector);
  return !!a && a === f;
}

export function clearDomSelection(): void {
  try {
    window.getSelection()?.removeAllRanges();
  } catch {}
}
