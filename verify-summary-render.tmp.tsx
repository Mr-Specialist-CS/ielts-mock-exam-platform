import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IdpSummaryGroup } from './src/components/StudentPortal/idpInputs';
import type { Question } from './src/types';

const BANK = ['A metal/iron wedge', 'B hammer handle', 'C lift', 'D Mason', 'E patterns', 'F heating', 'G bricks', 'H wood', 'I experts', 'J split', 'K walls', 'L holes'];
const INSTR = 'Complete the following summary of the paragraphs of Reading Passage, using A-L from the following options for each answer. Write your answers in boxes 5-10 on your answer sheet.';

function mk(n: number, prompt: string, ans: string[]): Question {
  return {
    id: `q${n}`, number: n, type: 'summary_completion', prompt,
    instructionLine: INSTR, wordLimit: 1, options: [...BANK],
    acceptedAnswers: ans, explanation: '',
  };
}

// User's exact shape: shared 2-gap sentences, one question per gap.
const qs: Question[] = [
  mk(5, 'When _______ found a suitable block, they began to cut lines of _______ into it.', ['D']),
  mk(6, 'When _______ found a suitable block, they began to cut lines of _______ into it.', ['L']),
  mk(7, '_______ were used and knocked into and generated shockwaves to make stone _______ .', ['A']),
  mk(8, '_______ were used and knocked into and generated shockwaves to make stone _______ .', ['J']),
  mk(9, 'On the other hand, _______ were shaped from clay in a mould and went through a process of _______ for about 12 hours.', ['G']),
  mk(10, 'On the other hand, _______ were shaped from clay in a mould and went through a process of _______ for about 12 hours.', ['F']),
];

const html = renderToStaticMarkup(
  <IdpSummaryGroup qs={qs} answers={{}} onAnswer={() => {}} />
);

const selects = (html.match(/<select/g) || []).length;
const bankCells = BANK.filter(b => html.includes(b.slice(2))).length;
console.log('selects:', selects, '| bank options shown:', bankCells);

// Gap order check: Q5 select must precede Q6 select in the first sentence.
const i5 = html.indexOf('aria-label="Answer 5"');
const i6 = html.indexOf('aria-label="Answer 6"');
const i7 = html.indexOf('aria-label="Answer 7"');
const i10 = html.indexOf('aria-label="Answer 10"');
console.log('order 5<6<7<10:', i5 >= 0 && i5 < i6 && i6 < i7 && i7 < i10);

// Each sentence must appear exactly once (not repeated per question).
const s1count = html.split('began to cut lines of').length - 1;
console.log('sentence-1 occurrences (expect 2: one in text, one mirrored):', s1count);

// Old leaky style must still merge with no leaked answer words.
const leaky: Question[] = [
  mk(5, 'When mason found a suitable block, they began to cut lines of holes into it.', ['D']),
  mk(6, 'When _______ found a suitable block, they began to cut lines of _______ into it.', ['L']),
];
const html2 = renderToStaticMarkup(
  <IdpSummaryGroup qs={leaky} answers={{}} onAnswer={() => {}} />
);
const selects2 = (html2.match(/<select/g) || []).length;
console.log('leaky-style selects (expect 2):', selects2);
const noBank2 = html2.replace(/<select[\s\S]*?<\/select>/g, '').replace(/<div class="border border-slate-300[^<]*<\/div>/g, '');
const leakWords = (noBank2.match(/mason|holes/gi) || []).length;
console.log('leaked answer words outside dropdowns+bank (expect 0):', leakWords);

if (selects !== 6 || bankCells !== 12 || !(i5 >= 0 && i5 < i6 && i6 < i7 && i7 < i10) || selects2 !== 2 || leakWords !== 0) {
  console.error('RENDER CHECK FAILED');
  process.exit(1);
}
console.log('ALL RENDER CHECKS PASS');
