// The text a PDF shows, converted (both builds). The viewer's pdf.js is patched
// in three places (tools/sync_pdfjs.py) to call globalThis.__hdfx: before a
// page is drawn its converted text must be ready (prepare); while it is drawn,
// the glyphs of changed words are swapped and a reflowed paragraph is set in
// its lines (canvas); and the text layer for selecting, copying and finding
// reads the converted words (textStream). The text itself is converted by the
// content script (pdftext.js), asked through events on the document.

// Talking to pdfview.js: requests as events on the document, answered by id.
let seq = 0;
const waiting = new Map();
document.addEventListener('hdfx-pdf-res', e => {
  const { id, data } = JSON.parse(e.detail);
  waiting.get(id)?.(data);
  waiting.delete(id);
});
function ask(type, payload) {
  return new Promise(resolve => {
    const id = ++seq;
    waiting.set(id, resolve);
    document.dispatchEvent(new CustomEvent('hdfx-pdf-req', { detail: JSON.stringify({ id, type, payload }) }));
  });
}
// pdfview.js may ask for a page to be drawn again once the model has spoken
document.addEventListener('hdfx-pdf-redraw', e => redraw(JSON.parse(e.detail)));

const KEEP = /\s/u;
// combining accents, and the glyphs that draw them on their own
const SPACING = { '\u0308': ['¨'], '\u0301': ['´', 'ˊ'], '\u0300': ['`', 'ˋ'], '\u0302': ['ˆ', '^'], '\u0303': ['˜', '~'], '\u030a': ['˚'],
  '\u0327': ['¸'], '\u030c': ['ˇ'], '\u0306': ['˘'], '\u0307': ['˙'], '\u030b': ['˝'], '\u0304': ['¯', 'ˉ'], '\u0328': ['˛'] };
const norm = s => s.normalize('NFKC');

// Per page: the original text (items as pdf.js extracts them), the edits
// pdfview.js returned, and the page's non-space characters in order (keys), to
// find which drawn glyphs a changed word is made of.
const pages = new Map();      // pageIndex -> Promise<state>
const ready = new Map();      // pageIndex -> state, once known

function buildKeys(items, edits) {
  const keys = [];   // chars
  const at = [];     // [item, offset] per key char
  const itemStart = [];
  items.forEach((it, n) => {
    itemStart[n] = keys.length;
    const s = it.str || '';
    // by code point: a formula's 𝑆 or 𝛼 is two UTF-16 units, normalised to one
    // letter; keys are UTF-16 units, as the glyphs' are (canvas below)
    let o = 0;
    for (const cp of s) {
      const nn = norm(cp);
      for (let u = 0; u < nn.length; u++) if (!KEEP.test(nn[u])) { keys.push(nn[u]); at.push([n, o]); }
      o += cp.length;
    }
  });
  // each edit as a range of key positions
  const byItem = new Map();
  for (const ed of edits) (byItem.get(ed.i) || byItem.set(ed.i, []).get(ed.i)).push(ed);
  const ranges = [];
  for (const ed of edits) {
    let k0 = -1, k1 = -1;
    for (let k = itemStart[ed.i]; k < keys.length && at[k][0] === ed.i; k++) {
      const o = at[k][1];
      if (o >= ed.s && o < ed.e) { if (k0 < 0) k0 = k; k1 = k + 1; }
    }
    if (k0 >= 0) ranges.push({ k0, k1, text: ed.t, line: ed.line, of: ed.of, item: ed.i, room: ed.room, lineLast: ed.lineLast });
  }
  ranges.sort((a, b) => a.k0 - b.k0);
  // where each reflowed line's keys end, past the runs that draw its start
  const lineEnd = new Map();
  for (const r of ranges) if (r.of != null) lineEnd.set(r.of, Math.max(lineEnd.get(r.of) ?? 0, r.k1));
  // The pieces of each line, as pdftext.js has them (lineRoom): a line, or its
  // part before a wide gap (a margin note, a table's next column), named by its
  // last item; and how far each may grow at its end.
  const pieceOf = [];
  let piece = [];
  const close = () => { for (const i of piece) pieceOf[i] = piece[piece.length - 1]; piece = []; };
  items.forEach((it, n) => {
    if ((it.str || '').trim()) {
      const prev = items[piece[piece.length - 1]];
      const size = prev && (Math.hypot(prev.transform[2], prev.transform[3]) || prev.height || 10);
      if (prev && it.transform[4] - (prev.transform[4] + (prev.width || 0)) > size * 1.5) close();
      piece.push(n);
    }
    if (it.hasEOL) close();
  });
  close();
  const roomOf = new Map();
  for (const ed of edits) if (ed.lineLast != null) roomOf.set(ed.lineLast, ed.room || 0);
  return { keys: keys.join(''), ranges, byItem, keyItem: at.map(a => a[0]), keyAt: at.map(a => a[1]), itemStart, lineEnd, pieceOf, roomOf };
}

// A line's new text begins with what a run draws (its keys): the rest of the
// text, for the runs after it; or null. An accent drawn on its own (LaTeX draws
// "ü" as "¨", then "u") is the accent of the letter next to it, before or after.
const MARK = /\p{M}/u;
function keep(drawn, text) {
  // the text letter by letter, each with its accents still to be drawn
  const cl = [...text].map(cp => {
    const parts = [...norm(cp).normalize('NFD')].filter(c => !KEEP.test(c));
    return { raw: cp, bases: parts.filter(c => !MARK.test(c)), marks: parts.filter(c => MARK.test(c)), touched: false };
  });
  const done = x => !x.bases.length && !x.marks.length;
  let c = 0;                                   // the first letter not all drawn
  const next = () => { while (c < cl.length && done(cl[c])) c++; return cl[c]; };
  let last = null;                             // the letter drawn last
  for (const ch of drawn) {
    const x = next();
    if (MARK.test(ch)) {
      // after its letter (a combining accent), or before it (LaTeX's)
      const own = last && !last.bases.length && last.marks.includes(ch) ? last : x && x.marks.includes(ch) ? x : null;
      if (!own) return null;
      own.marks.splice(own.marks.indexOf(ch), 1);
      own.touched = true;
      continue;
    }
    if (!x || x.bases[0] !== ch) return null;
    x.bases.shift();
    x.touched = true;
    last = x;
  }
  // what is left, as written where none of it was drawn yet
  const rest = cl.map(x => (!x.touched ? x.raw : (x.bases.join('') + x.marks.join('')).normalize('NFC'))).join('').replace(/^\s+/, '');
  return rest ? rest : null;
}

