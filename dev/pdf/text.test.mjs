// How pdftext.js reads and resets a PDF's paragraphs, on made-up pages: a
// hyphen standing for a shared ending ("Korrektur- und …") is kept, and a
// justified paragraph's short last line that has to take a full line's words
// is set as wide as the paragraph's other lines. Run with `node dev/pdf/text.test.mjs`.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.HD_ENGINE = require('../../engine.js');
globalThis.browser = {
  storage: { local: { get: async () => ({ llm: false }) } },
  runtime: { sendMessage: async () => null },
};
globalThis.window = globalThis;
globalThis.location = { href: 'https://example.com/a.pdf' };
globalThis.OffscreenCanvas = class { getContext() { return { font: '', measureText: t => ({ width: t.length * 50 }) }; } };
await import('../../pdftext.js');
const T = globalThis.HD_PDFTEXT;

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok ? '' : `\n      ${detail}`));
};

// A page of one paragraph: its lines from the top, each [text, width], as
// pdf.js reports them (one item per line, 12 points high, 15 apart).
function convert(lines, width = 400) {
  const items = lines.map(([str, w], n) => ({ str, eol: n < lines.length - 1, t: [12, 0, 0, 12, 50, 700 - 15 * n], w: w ?? width, h: 12, f: 'f1', ff: 'serif' }));
  return new Promise(resolve => T.convertPage({ page: 0, items, view: [0, 0, 600, 800] }, ({ edits }) => resolve(edits), () => {}));
}
const text = edits => edits.filter(e => e.t).map(e => e.t).join(' ');

// 1. "Korrektur-" at a line's end, "und" on the next: the hyphen is the shared
//    ending's, not a word broken in two.
{
  const edits = await convert([
    ['Wir danken allen für die vielen Hinweise mit dem Velo und für zahlreiche Korrektur-'],
    ['und Verbesserungsvorschläge zu diesem Skript, das hier im Kanton gelesen wird.', 330],
  ]);
  const t = text(edits);
  check('a hyphen before "und" stays, with its space', /Korrektur- und Verbesserungsvorschläge/.test(t), t);
  check('the paragraph is converted', /Fahrrad/.test(t), t);
}
// …while a word hyphenated at a line end is still one word.
{
  const edits = await convert([
    ['Wir danken allen für die vielen Hinweise und das Velo, das hier im Verbesse-'],
    ['rungsvorschlag zu diesem Skript genannt wird, das im Kanton gelesen wird.', 330],
  ]);
  const t = text(edits);
  check('a word hyphenated at a line end is joined', /Verbesserungsvorschlag/.test(t) && !/Verbesse- rungs/.test(t), t);
}

// 2. A justified paragraph that grows by more than its last line can take: the
//    old last line becomes a full line, set as wide as the others.
{
  const full = 'Das Velo steht vor dem Haus und das Velo steht dort auch am Abend noch';
  const edits = await convert([[full], [full], [full], ['Das Velo steht vor dem Haus und das Velo steht dort.', 300]], 360);
  const last = edits.filter(e => e.line).pop();
  check('words go to a new line below', !!last?.line.more?.length, JSON.stringify(last?.line));
  check('the old last line is justified as wide as the others', last?.line.justify === true && Math.abs(last.line.width - 360) < 0.5,
    JSON.stringify(last?.line));
}

// 3. The highlights: a reset line marks just its changed words, in lines below too.
{
  const full = 'Das Velo steht vor dem Haus und das Velo steht dort auch am Abend noch';
  const edits = await convert([[full], [full], [full], ['Das Velo steht vor dem Haus und das Velo steht dort.', 300]], 360);
  const lines = edits.filter(e => e.line).flatMap(e => [e, ...(e.line.more || []).map(m => ({ t: m.text, marks: m.marks }))]);
  const marked = lines.flatMap(e => e.marks.map(([a, b]) => e.t.slice(a, b)));
  check('every changed word is marked, and nothing else', marked.length > 0 && marked.every(w => w === 'Fahrrad'), JSON.stringify(marked));
  const count = lines.reduce((n, e) => n + (e.t.match(/Fahrrad/g) || []).length, 0);
  check('as often as it is there', marked.length === count, `${marked.length} marks, ${count} times Fahrrad`);
  const infos = lines.flatMap(e => e.marks.map(m => m[2]));
  check('each mark says what it was, and why, for the card on hover',
    infos.every(i => i?.from === 'Velo' && i.to === 'Fahrrad' && i.note === 'Swiss word'), JSON.stringify(infos[0]));
}

