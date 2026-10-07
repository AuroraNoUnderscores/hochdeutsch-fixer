// Which glyphs pdfhooks.mjs replaces, on a made-up page of numbered questions
// with formulas: formula letters (𝑆 is two UTF-16 units), list labels "(a)" "(b)" that
// pdf.js joins with their text but the PDF draws on their own, and a "(b)"
// that occurs again further down. Run with `node dev/pdf/hooks.test.mjs`.
const listeners = {};
let answer = null;
globalThis.document = {
  addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
  dispatchEvent: e => {
    if (e.type !== 'hdfx-pdf-req') return;
    const { id } = JSON.parse(e.detail);
    for (const fn of listeners['hdfx-pdf-res'] || []) fn({ detail: JSON.stringify({ id, data: answer }) });
  },
};
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o?.detail; } };
globalThis.OffscreenCanvas = class { getContext() { return { font: '', measureText: t => ({ width: t.length * 50 }) }; } };
const { prepare, canvas } = await import('../../pdfhooks.mjs');

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
};

// One page: its text items (as pdf.js reports them), the edits pdftext.js
// returned, and the runs of glyphs the PDF draws, in order.
async function page(index, items, edits, runs) {
  answer = { edits, version: 1 };
  const pg = { _pageIndex: index, getTextContent: async () => ({ items: items.map(([str, eol, x = 0, width = 100]) => ({ str, hasEOL: !!eol, transform: [12, 0, 0, 12, x, 0], width, height: 12, fontName: 'f1' })), styles: {} }), view: [0, 0, 600, 800] };
  await prepare(pg);
  const hook = canvas(pg, { fnArray: [], argsArray: [] });
  const gfx = { current: { font: { loadedName: 'f1', name: 'Test' }, fontSize: 12, fontMatrix: [0.001], charSpacing: 0, wordSpacing: 0 } };
  const glyph = ch => (ch === ' ' ? -250 : { unicode: ch, fontChar: ch, width: 500, isSpace: false, isInFont: true });
  return runs.map(run => {
    const r = hook(gfx, [...run].map(glyph));
    return r ? r.glyphs.map(g => (typeof g === 'number' ? (g < -100 ? ' ' : '') : g.unicode)).join('') : null;
  });
}

const sheet = [
  ['(a) Notieren Sie die Grösse'], [' '], ['F'], ['𝑆'], ['für jeden Fall.', true],
  ['(b) Vergleichen Sie den Wert'], [' '], ['|'], ['F'], ['𝑆'], ['|'], ['mit der Ta-', true],
  ['(c) Welcher Wert ist am grössten?', true],
  ['(a) Wo steht das Velo am Morgen?', true, 80, 300],
  ['(b) Wie alt ist das Velo?', true, 80, 200],
];
const line = (i, t) => ({ i, s: 0, e: sheet[i][0].length, t, of: i, line: { justify: false, width: sheet[i][3], cap: 440 } });
const runs = ['(a)', ' Notieren Sie die Grösse', ' F', '𝑆', 'für jeden Fall.',
  '(b)', ' Vergleichen Sie den Wert', ' |', 'F', '𝑆', '|', ' mit der Ta-',
  '(c)', ' Welcher Wert ist am grössten?',
  '(a)', ' Wo steht das Velo am Morgen?',
  '(b)', ' Wie alt ist das Velo?'];
const drawn = await page(0, sheet, [
  { i: 12, s: sheet[12][0].indexOf('grössten'), e: sheet[12][0].indexOf('grössten') + 8, t: 'größten' },
  line(13, '(a) Wo steht das Fahrrad am Morgen?'),
  line(14, '(b) Wie alt ist das Fahrrad?'),
], runs);

check('formula letters and labels above are drawn as they are', drawn.slice(0, 12), Array(12).fill(null));
check('a word changed in place', drawn.slice(12, 14), [null, ' Welcher Wert ist am größten?']);
check('a reflowed line keeps its label and is set in the run after it', drawn.slice(14),
  [null, ' Wo steht das Fahrrad am Morgen?', null, ' Wie alt ist das Fahrrad?']);

// A line drawn in one run is replaced whole, as before.
const one = await page(1, [['Mit dem Velo zur Arbeit.', true, 72, 130]], [{ i: 0, s: 0, e: 24, t: 'Mit dem Fahrrad zur Arbeit.', of: 0, line: { justify: false, width: 130, cap: 450 } }], ['Mit dem Velo zur Arbeit.']);
check('a line in one run', one, ['Mit dem Fahrrad zur Arbeit.']);

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