// An item's text with its edits, and where the changed words are in it, for
// the highlights: [start, end, info] (an edit without marks is one changed word
// as a whole; info, what it was and why it changed, is for the card on hover).
function applyEdits(str, list) {
  if (!list?.length) return { str, marks: [] };
  let out = '', pos = 0;
  const marks = [];
  for (const ed of [...list].sort((a, b) => a.s - b.s)) {
    out += str.slice(pos, ed.s);
    for (const [a, b, info = ed.info] of ed.marks || [[0, ed.t.length]]) if (b > a) marks.push([out.length + a, out.length + b, info]);
    out += ed.t;
    pos = ed.e;
  }
  return { str: out + str.slice(pos), marks };
}

// A PDF with no text on any of its first pages is a scan. Chrome's own viewer
// reads those (it runs OCR), which this one cannot, and there is nothing here to
// convert: so the build that can (pdfview.js, Chromium) hands the PDF back.
let scanCheck = null;
function scanned(page) {
  scanCheck ||= (async () => {
    const tr = page._transport;
    let seen = 0;
    for (let i = 1; i <= 5; i++) {
      let p;
      try { p = await tr.getPage(i); } catch { break; }       // past the last page
      seen++;
      const tc = await p.getTextContent({ __hdfxRaw: true });   // raw: the hook would come back to prepare
      if (tc.items.some(it => typeof it.str === 'string' && /\S/.test(it.str))) return false;
    }
    return seen > 0;
  })().catch(() => false);
  return scanCheck;
}

function prepare(page) {
  const idx = page._pageIndex;
  if (!pages.has(idx)) {
    pages.set(idx, (async () => {
      if (await scanned(page)) ask('image-only', {});
      const tc = await page.getTextContent({ __hdfxRaw: true, disableNormalization: true });
      const items = tc.items.filter(it => typeof it.str === 'string');
      const lite = items.map(it => ({ str: it.str, eol: !!it.hasEOL, t: it.transform, w: it.width, h: it.height, f: it.fontName, ff: tc.styles[it.fontName]?.fontFamily }));
      const { edits = [], version = 0 } = (await ask('page', { page: idx, items: lite, view: page.view })) || {};
      const state = { items, edits, version, view: page.view, ...buildKeys(items, edits) };
      ready.set(idx, state);
      return state;
    })().catch(err => { console.error('[Hochdeutsch-Fixer]', err); return null; }));
  }
  return pages.get(idx).then(() => undefined);
}

// Model results can come after a page was first drawn; then the viewer draws
// it again (onRedraw: what that takes depends on the viewer).
const redrawers = [];
export const onRedraw = fn => redrawers.push(fn);
function redraw({ page: idx, edits, version }) {
  const old = ready.get(idx);
  if (!old || old.version >= version) return;
  const state = { items: old.items, edits, version, view: old.view, ...buildKeys(old.items, edits) };
  ready.set(idx, state);
  pages.set(idx, Promise.resolve(state));
  for (const fn of redrawers) fn(idx);
}

// Glyphs seen per font, so a changed word can be drawn in the document's own
// font. Letters the font does not have (a Swiss document's subset never has ß)
// come from the installed font of the same family (styleOf below).
const fontGlyphs = new Map();   // loadedName -> Map(char -> glyph)
const measureCtx = new OffscreenCanvas(1, 1).getContext('2d');
const SET_FONT = 37, SHOW_TEXT = 44;
// how far a run may be squeezed to make room for a longer word, at most
const MIN_SCALE = 0.85;

function learn(font, glyphs) {
  let map = fontGlyphs.get(font);
  if (!map) fontGlyphs.set(font, (map = new Map()));
  for (const g of glyphs) {
    if (typeof g !== 'object' || !g || !g.unicode || g.unicode.length !== 1) continue;
    const prev = map.get(g.unicode);
    if (!prev || (!prev.isInFont && g.isInFont)) map.set(g.unicode, g);
  }
  return map;
}

function scanOperators(state, ops) {
  if (!ops) return;
  const { fnArray, argsArray } = ops;
  let font = state.scanFont ?? null;
  for (let i = state.scanned ?? 0; i < fnArray.length; i++) {
    if (fnArray[i] === SET_FONT) font = argsArray[i][0];
    else if (fnArray[i] === SHOW_TEXT && font) learn(font, argsArray[i][0]);
  }
  state.scanned = fnArray.length;
  state.scanFont = font;
}