// 4. A word changed in its line (a paragraph in two fonts is not reset) says so too.
{
  const items = [
    { str: 'Das Velo steht ', eol: false, t: [12, 0, 0, 12, 50, 700], w: 90, h: 12, f: 'f1', ff: 'serif' },
    { str: 'vor dem Haus.', eol: false, t: [12, 0, 0, 12, 140, 700], w: 80, h: 12, f: 'f2', ff: 'serif' },
  ];
  const edits = await new Promise(resolve => T.convertPage({ page: 1, items, view: [0, 0, 600, 800] }, ({ edits }) => resolve(edits), () => {}));
  check('an edit in place carries its info', edits.length === 1 && edits[0].t === 'Fahrrad' && edits[0].info?.from === 'Velo' && edits[0].info.note === 'Swiss word',
    JSON.stringify(edits));
}

// 5. LaTeX's old encoding: "ü" is "¨" and "u", in two items ("Fl¨" "ussigkeit").
//    The words read as written, and an edit replaces the accent with its letter.
{
  const item = (str, x, w) => ({ str, eol: false, t: [12, 0, 0, 12, x, 700], w, h: 12, f: 'f1', ff: 'serif' });
  const items = [item('Die Fl¨', 50, 40), item('ussigkeit steht im Dewargef¨', 86, 150), { ...item('ass beim Velo.', 233, 80), eol: true }];
  const edits = await new Promise(resolve => T.convertPage({ page: 2, items, view: [0, 0, 600, 800] }, ({ edits }) => resolve(edits), () => {}));
  const after = items.map((it, i) => {
    let s = it.str;
    for (const e of edits.filter(e => e.i === i).sort((a, b) => b.s - a.s)) s = s.slice(0, e.s) + e.t + s.slice(e.e);
    return s;
  }).join('');
  check('a word with a LaTeX accent reads as written, and is converted', after === 'Die Flüssigkeit steht im Dewargefäß beim Fahrrad.', after);
}

// 6. Small print. Letter-spaced text, which pdf.js reads with a space between
//    every letter, its word gaps looking the same; a superscript against its
//    word; lines a size apart are not one paragraph; a table's row is no line.
{
  const run = items => new Promise(resolve => T.convertPage({ page: 3 + run.n++, items, view: [0, 0, 600, 800] }, ({ edits }) => resolve(edits), () => {}));
  run.n = 0;
  const at = (str, x, y, size, w, eol = false) => ({ str, eol, t: [size, 0, 0, size, x, y], w, h: size, f: 'f1', ff: 'sans-serif' });
  const apply = (items, edits) => items.map((it, i) => {
    let s = it.str;
    for (const e of edits.filter(e => e.i === i).sort((a, b) => b.s - a.s)) s = s.slice(0, e.s) + e.t + s.slice(e.e);
    return s;
  });
  let items = [at('D a s V e l o s t e h t v o r d e m S p i t a l .', 50, 700, 5, 150, true)];
  check('a letter-spaced line: its words found again', apply(items, await run(items))[0].replace(/ /g, '') === 'DasFahrradstehtvordemKrankenhaus.', apply(items, await run(items))[0]);
  items = [at('D a s', 50, 700, 5, 12), at(' ', 62, 700, 5, 4), at('V e l o', 66, 700, 5, 14), at(' ', 80, 700, 5, 4), at('i s t', 84, 700, 5, 10), at(' ', 94, 700, 5, 4), at('g r o s s .', 98, 700, 5, 20, true)];
  const got = apply(items, await run(items)).join('');
  check('letter-spaced words, each a piece', /Fahrrad/.test(got) && /groß/.test(got), got);
  items = [at('Das Velo', 50, 700, 11, 45), at('1', 95, 704, 7, 4), at(' steht hier.', 99, 700, 11, 50, true)];
  check('a word before a superscript is a word', /Fahrrad/.test(apply(items, await run(items))[0]), JSON.stringify(apply(items, await run(items))));
  items = [at('Das Velo steht vor dem Spital.', 50, 700, 11, 150, true), at('Kleine Schrift: die Offerte ist gross.', 50, 686, 9, 150, true)];
  const two = await run(items);
  check('a line a size smaller is its own paragraph', apply(items, two)[1].startsWith('Kleine Schrift: das Angebot'), JSON.stringify(apply(items, two)));
  items = [at('Velo', 50, 700, 11, 20), at('Trottoir', 150, 700, 11, 40, true), at('Offerte', 50, 686, 11, 35), at('Spital', 150, 686, 11, 30, true)];
  check('a table keeps its cells', JSON.stringify(apply(items, await run(items))) === JSON.stringify(['Fahrrad', 'Bürgersteig', 'Angebot', 'Krankenhaus']), JSON.stringify(apply(items, await run(items))));
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
