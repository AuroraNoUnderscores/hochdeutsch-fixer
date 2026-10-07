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
  return { keys: keys.join(''), ranges, byItem, keyItem: at.map(a => a[0]), itemStart };
}

// A line's new text begins with what a run draws (its keys): the rest of the
// text, for the runs after it; or null.
function keep(drawn, text) {
  let d = 0, t = 0;
  while (d < drawn.length && t < text.length) {
    const cp = String.fromCodePoint(text.codePointAt(t));
    const nn = norm(cp);
    t += cp.length;
    for (let u = 0; u < nn.length; u++) {
      if (KEEP.test(nn[u])) continue;
      if (nn[u] !== drawn[d++]) return null;
    }
  }
  if (d < drawn.length) return null;
  const rest = text.slice(t).replace(/^\s+/, '');
  return rest ? rest : null;
}

function applyEdits(str, list) {
  if (!list?.length) return str;
  let out = '', pos = 0;
  for (const ed of [...list].sort((a, b) => a.s - b.s)) {
    out += str.slice(pos, ed.s) + ed.t;
    pos = ed.e;
  }
  return out + str.slice(pos);
}

function prepare(page) {
  const idx = page._pageIndex;
  if (!pages.has(idx)) {
    pages.set(idx, (async () => {
      const tc = await page.getTextContent({ __hdfxRaw: true, disableNormalization: true });
      const items = tc.items.filter(it => typeof it.str === 'string');
      const lite = items.map(it => ({ str: it.str, eol: !!it.hasEOL, t: it.transform, w: it.width, h: it.height, f: it.fontName, ff: tc.styles[it.fontName]?.fontFamily }));
      const { edits = [], version = 0 } = (await ask('page', { page: idx, items: lite, view: page.view })) || {};
      const state = { items, edits, version, ...buildKeys(items, edits) };
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
  const state = { items: old.items, edits, version, ...buildKeys(old.items, edits) };
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
  const width = measureCtx.measureText(ch).width * 10;
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
    let hits = state.ranges.filter(r => r.k1 > p && r.k0 < end);
    if (!hits.length) return null;
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
      if (!l.line) continue;
      const carried = run.carry?.get(l.of);
      if (carried === null || (carried && carried.from > p)) { l.drop = true; continue; }   // drawn already
      if (carried) { l.text = carried.text; l.starts = p; }
      if (l.starts < p) { l.drop = true; continue; }
      if (l.k1 > end) {
        const rest = keep(state.keys.slice(l.starts, end), l.text);
        if (rest != null) { (run.carry ||= new Map()).set(l.of, { from: end, text: rest }); l.kept = true; continue; }
      }
      (run.carry ||= new Map()).set(l.of, null);
    }
    if (lines.size) {
      hits = [...hits.filter(r => r.of == null), ...[...lines.values()].filter(l => !l.kept)
        .map(l => (l.line && !l.drop ? { ...l, k0: l.starts } : { k0: l.k0, k1: l.k1, text: '', drop: true }))]
        .sort((a, b) => a.k0 - b.k0);
      if (!hits.length) return null;
    }

    const space = map.get(' ');
    const spaceWidth = space?.width || 250;
    // a letter from the document's font if it has one, else from the installed font
    const glyphFor = ch => (map.get(ch)?.isInFont ? map.get(ch) : fallbackGlyph(ch, font, spaceWidth));
    // Advances in text space, as showText moves along: glyph widths with the
    // font size, character and word spacing; numbers are kerning in 1/1000 em.
    const cur = gfx.current;
    const size = cur.fontSize, wScale = size * cur.fontMatrix[0];
    const advOf = g => typeof g === 'number' ? -g * size / 1000
      : (g.width || 0) * wScale + cur.charSpacing + (g.isSpace ? cur.wordSpacing : 0);
    const widthOf = list => list.reduce((w, g) => w + advOf(g), 0);
    const out = [];
    let gi = 0;
    for (const r of hits) {
      const a = Math.max(r.k0, p) - p, b = Math.min(r.k1, end) - p;   // key positions within this run
      const g0 = owner[a], g1 = owner[b - 1];
      while (gi < g0) out.push(glyphs[gi++]);
      // the replacement goes where the edit starts; a part of it in another run is dropped there
      if (!r.drop && r.k0 >= p) {
        for (const ch of r.text) {
          if (/\s/.test(ch)) { out.push(space ? space : -spaceWidth); continue; }
          out.push(glyphFor(ch));
        }
      }
      gi = g1 + 1;
    }
    while (gi < glyphs.length) out.push(glyphs[gi++]);
    const clean = out.filter(g => g !== null);
    const was = widthOf(glyphs), now = widthOf(clean);
    const isGap = g => (typeof g === 'number' && g < -100) || (typeof g === 'object' && g?.isSpace);
    // Text space per unit of page space, from where this run's items sit on the
    // page. A run drawing only part of an item (pdf.js joined "(a)" and the
    // words after it) gets that part of the item's width, by its letters.
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
    const perUser = span > 0 ? was / span : 0;
    // how far into its line this run starts, in page space (a line continued from the run before)
    const first = idxHere[0];
    const into = partial && first != null ? (state.items[first].width || 0) * Math.max(0, p - state.itemStart[first]) / Math.max(1, keysOf(first)) : 0;
    const kern = delta => -delta * 1000 / size;    // a kerning number moving on by delta
    const spread = (list, extra) => {               // widen (or narrow) the word gaps by extra in total
      const gaps = list.map((g, n) => (isGap(g) ? n : -1)).filter(n => n >= 0);
      if (!gaps.length) return false;
      for (const n of [...gaps].reverse()) {
        if (typeof list[n] === 'number') list[n] += kern(extra / gaps.length);
        else list.splice(n + 1, 0, kern(extra / gaps.length));
      }
      return true;
    };
    let scale = 1;
    let more = null;
    const lineHit = hits.find(r => r.line && !r.drop && r.k0 >= p);
    const line = lineHit?.line;
    if (line && perUser) {
      // a reflowed line: justified to its old width, or as wide as it is, up to the column's edge
      const before = lineHit.k0 > p ? 0 : into;
      if (line.justify) spread(clean, (line.width - before) * perUser - now);
      else if (now > (line.cap - before) * perUser) scale = ((line.cap - before) * perUser) / now;
      // and the lines it gained below
      more = (line.more || []).map(m => {
        const gl = [];
        for (const ch of m.text) gl.push(/\s/.test(ch) ? (space || -spaceWidth) : glyphFor(ch));
        const list = gl.filter(g => g !== null);
        const wd = widthOf(list);
        return { dy: m.dy * perUser, glyphs: list, scale: wd > m.cap * perUser ? (m.cap * perUser) / wd : 1 };
      });
    } else if (now > was && now > 0) {
      // A changed word in a line that keeps its words. If this run ends its line,
      // the line may grow up to its column's edge; past that, the gaps narrow (by
      // at most 40%), and only then is the run squeezed.
      const ends = hits.find(r => r.lineLast != null && itemsHere.includes(state.items[r.lineLast]));
      const limit = was + (ends && perUser ? ends.room * perUser * 0.98 : 0);
      if (now > limit) {
        const gaps = clean.map((g, n) => (typeof g === 'number' && g < -100 ? n : -1)).filter(n => n >= 0);
        const total = gaps.reduce((t, n) => t + advOf(clean[n]), 0);
        const take = Math.min(now - limit, total * 0.4);
        if (total > 0) for (const n of gaps) clean[n] -= kern(take * advOf(clean[n]) / total);
        const w = widthOf(clean);
        if (w > limit + 0.01) scale = limit / w;
      }
    } else if (now < was) {
      if (!spread(clean, was - now)) clean.push(kern(was - now));
    }
    return { glyphs: clean, scale, more };
  };
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
      if (state?.edits.length) {
        value.items = value.items.flatMap(it => {
          if (typeof it.str !== 'string') return [it];
          const list = state.byItem.get(n++);
          if (!list) return [it];
          const str = applyEdits(it.str, list);
          // a reflowed line's text sits in its first fragment, as wide as the line
          const ln = list.find(ed => ed.line)?.line;
          const width = ln ? (ln.justify ? ln.width : Math.min(ln.cap, it.width * (str.length / Math.max(1, it.str.length)))) : it.width;
          const out = [{ ...it, str: opts.disableNormalization ? str : norm(str), width, ...(ln?.more ? { hasEOL: true } : {}) }];
          for (const m of ln?.more || []) {
            const t = [...it.transform];
            t[5] += m.dy;
            out.push({ ...it, str: opts.disableNormalization ? m.text : norm(m.text), transform: t, width: Math.min(m.cap, it.width * m.text.length / Math.max(1, str.length)), hasEOL: true });
          }
          return out;
        });
      }
      controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

globalThis.__hdfx = { prepare, canvas, textStream };
export { prepare, canvas, textStream };