// The installed font closest to a PDF font: its own family when the system has
// it ("ABCDEF+Arial-BoldMT" is Arial, bold), else pdf.js's generic family.
const FAMILIES = [
  [/^(arial|helvetica|liberationsans|arimo|nimbussans)/i, 'Arial'],
  [/^(timesnewroman|times|liberationserif|tinos|nimbusroman)/i, '"Times New Roman"'],
  [/^(couriernew|courier|liberationmono|cousine|nimbusmono)/i, '"Courier New"'],
  [/^georgia/i, 'Georgia'], [/^verdana/i, 'Verdana'], [/^calibri/i, 'Calibri'], [/^cambria/i, 'Cambria'],
  [/^segoeui/i, '"Segoe UI"'], [/^tahoma/i, 'Tahoma'], [/^trebuchet/i, '"Trebuchet MS"'],
  [/^garamond/i, 'Garamond'], [/^centurygothic/i, '"Century Gothic"'],
  // LaTeX documents: TeX Gyre and URW clones of the classic families, and their font file names
  [/^(bookantiqua|palatino|texgyrepagella|tgpagella|pagella|urwpalladio|palladio|p052|newpx|pxfonts|ppl[rb])/i, '"Palatino Linotype", Palatino, "TeX Gyre Pagella", "URW Palladio L", P052, "Book Antiqua"'],
  [/^(texgyretermes|tgtermes|newtx|txfonts|nimbusromno9|ptm[rb])/i, '"Times New Roman", Times, "TeX Gyre Termes", "Nimbus Roman"'],
  [/^(texgyreheros|tgheros|nimbussanl|phv[rb])/i, 'Arial, Helvetica, "TeX Gyre Heros", "Nimbus Sans"'],
  [/^(texgyrecursor|tgcursor|nimbusmonl|pcr[rb])/i, '"Courier New", Courier, "TeX Gyre Cursor", "Nimbus Mono PS"'],
  [/^(texgyrebonum|bookman|urwbookman|pbk[lr])/i, '"Bookman Old Style", Bookman, "TeX Gyre Bonum", "URW Bookman"'],
  [/^(texgyreschola|centuryschoolbook|c059|pnc[rb])/i, '"Century Schoolbook", "TeX Gyre Schola", C059'],
  [/^(lmroman|latinmodern|cmr|cmbx|cmti|cmsl|sfrm|cmuserif)/i, '"Latin Modern Roman", "CMU Serif", "Computer Modern", serif'],
  [/^(lmsans|cmss|cmusans)/i, '"Latin Modern Sans", "CMU Sans Serif", sans-serif'],
];
const fontStyles = new Map();
function styleOf(font) {
  let st = fontStyles.get(font.loadedName);
  if (st) return st;
  const name = String(font.name || '').replace(/^[A-Z]{6}\+/, '');
  const flat = name.replace(/[\s_-]/g, '');
  const bold = font.black || /black|heavy/i.test(name) ? '900' : font.bold || /bold|semibold|demi/i.test(name) ? 'bold' : 'normal';
  const italic = font.italic || /italic|oblique/i.test(name) ? 'italic' : 'normal';
  const known = FAMILIES.find(([re]) => re.test(flat))?.[1];
  const own = /^[\w ]+$/.test(name.split(/[-,]/)[0]) ? `"${name.split(/[-,]/)[0].replace(/(MT|PS|Std|Pro|LT)$/,'').trim()}", ` : '';
  const families = (known ? known + ', ' : own) + (font.fallbackName || 'sans-serif');
  st = { bold, italic, families, css: size => `${italic} ${bold} ${size} ${families}` };
  fontStyles.set(font.loadedName, st);
  return st;
}

function fallbackGlyph(ch, font, spaceWidth) {
  if (/\s/.test(ch)) return null;
  const st = styleOf(font);
  measureCtx.font = st.css('100px');
  // in the font's own glyph units (1000 per em for most fonts, not all: fontMatrix)
  const width = measureCtx.measureText(ch).width / 100 / (font.fontMatrix?.[0] || 0.001);
  return {
    fontChar: ch, unicode: ch, width: width || spaceWidth * 2, isSpace: false, isInFont: true, accent: null, vmetric: null,
    hdfxFont: current => st.css(/\d+(?:\.\d+)?px/.exec(current)?.[0] || '10px'),
  };
}

