// Which glyphs pdfhooks.mjs replaces, on a made-up page of numbered questions
// with formulas: formula letters (𝑆 is two UTF-16 units), list labels "(a)" "(b)" that
// pdf.js joins with their text but the PDF draws on their own, and a "(b)"
// that occurs again further down. Run with `node dev/pdf/hooks.test.mjs`.
const listeners = {};
let answer = null;
globalThis.document = {
  documentElement: { hasAttribute: () => false },
  addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
  dispatchEvent: e => {
    if (e.type !== 'hdfx-pdf-req') return;
    const { id } = JSON.parse(e.detail);
    for (const fn of listeners['hdfx-pdf-res'] || []) fn({ detail: JSON.stringify({ id, data: answer }) });
  },
};
globalThis.MutationObserver = class { observe() {} };
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o?.detail; } };
globalThis.OffscreenCanvas = class { getContext() { return { font: '', measureText: t => ({ width: t.length * 50 }) }; } };
const { prepare, canvas, textStream } = await import('../../pdfhooks.mjs');

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
};

// One page: its text items (as pdf.js reports them), the edits pdftext.js
// returned, and the runs of glyphs the PDF draws, in order.
async function page(index, items, edits, runs, fontName = 'f1') {
  answer = { edits, version: 1 };
  const pg = { _pageIndex: index, getTextContent: async () => ({ items: items.map(([str, eol, x = 0, width = 100]) => ({ str, hasEOL: !!eol, transform: [12, 0, 0, 12, x, 0], width, height: 12, fontName: 'f1' })), styles: {} }), view: [0, 0, 600, 800] };
  await prepare(pg);
  const hook = canvas(pg, { fnArray: [], argsArray: [] });
  const gfx = { current: { font: { loadedName: fontName, name: 'Test' }, fontSize: 12, fontMatrix: [0.001], charSpacing: 0, wordSpacing: 0 } };
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

// A word changed in place that grows at the end of its line: the text layer
// gets the item as wide as it was drawn, so its highlight lies on the word.
{
  answer = { edits: [{ i: 0, s: 9, e: 13, t: 'Fahrrad', lineLast: 0, room: 100 }], version: 1 };
  const items = [{ str: 'Er fährt Velo', hasEOL: true, transform: [12, 0, 0, 12, 72, 0], width: 72, height: 12, fontName: 'f1' }];
  const pg = { _pageIndex: 2, view: [0, 0, 600, 800], getTextContent: async () => ({ items, styles: {} }),
    streamTextContent: () => new ReadableStream({ start(c) { c.enqueue({ items: items.map(it => ({ ...it })), styles: {} }); c.close(); } }) };
  await prepare(pg);
  const hook = canvas(pg, { fnArray: [], argsArray: [] });
  const gfx = { current: { font: { loadedName: 'f1', name: 'Test' }, fontSize: 12, fontMatrix: [0.001], charSpacing: 0, wordSpacing: 0 } };
  const glyph = ch => (ch === ' ' ? -250 : { unicode: ch, fontChar: ch, width: 500, isSpace: false, isInFont: true });
  hook(gfx, [...'Er fährt Velo'].map(glyph));
  const reader = textStream(pg, { disableNormalization: true }).getReader();
  const { value } = await reader.read();
  check('a grown word: the text layer item as wide as drawn', value.items.map(it => [it.str, Math.round(it.width), it.transform[4]]), [['Er fährt Fahrrad', 90, 72]]);
}

// A letter the font lacks, from the installed font, measured in the font's own
// units: 1000 per em here, 500 for a font whose fontMatrix is 0.002.
{
  answer = { edits: [{ i: 0, s: 0, e: 4, t: 'Maß' }], version: 1 };
  for (const [idx, fm, want] of [[3, 0.001, 500], [4, 0.002, 250]]) {
    const pg = { _pageIndex: idx, view: [0, 0, 600, 800], getTextContent: async () => ({ items: [{ str: 'Mass', transform: [12, 0, 0, 12, 0, 0], width: 24, height: 12, fontName: 'f' + idx }], styles: {} }) };
    await prepare(pg);
    const font = { loadedName: 'f' + idx, name: 'Test', fontMatrix: [fm] };
    const gfx = { current: { font, fontSize: 12, fontMatrix: [fm], charSpacing: 0, wordSpacing: 0 } };
    const r = canvas(pg, { fnArray: [], argsArray: [] })(gfx, [...'Mass'].map(ch => ({ unicode: ch, fontChar: ch, width: 0.5 / fm, isSpace: false, isInFont: true })));
    check(`ß from the installed font, fontMatrix ${fm}`, r.glyphs.find(g => g.unicode === 'ß')?.width, want);
  }
}

// LaTeX draws "ü" as "¨" in a run of its own, then "u" ("Die f" "¨" "ur …"), and
// pdf.js joins them into items that end in the accent. A reset line is kept run
// by run as long as it reads as before, its accents included, and set from where
// it changes, also in the runs of its later items; a "ü" the font lacks is its
// own "¨" over its own "u".
{
  const items = [['Die f¨', false, 72, 30], ['ur das Velo', true, 100, 60]];
  const runs = ['Die f', '¨', 'ur das Velo'];
  const drawn = await page(5, items, [
    { i: 0, s: 0, e: 6, t: 'Die für das Fahrrad', of: 0, line: { justify: false, width: 90, cap: 400 } },
    { i: 1, s: 0, e: 11, t: '', of: 0 },
  ], runs);
  check('runs reading as before stay, the rest is set where it changes', drawn, [null, null, 'ur das Fahrrad']);
  const answer2 = await page(6, [['Die Gr¨', false, 72, 30], ['osse', true, 100, 20]], [
    { i: 0, s: 0, e: 7, t: 'Die Größe', of: 0, line: { justify: false, width: 50, cap: 400 } }, { i: 1, s: 0, e: 4, t: '', of: 0 }], ['Die Gr', '¨', 'osse']);
  check('a letter after a kept accent is its bare letter', answer2, [null, null, 'oße']);
  const one = await page(7, [['Er f¨ahrt Velo', true, 72, 80]], [{ i: 0, s: 0, e: 14, t: 'Er fährt Fahrrad', of: 0, line: { justify: false, width: 80, cap: 400 } }], ['Er f¨ahrt Velo'], 'latex');
  check('a letter the font lacks: its accent over its letter', one, ['Er f¨ahrt Fahrrad']);
}

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
