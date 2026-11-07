/**
 * Paragraph-letter bank synthesis for matching_information.
 *
 * Paragraph matching ("Which paragraph contains...?", answers are bare
 * letters like "C") has no printed word bank, so importers often emit
 * `"options": []` — leaving the student dropdown with nothing to choose.
 * This builds the explicit letter range (e.g. ["A".."H"]) from:
 *  1. answer letters across the consecutive group (reliable floor), and
 *  2. paragraph labels parsed from the passage text ({A}, Section A, or
 *     bare "A " paragraph starts), which extend the range to the paper's
 *     full set even when no answer uses the last letters.
 */

/** Leading capital letter of an answer key ("C", "C reason..."). Null otherwise. */
function answerLetter(a: unknown): string | null {
  const m = String(a ?? '').trim().match(/^([A-Z])\b/);
  return m ? m[1] : null;
}

/**
 * Distinct paragraph labels in a passage: {A} markers, "Section A" lines,
 * or bare "A " paragraph starts. Only a contiguous A-starting run is
 * returned (A,B,C…) so stray prose ("A multitude…") can't invent a bank.
 */
export function parseParagraphLabels(text: string): string[] {
  const found = new Set<string>();
  const re = /(?:^|\n)\s*(?:\{([A-Z])\}|(?:Section|SECTION)\s+([A-Z])\b|([A-Z]) )/g;
  let m: RegExpExecArray | null;
  const src = text || '';
  while ((m = re.exec(src)) !== null) {
    const L = m[1] || m[2] || m[3];
    if (L) found.add(L);
  }
  const letters = [...found].sort();
  const run: string[] = [];
  for (let i = 0; i < letters.length; i++) {
    if (letters[i].charCodeAt(0) - 65 !== i) break;
    run.push(letters[i]);
  }
  return run;
}

/** ["A", "B", …] up to and including maxLetter ("H" → 8 entries). */
export function letterRangeBank(maxLetter: string): string[] {
  const n = Math.max(0, maxLetter.charCodeAt(0) - 64);
  return Array.from({ length: n }, (_, k) => String.fromCharCode(65 + k));
}

/**
 * Fill a missing options bank for every consecutive matching_information
 * run whose questions ALL lack options: bank = A..max(answer letters,
 * passage labels). Runs that already carry options, and other types, are
 * left untouched. Accepts Question, draft, and server-normalizer shapes
 * alike (fields read defensively). Mutates in place, returns the same array.
 */
export function synthesizeParagraphBanks<T extends object>(questions: T[], passageText: string): T[] {
  const get = (q: T, k: string): unknown => (q as Record<string, unknown>)[k];
  const labels = parseParagraphLabels(passageText);
  let i = 0;
  while (i < questions.length) {
    if (get(questions[i], 'type') !== 'matching_information') { i++; continue; }
    let j = i;
    while (j + 1 < questions.length && get(questions[j + 1], 'type') === 'matching_information') j++;
    const run = questions.slice(i, j + 1);
    const hasBank = (q: T): boolean => {
      const o = get(q, 'options');
      return Array.isArray(o) && o.length > 0;
    };
    if (!run.some(hasBank)) {
      let max = 0;
      const bump = (L: string | null) => {
        if (L) max = Math.max(max, L.charCodeAt(0) - 64);
      };
      run.forEach(q => {
        const acc = get(q, 'acceptedAnswers');
        (Array.isArray(acc) ? acc : []).forEach(a => bump(answerLetter(a)));
      });
      labels.forEach(L => bump(L));
      if (max > 0) {
        const bank = letterRangeBank(String.fromCharCode(64 + max));
        run.forEach(q => { (q as Record<string, unknown>).options = [...bank]; });
      }
    }
    i = j + 1;
  }
  return questions;
}