// Returns the function the patched showText calls for every run of text on
// this page: null to draw it unchanged, or { glyphs, scale, more } (more: lines
// a reflowed paragraph gained below this one).
function canvas(page, operatorList) {
  const state = ready.get(page._pageIndex);
  if (!state || !state.ranges.length) return undefined;
  const run = { cursor: 0, ops: operatorList };
  return (gfx, glyphs) => {
    const font = gfx.current.font;
    if (!font || font.isType3Font || font.vertical) return null;
    const loaded = font.loadedName;
    scanOperators(run, run.ops);
    const map = learn(loaded, glyphs);
    // Advances in text space, as showText moves along: glyph widths with the
    // font size, character and word spacing; numbers are kerning in 1/1000 em.
    const cur = gfx.current;
    const size = cur.fontSize, wScale = size * cur.fontMatrix[0];
    const advOf = g => typeof g === 'number' ? -g * size / 1000
      : (g.width || 0) * wScale + cur.charSpacing + (g.isSpace ? cur.wordSpacing : 0);
    const widthOf = list => list.reduce((w, g) => w + advOf(g), 0);
    const kern = delta => -delta * 1000 / size;    // a kerning number moving on by delta
    const isGap = g => (typeof g === 'number' && g < -100) || (typeof g === 'object' && g?.isSpace);
    // which keys this run draws
    let k = '';
    const owner = [];
    glyphs.forEach((g, gi) => {
      if (typeof g !== 'object' || !g) return;
      const nn = norm(g.unicode || '');
      for (let u = 0; u < nn.length; u++) if (!KEEP.test(nn[u])) { k += nn[u]; owner.push(gi); }
    });
    if (!k) return null;
    // Where this run is in the page's text: next, as a rule. A short run ("(b)",
    // "|", a subscript) is found again many times further on, so it may only
    // be a little ahead, and is never placed far away by a guess.
    const ahead = state.keys.startsWith(k, run.cursor) ? run.cursor : state.keys.indexOf(k, run.cursor);
    let p = ahead;
    if (ahead >= 0 && ahead - run.cursor <= (k.length >= 4 ? 4000 : 40)) run.cursor = ahead + k.length;
    else {
      p = state.keys.indexOf(k);             // drawn out of order (a form, a repeated header)
      if (p < 0 || (k.length < 4 && state.keys.indexOf(k, p + 1) >= 0)) return null;
    }
    const end = p + k.length;
    // the item each glyph belongs to (spaces and kerning go with the one before)
    const gItem = [];
    owner.forEach((gi, kk) => { gItem[gi] ??= state.keyItem[p + kk]; });
    for (let gi = 0, last = gItem.find(x => x != null); gi < glyphs.length; gi++) gItem[gi] = last = gItem[gi] ?? last;
    // Text space per unit of page space, from where this run's items sit on the
    // page. A run drawing only part of an item (pdf.js joined "(a)" and the
    // words after it) gets that part of the item's width, by its letters.
    const was = widthOf(glyphs);
    const idxHere = [...new Set(state.keyItem.slice(p, end))];
    const itemsHere = idxHere.map(i => state.items[i]);
    const keysOf = i => (state.itemStart[i + 1] ?? state.keys.length) - state.itemStart[i];
    const partial = idxHere.some(i => state.itemStart[i] < p || state.itemStart[i] + keysOf(i) > end);
    const x0 = Math.min(...itemsHere.map(it => it.transform[4]));
    const x1 = Math.max(...itemsHere.map(it => it.transform[4] + (it.width || 0)));
    const span = !partial ? x1 - x0 : idxHere.reduce((w, i) => {
      const from = Math.max(p, state.itemStart[i]), to = Math.min(end, state.itemStart[i] + keysOf(i));
      return w + (state.items[i].width || 0) * (to - from) / Math.max(1, keysOf(i));
    }, 0);
    // (part of an item: from its text matrix, not by its share of the letters,
    // whose widths differ; the size there is the font size times that matrix)
    const scaleOf = it => Math.hypot(it.transform[0], it.transform[1]);
    const perUser = partial && itemsHere[0] && scaleOf(itemsHere[0]) ? size / scaleOf(itemsHere[0]) : span > 0 ? was / span : 0;
    // how far into its line this run starts, in page space (a line continued from the run before)
    const first = idxHere[0];
    const into = partial && first != null ? (state.items[first].width || 0) * Math.max(0, p - state.itemStart[first]) / Math.max(1, keysOf(first)) : 0;

    // A changed word that grew or shrank earlier on this run's piece of line
    // (owed, in page space: dx to move on by, absorb of it to take back in the
    // word gaps): this run moves on, and takes its share back in its gaps.
    // narrow: the gaps of a list narrowed by amount in all (each by frac at
    // most), or widened by a negative amount; what was taken.
    const narrow = (list, items, amount, frac = 0.4) => {
      if (!amount) return 0;
      const gaps = list.map((g, n) => (isGap(g) ? n : -1)).filter(n => n >= 0);
      const total = gaps.reduce((t, n) => t + advOf(list[n]), 0);
      if (!(total > 0)) return 0;
      const take = amount > 0 ? Math.min(amount, total * frac) : amount;
      for (const n of [...gaps].reverse()) {
        const d = take * advOf(list[n]) / total;
        if (typeof list[n] === 'number') list[n] -= kern(d);
        else { list.splice(n + 1, 0, kern(-d)); items?.splice(n + 1, 0, items[n]); }
      }
      return take;
    };
    const gapsOf = list => list.filter(isGap).length;
    // (positions are keys: pdf.js may join words the PDF placed one by one into one item)
    const pieceAt = k => state.pieceOf[state.keyItem[k]];
    const pieceEnd = id => state.itemStart[id] + keysOf(id);
    const space = map.get(' '), spaceAdv = space ? advOf(space) : 0.25 * size;
    // the word gap before key k, in page space: between two items, as they lie;
    // inside one, a space; 0 for none
    const gapAt = k => {
      const a = state.keyItem[k - 1], b = state.keyItem[k];
      if (a == null || b == null || !perUser) return 0;
      if (a !== b) return Math.max(0, state.items[b].transform[4] - (state.items[a].transform[4] + (state.items[a].width || 0)));
      return /\s/.test(state.items[b].str.slice(state.keyAt[k - 1] + 1, state.keyAt[k])) ? spaceAdv / perUser : 0;
    };
    const gapsIn = (a, b) => {          // the word gaps before keys a to b: how many, how wide in all
      let n = 0, w = 0;
      for (let k = Math.max(1, a); k < b; k++) { const g = gapAt(k); if (g > 0) { n++; w += g; } }
      return { n, w };
    };
    const carryIn = (list, items, scl = 1) => {   // scl: the run's squeeze, which the move must not take
      const id = pieceAt(p), owed = run.owed?.get(id);
      if (!owed || !perUser || !(p >= owed.after)) return false;
      // what is to be taken back, shared out evenly over the gaps still to come
      const before = gapAt(p), inner = gapsOf(list), rest = gapsIn(end, pieceEnd(id)).n;
      const n = (before > 0 ? 1 : 0) + inner + rest;
      const share = n ? owed.absorb / n : 0;
      let taken = before > 0 ? (share > 0 ? Math.min(share, before * 0.4) : share) : 0;
      taken += narrow(list, items, share * inner * perUser) / perUser;
      list.unshift(kern(owed.dx * perUser / scl));
      items?.unshift(null);
      owed.dx -= taken; owed.absorb -= taken; owed.after = end;
      if (end >= pieceEnd(id)) run.owed.delete(id);
      return true;
    };
    // what a change in this run's width leaves the runs after it on its piece
    const owe = (id, dx, absorb) => {
      const left = run.owed?.get(id);
      const keep = left && left.after === end ? left : null;
      (run.owed ||= new Map()).set(id, { dx: (keep?.dx ?? 0) + dx, absorb: (keep?.absorb ?? 0) + absorb, after: end });
    };
    let hits = state.ranges.filter(r => r.k1 > p && r.k0 < end);
    if (!hits.length) {
      const list = [...glyphs];
      return carryIn(list, null) ? { glyphs: list, scale: 1, more: null } : null;
    }
    // A reflowed line is replaced as a whole, gaps between its old words included.
    const lines = new Map();
    for (const r of hits) if (r.of != null) {
      const l = lines.get(r.of) || lines.set(r.of, { of: r.of, k0: r.k0, k1: r.k1, text: '', line: null }).get(r.of);
      l.k0 = Math.min(l.k0, r.k0); l.k1 = Math.max(l.k1, r.k1);
      if (r.line) { l.text = r.text; l.line = r.line; l.starts = r.k0; }
    }
    // A line drawn in several runs ("(a)" and the item's text, or words around a
    // formula): a run that still reads as the line begins is drawn as it is, and
    // the rest of the line goes into the next run.
    for (const l of lines.values()) {
      if (!l.line) {
        // a run of the line's later items, after its start was drawn: what was carried on
        const head = run.carry?.get(l.of) && state.ranges.find(r => r.of === l.of && r.line);
        if (!head) continue;
        Object.assign(l, { line: head.line, text: head.text, starts: head.k0 });
      }
      const carried = run.carry?.get(l.of);
      if (carried === null || (carried && carried.from > p)) { l.drop = true; continue; }   // drawn already
      if (carried) { l.text = carried.text; l.starts = p; l.carried = true; }
      if (l.starts < p) { l.drop = true; continue; }
      if (state.lineEnd.get(l.of) > end) {
        const drawn = state.keys.slice(l.starts, end);
        const rest = keep(drawn, l.text);
        if (rest != null) { (run.carry ||= new Map()).set(l.of, { from: end, text: rest }); l.kept = true; continue; }
        // an accent on its own that the new text has no place for: gone, and
        // the line goes on in the next run
        if (/^\p{M}+$/u.test(drawn)) { (run.carry ||= new Map()).set(l.of, { from: end, text: l.text }); l.drop = true; continue; }
      }
      (run.carry ||= new Map()).set(l.of, null);
    }
    if (lines.size) {
      hits = [...hits.filter(r => r.of == null), ...[...lines.values()].filter(l => !l.kept)
        .map(l => (l.line && !l.drop ? { ...l, k0: l.starts } : { k0: l.k0, k1: l.k1, text: '', drop: true }))]
        .sort((a, b) => a.k0 - b.k0);
      if (!hits.length) return null;
    }

    const spaceWidth = space?.width || 250;
    // A letter from the document's font if it has one, else from the installed
    // font; one with an accent the font has no glyph for, where it has the
    // letter and the accent (LaTeX's old encoding): the accent centred over the
    // letter, as LaTeX sets it. Small letters only, whose accent sits as drawn.
    const glyphsFor = ch => {
      if (map.get(ch)?.isInFont) return [map.get(ch)];
      const [base, mark, ...more] = ch.normalize('NFD');
      const b = map.get(base), a = mark && !more.length && /[a-hk-z]/.test(base) && SPACING[mark]?.map(c => map.get(c)).find(g => g?.isInFont);
      if (!b?.isInFont || !a) return [fallbackGlyph(ch, font, spaceWidth)];
      const L = (b.width || 0) * wScale, A = (a.width || 0) * wScale;
      const move = d => {                    // kerning numbers moving on by d, none as wide as a word gap
        const n = -d * 1000 / size, k = Math.ceil(Math.abs(n) / 90) || 1;
        return Array(k).fill(n / k);
      };
      return [...move((L - A) / 2), a, ...move(-(L + A) / 2), b];
    };
    const out = [], outItem = [];
    const put = (g, item) => { if (g !== null) { out.push(g); outItem.push(item); } };
    let gi = 0;
    for (const r of hits) {
      const a = Math.max(r.k0, p) - p, b = Math.min(r.k1, end) - p;   // key positions within this run
      const g0 = owner[a], g1 = owner[b - 1];
      while (gi < g0) { put(glyphs[gi], gItem[gi]); gi++; }
      // the replacement goes where the edit starts; a part of it in another run is dropped there
      if (!r.drop && r.k0 >= p) {
        if (r.line) r.from = out.length;
        for (const ch of r.text) {
          if (/\s/.test(ch)) { put(space ? space : -spaceWidth, r.item ?? gItem[g0]); continue; }
          for (const g of glyphsFor(ch)) put(g, r.item ?? gItem[g0]);
        }
      }
      if (!r.drop && r.k0 >= p && r.line) r.to = out.length;
      gi = g1 + 1;
    }
    while (gi < glyphs.length) { put(glyphs[gi], gItem[gi]); gi++; }
    const clean = out;
    const now = widthOf(clean);
    const spread = (list, extra, items) => {        // widen (or narrow) the word gaps by extra in total
      const gaps = list.map((g, n) => (isGap(g) ? n : -1)).filter(n => n >= 0);
      if (!gaps.length) return false;
      for (const n of [...gaps].reverse()) {
        if (typeof list[n] === 'number') list[n] += kern(extra / gaps.length);
        else { list.splice(n + 1, 0, kern(extra / gaps.length)); items?.splice(n + 1, 0, items[n]); }
      }
      return true;
    };
    let scale = 1;
    let more = null;
    const lineHit = hits.find(r => r.line && !r.drop && r.k0 >= p);
    const line = lineHit?.line;
    if (line && perUser) {
      // a reflowed line: justified to its old width, or as wide as it is, up to the column's edge
      // (a line carried on from runs drawn as they were starts where this run does)
      const before = lineHit.k0 > p ? 0 : Math.max(0, (state.items[first]?.transform[4] ?? 0) + into - (state.items[lineHit.of]?.transform[4] ?? 0));
      if (line.justify) spread(clean, (line.width - before) * perUser - now);
      else if (now > (line.cap - before) * perUser) scale = ((line.cap - before) * perUser) / now;
      // and the lines it gained below
      more = (line.more || []).map(m => {
        const gl = [];
        for (const ch of m.text) gl.push(...(/\s/.test(ch) ? [space || -spaceWidth] : glyphsFor(ch)));
        const list = gl.filter(g => g !== null);
        const wd = widthOf(list);
        return { dy: m.dy * perUser, glyphs: list, scale: wd > m.cap * perUser ? (m.cap * perUser) / wd : 1, wd };
      });
      // how wide the line and those below came out, for the text layer (placed)
      const item = state.ranges.find(r => r.of === lineHit.of && r.line)?.item;
      if (item != null && !lineHit.carried && lineHit.k1 <= end && lineHit.to != null)
        (state.drawn ||= new Map()).set(item, {
          line: widthOf(clean.slice(lineHit.from, lineHit.to)) * scale / perUser,
          more: more.map(m => m.wd * m.scale / perUser),
        });
      refitSoon();
    } else if (now !== was && perUser) {
      // A changed word in a line that keeps its words. A longer one grows into
      // the free space at its piece's end (the rest of the piece moves on), then
      // into the word gaps of its run and of the runs after it on the piece,
      // shared out evenly, each narrowed by at most 40%; only what those cannot
      // take squeezes its run, and never below MIN_SCALE. A shorter one leaves
      // the rest of the piece closer, or, on a full line (justified, no room),
      // its gaps wider.
      const id = pieceAt(end - 1), endsPiece = end >= pieceEnd(id);
      const roomAll = (state.roomOf.get(id) ?? 0) * perUser;
      const room = Math.max(0, (state.roomOf.get(id) ?? 0) * 0.98 - (run.used?.get(id) ?? 0)) * perUser;
      const full = roomAll < size * 0.5;
      let extension = now - was, grow = 0;
      if (now > was) {
        grow = Math.min(now - was, room);
        let excess = now - was - grow;
        const own = clean.filter(isGap).reduce((t, g) => t + advOf(g), 0), later = gapsIn(end, pieceEnd(id)).w * perUser;
        const capacity = (own + later) * 0.4;
        if (excess > capacity) {
          scale = Math.max(MIN_SCALE, (now - (excess - capacity)) / now);
          excess -= now * (1 - scale);
        }
        if (excess > 0 && own + later > 0) narrow(clean, outItem, excess * own / (own + later));
        extension = widthOf(clean) * scale - was;
        if (grow > 0) (run.used ||= new Map()).set(id, (run.used.get(id) ?? 0) + grow / perUser);
      } else if (endsPiece || !full) {
        if (endsPiece && full && !spread(clean, was - now, outItem)) { clean.push(kern(was - now)); outItem.push(outItem[outItem.length - 1]); }
        if (endsPiece) extension = 0;
      } else extension = now - was;
      carryIn(clean, outItem, scale);
      if (!endsPiece && extension) owe(id, extension / perUser, (extension > 0 ? extension - grow : full ? extension : 0) / perUser);
      else if (endsPiece) run.owed?.delete(id);
    } else if (!line) carryIn(clean, outItem);
    if (!line && perUser && !partial) placed(state, glyphs, gItem, clean, outItem, scale, perUser, advOf, hits);
    return { glyphs: clean, scale, more };
  };
}

// Where a changed item ended up on the canvas: a longer word moves the words
// after it, narrows the gaps or squeezes the run, a shorter one widens them. The
// text layer is made after the canvas, and takes its words' places from here,
// so the highlight lies on the word as drawn: { dx, w } in page space.
function placed(state, before, beforeItem, after, afterItem, scale, perUser, advOf, hits) {
  const extent = (list, items, scl) => {
    const m = new Map();
    let x = 0;
    list.forEach((g, n) => {
      const w = advOf(g) * scl, i = items[n];
      if (i != null) {
        const e = m.get(i);
        if (!e) m.set(i, { a: x, b: x + w }); else e.b = x + w;
      }
      x += w;
    });
    return m;
  };
  const old = extent(before, beforeItem, 1), now = extent(after, afterItem, scale);
  for (const r of hits) {
    if (r.of != null || r.item == null) continue;
    const o = old.get(r.item), e = now.get(r.item);
    if (o && e) (state.drawn ||= new Map()).set(r.item, { dx: (e.a - o.a) / perUser, w: (e.b - e.a) / perUser });
  }
  refitSoon();
}

// What the text layer gets for an item with edits: { item, marks } (marks: the
// changed words in item.str, for the highlights). A reflowed line's text sits
// in its first fragment, as wide as the line; a justified one word by word,
// each where it is set (one piece would be stretched evenly, letters and gaps
// alike, while the canvas widens the gaps); then the lines it gained below.
function edited(it, list, drawn) {
  const { str, marks } = applyEdits(it.str, list);
  const ln = list.find(ed => ed.line)?.line;
  if (!ln && drawn?.w != null) {
    const t = [...it.transform];
    t[4] += drawn.dx;
    return [{ item: { ...it, str, transform: t, width: drawn.w }, marks, fit: true }];
  }
  const out = [];
  // a line of text as one item, or word by word where pdftext.js placed its words
  const put = (str, marks, dy, width, xs, eol, fit) => {
    const at = dx => { const t = [...it.transform]; t[4] += dx; t[5] += dy; return t; };
    const words = xs ? [...str.matchAll(/\S+/g)] : [];
    if (words.length < 2 || words.length !== xs.length) { out.push({ item: { ...it, str, transform: at(0), width, hasEOL: eol }, marks, fit }); return; }
    words.forEach((w, k) => {
      const last = k === words.length - 1;
      const s = w.index, e = s + w[0].length + (last ? 0 : 1);
      const [x, wd] = xs[k];
      out.push({
        item: { ...it, str: str.slice(s, e), transform: at(x), width: last ? wd : xs[k + 1][0] - x, hasEOL: last && eol },
        marks: marks.filter(([a, b]) => b > s && a < e).map(([a, b, info]) => [Math.max(a, s) - s, Math.min(b, e) - s, info]),
      });
    });
  };
  // a line not justified is as wide as the canvas drew it (placed); before it
  // is drawn, as its letters make it
  const width = ln ? (ln.justify ? ln.width : drawn?.line ?? Math.min(ln.cap, it.width * (str.length / Math.max(1, it.str.length)))) : it.width;
  put(str, marks, 0, width, ln?.xs, it.hasEOL || !!ln?.more, !!ln && !ln.justify && drawn?.line != null);
  (ln?.more || []).forEach((m, k) =>
    put(m.text, m.marks || [[0, m.text.length]], m.dy, drawn?.more?.[k] ?? Math.min(m.cap, it.width * m.text.length / Math.max(1, str.length)), m.xs, true, drawn?.more?.[k] != null));
  return out;
}

// What the text layer gets for each item, edits applied: [{ item, marks, fit }]
// per item. An accent drawn on its own goes into its letter ("f¨" "ur" read
// "f" "ür"), so that what is copied and found is the word as written.
const ACCENT = /[¨´ˆ˜˚¸ˇ˘˙˝¯˛]/;
const SPACING_OF = Object.fromEntries(Object.entries(SPACING).flatMap(([m, cs]) => cs.filter(c => ACCENT.test(c)).map(c => [c, m])));
function layerItems(state) {
  const per = state.items.map((it, n) => {
    const list = state.byItem.get(n);
    return list ? edited(it, list, state.drawn?.get(n)) : [{ item: it, marks: [] }];
  });
  const flat = per.flat().filter(o => typeof o.item.str === 'string');
  if (!flat.some(o => ACCENT.test(o.item.str))) return per;
  const set = (o, str, cut) => {           // a new text, cut: [at, removed] for the marks after it
    if (cut) o.marks = o.marks.map(([a, b, info]) => [a > cut[0] ? a - cut[1] : a, b > cut[0] ? b - cut[1] : b, info]).filter(([a, b]) => b > a);
    o.item = { ...o.item, str };
    if (o.fit) o.fit = o.item;
  };
  const join = (accent, letter) => {
    const c = (letter + SPACING_OF[accent]).normalize('NFC');
    return /\p{L}/u.test(letter) && c.length === 1 ? c : null;
  };
  flat.forEach((o, n) => {
    let s = o.item.str;
    for (let k = s.length - 2; k >= 0; k--) {
      const c = ACCENT.test(s[k]) && join(s[k], s[k + 1]);
      if (c) { s = s.slice(0, k) + c + s.slice(k + 2); set(o, s, [k, 1]); }
    }
    const nx = flat[n + 1], c = nx && ACCENT.test(s.at(-1)) && join(s.at(-1), nx.item.str[0] || '');
    if (c) { set(o, s.slice(0, -1), [s.length - 1, 1]); set(nx, c + nx.item.str.slice(1)); }
  });
  return per;
}

// The text layer (selection, copy, find) and anything else reading text.
function textStream(page, opts) {
  const raw = page.streamTextContent({ ...opts, __hdfxRaw: true });
  const reader = raw.getReader();
  let n = 0, state = null;
  return new ReadableStream({
    async start() {
      await prepare(page);
      state = ready.get(page._pageIndex);
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) { controller.close(); return; }
      if (state) {
        const all = layerItems(state);
        value.items = value.items.flatMap(it => {
          if (typeof it.str !== 'string') return [it];
          const own = all[n++];
          if (!own || (!state.byItem.has(n - 1) && own[0].item.str === it.str)) return [it];   // as pdf.js has it
          return own.map(({ item }) => (opts.disableNormalization ? item : { ...item, str: norm(item.str) }));
        });
      }
      controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

// ---------- highlights ----------
// With "Highlight changes on page" on (pdftext.js sets data-hdfx-highlight),
// changed words are tinted as on any page (content.js, whose own highlight
// this is not: on Chromium it may run in this page too): a CSS highlight over
// the text layer's invisible words, which lie on the drawn ones. The viewer
// hands over each text layer it makes (highlightLayer).
const root = document.documentElement;
const layers = new Map();     // text layer div -> page index

// The texts of the layer's words, as textStream gave them, with their marks.
function layerTexts(state) {
  return layerItems(state).flat().map(({ item, marks, fit }) => ({ str: item.str, marks, fit: fit && item }))
    .filter(o => o.str !== '');      // the text layer makes no element for these
}

// A text layer made before its page was drawn (the find bar's, or Chrome's,
// which makes it ahead) has the changed words where pdftext.js guessed them; the
// canvas knows where they are (placed). Each such word is moved and stretched
// there, measured, so doing it again changes nothing.
function refit(div, state, want) {
  const pageW = state.view[2] - state.view[0];
  const rot = +(div.getAttribute('data-main-rotation') || 0) % 180;
  const box = div.getBoundingClientRect();
  const perUnit = (rot ? box.height : box.width) / pageW;
  if (!perUnit) return;
  const moves = [];
  div.querySelectorAll('span[role="presentation"]').forEach((span, n) => {
    const o = want[n], node = span.firstChild;
    if (!o?.fit || node?.nodeType !== 3 || node.data !== o.str) return;
    const t = o.fit.transform;
    if (t[1] || t[2]) return;                  // rotated text keeps pdf.js's place
    const r = span.getBoundingClientRect(), len = rot ? r.height : r.width;
    if (!len) return;
    const sx = parseFloat(span.style.getPropertyValue('--scale-x')) || 1;
    moves.push([span, `${(100 * (t[4] - state.view[0]) / pageW).toFixed(2)}%`, sx * o.fit.width * perUnit / len]);
  });
  for (const [span, left, sx] of moves) {
    span.style.left = left;
    span.style.setProperty('--scale-x', sx);
  }
}
let refitTimer = 0;
function refitSoon() {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(paint, 30);
}

function paint() {
  const ranges = [];
  marked.clear();
  for (const [div, idx] of layers) {
    const state = ready.get(idx);
    if (!div.isConnected || !state?.edits.length) continue;
    const want = layerTexts(state), here = [];
    if (state.drawn) refit(div, state, want);
    if (!root.hasAttribute('data-hdfx-highlight')) continue;
    div.querySelectorAll('span[role="presentation"]').forEach((span, n) => {
      const node = span.firstChild, o = want[n];
      // a layer from before the model spoke reads otherwise: it is made again
      if (!o?.marks.length || node?.nodeType !== 3 || node.data !== o.str) return;
      for (const [a, b, info] of o.marks) {
        const r = new Range();
        r.setStart(node, a); r.setEnd(node, b);
        ranges.push(r);
        if (info) here.push({ range: r, info });
      }
    });
    if (here.length) marked.set(div, here);
  }
  if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
  CSS.highlights.set('hdfx-changed', new Highlight(...ranges));
  armHover();
}

// The tint's style, where the layer is: Chrome's viewer has its pages in a
// shadow root, which no style of the document reaches (nor do its scrolls).
const styled = new WeakSet();
function style(div) {
  const where = div.getRootNode();
  if (styled.has(where)) return;
  styled.add(where);
  const el = document.createElement('style');
  el.textContent = '.textLayer ::highlight(hdfx-changed){background-color:rgba(255,200,0,.45)}'
    + '.textLayer ::highlight(hdfx-hover){background-color:rgba(255,170,0,.7)}';
  (where === document ? document.head || root : where).append(el);
  if (where !== document) where.addEventListener('scroll', () => hide(true), { passive: true, capture: true });
}

function highlightLayer(div, idx) {
  for (const d of layers.keys()) if (!d.isConnected) layers.delete(d);
  layers.set(div, idx);
  style(div);
  paint();
}
new MutationObserver(paint).observe(root, { attributes: true, attributeFilter: ['data-hdfx-highlight'] });

// ---------- the original, on hover ----------
// As on web pages (content.js, which does not run in the viewer): pointing at
// a tinted word shows what the PDF says there and why it changed, in a card in
// a closed shadow root that takes no pointer events. The words are found by
// where they are, so the layers may be in a shadow root.
const marked = new Map();     // text layer div -> [{ range, info }]
let tip = null, shown = null, hideTimer = null, frame = 0, armed = false;

function hit(x, y) {
  const inside = r => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1;
  for (const [div, list] of marked) {
    if (!inside(div.getBoundingClientRect())) continue;
    for (const m of list) {
      const rect = [...m.range.getClientRects()].find(inside);
      if (rect) return { ...m, rect };
    }
  }
  return null;
}

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.append(e);
  return e;
}

function makeTip() {
  const host = document.createElement('hochdeutsch-fixer-tip');
  host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  const sr = host.attachShadow({ mode: 'closed' });
  el('style', null, sr).textContent = `
    :host { --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.12); --mark: #e8a200; }
    @media (prefers-color-scheme: dark) { :host { --bg: #2b2a33; --fg: #fbfbfe; --muted: #a8a8b3; --line: rgba(255,255,255,.14); --mark: #ffc845; } }
    .card { position: fixed; left: 0; top: 0; max-width: min(320px, calc(100vw - 12px)); box-sizing: border-box; padding: 7px 10px 8px;
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg);
      border: 1px solid var(--line); border-radius: 7px; box-shadow: 0 6px 20px rgba(0,0,0,.14), 0 1px 3px rgba(0,0,0,.08);
      opacity: 0; transform: translate3d(var(--x, 0), calc(var(--y, 0) + var(--dy, 4px)), 0);
      transition: opacity 120ms ease-out, transform 180ms cubic-bezier(.2,.8,.2,1); will-change: transform, opacity; }
    .card.on { opacity: 1; --dy: 0px; }
    .card.below { --dy: -4px; }
    .card.on.below { --dy: 0px; }
    .card.still { transition: none; }
    .row { hyphens: auto; overflow-wrap: anywhere; }
    .from, .to { -webkit-box-decoration-break: clone; box-decoration-break: clone; background-repeat: no-repeat; }
    .from { color: var(--muted); background-image: linear-gradient(currentColor, currentColor);
      background-position: 0 56%; background-size: 100% 1.5px; }
    .card.fresh .from { animation: strike 220ms 70ms cubic-bezier(.4,0,.2,1) both; }
    @keyframes strike { from { background-size: 0% 1.5px; } }
    .arrow { color: var(--muted); font-size: 12px; margin: 0 2px 0 5px; }
    .to { font-weight: 600; padding-bottom: 1px; background-image: linear-gradient(var(--mark), var(--mark));
      background-position: 0 100%; background-size: 100% 2px; }
    .note { margin-top: 3px; font-size: 11.5px; color: var(--muted); overflow-wrap: anywhere; }
    .note:empty { display: none; }
    @media (prefers-reduced-motion: reduce) {
      .card { transition: opacity 100ms linear; transform: translate3d(var(--x, 0), var(--y, 0), 0); }
      .card.fresh .from { animation: none; }
    }`;
  const card = el('div', 'card', sr);
  card.setAttribute('role', 'tooltip');
  card.lang = 'de';                          // German hyphenation for long compounds
  const row = el('div', 'row', card);
  const from = el('span', 'from', row);
  el('span', 'arrow', row).textContent = '→ ';   // the arrow stays with the new word
  const to = el('span', 'to', row);
  const note = el('div', 'note', card);
  root.append(host);
  return { host, card, from, to, note };
}

function show(h) {
  clearTimeout(hideTimer);
  if (h.range === shown && tip?.card.classList.contains('on')) return;
  tip ||= makeTip();
  if (!tip.host.isConnected) root.append(tip.host);
  const { card, from, to, note } = tip;
  const wasOn = card.classList.contains('on');
  shown = h.range;
  from.textContent = h.info.from || '∅';
  to.textContent = h.info.to || '∅';
  note.textContent = h.info.note || '';
  // above the word, or below it at the top of the window
  const w = card.offsetWidth, ht = card.offsetHeight, gap = 8;
  const x = Math.round(Math.max(6, Math.min(h.rect.left + h.rect.width / 2 - w / 2, innerWidth - w - 6)));
  let y = Math.round(h.rect.top - ht - gap);
  const below = y < 6;
  if (below) y = Math.round(h.rect.bottom + gap);
  // from word to word it glides; out of nowhere it fades in where it belongs
  if (!wasOn) { card.classList.add('still'); card.classList.toggle('below', below); }
  card.style.setProperty('--x', x + 'px');
  card.style.setProperty('--y', y + 'px');
  card.classList.remove('fresh');
  void card.offsetWidth;                       // start the strike again
  card.classList.add('fresh');
  if (!wasOn) { card.classList.remove('still'); void card.offsetWidth; }
  card.classList.add('on');
  const hl = new Highlight(h.range);
  hl.priority = 1;
  CSS.highlights.set('hdfx-hover', hl);
}

function hide(now) {
  clearTimeout(hideTimer);
  const go = () => {
    shown = null;
    tip?.card.classList.remove('on', 'fresh');
    globalThis.CSS?.highlights?.delete('hdfx-hover');
  };
  // a short grace, so the card glides between neighbouring words instead of blinking
  if (now) go(); else hideTimer = setTimeout(go, 90);
}

function onMove(e) {
  if (e.pointerType === 'touch') return;
  const { clientX: x, clientY: y } = e;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const h = hit(x, y);
    h ? show(h) : hide();
  });
}
const onTap = e => {
  if (e.pointerType !== 'touch') return;
  const h = hit(e.clientX, e.clientY);
  h ? show(h) : hide(true);
};
const onKey = e => { if (e.key === 'Escape') hide(true); };
const onAway = () => hide(true);

// Listening only while there is something tinted to point at.
function armHover() {
  const want = marked.size > 0;
  if (want !== armed) {
    armed = want;
    const add = want ? addEventListener : removeEventListener;
    add('pointermove', onMove, { passive: true, capture: true });
    add('pointerdown', onTap, { passive: true, capture: true });
    add('keydown', onKey, true);
    add('scroll', onAway, { passive: true, capture: true });
    add('wheel', onAway, { passive: true, capture: true });
    add('blur', onAway);
  }
  // the word under the card may be gone (a page drawn again, highlights off)
  if (shown && ![...marked.values()].some(l => l.some(m => m.range === shown))) hide(true);
}

globalThis.__hdfx = { prepare, canvas, textStream };
export { prepare, canvas, textStream, highlightLayer };
