// Converting the text of a PDF, page by page, for pdfview.js (both builds).
// pdf.js gives a page's text as fragments with their positions; here they are
// joined into lines and paragraphs (a word hyphenated at a line end is one
// word), converted like any page, model included, and the changes mapped back
// onto the fragments. A changed paragraph is set again in its lines (reflow).
globalThis.HD_PDFTEXT = (() => {
  // ---------- converting the text, page by page ----------

  const GERMAN = /(?<!\p{L})(?:der|die|das|den|dem|des|und|ist|sind|war|nicht|mit|für|ein|eine|einen|einem|von|zu|zum|zur|auf|sich|wir|wird|werden|auch|aber|oder|im|am|beim|vom|bei|dass|haben|hat|habe|hast|hatte|kann|muss|nach|über|nur|noch|wie|was|schon|sehr|man|als|wenn|ich|mir|mich|dir|uns|euch|bin|bist|mein|meine|dein|sein|seine|kein|keine|wurde|bitte|danke|viele|heute|gestern|jetzt|hier|dort)(?!\p{L})/giu;
  const germanish = t => { const n = (t.match(GERMAN) || []).length; return n >= 2 || (n >= 1 && /[äöüÄÖÜ]/.test(t)); };
  let settings = null;
  const engine = () => new Promise(resolve => {
    const tick = () => (globalThis.HD_ENGINE ? resolve(globalThis.HD_ENGINE) : setTimeout(tick, 20));
    tick();
  });
  const pagesText = new Map();
  let count = 0;
  const changes = new Map();

  async function loadSettings() {
    const s = await browser.storage.local.get(['enabled', 'disabledSites', 'mode', 'llm', 'pdf']);
    return { mode: s.mode || 'hamburg', llm: s.llm !== false };
  }

  // Lines of a page from pdf.js's text items, then paragraphs from lines:
  // a new paragraph where the gap to the next line is larger than usual or the
  // font size changes (a heading).
  function paragraphs(items) {
    const lines = [];
    let line = [];
    items.forEach((it, i) => {
      line.push(i);
      if (it.eol) { lines.push(line); line = []; }
    });
    if (line.length) lines.push(line);
    const geo = idxs => {
      const its = idxs.map(i => items[i]).filter(it => it.str.trim());
      if (!its.length) return null;
      const size = Math.max(...its.map(it => Math.hypot(it.t[2], it.t[3]) || it.h || 10));
      return { y: its[0].t[5], x: its[0].t[4], size };
    };
    const paras = [];
    let cur = null, last = null;
    for (const l of lines) {
      const g = geo(l);
      if (!g) { if (cur) { paras.push(cur); cur = null; last = null; } continue; }
      const gap = last ? Math.abs(last.y - g.y) : 0;
      const sameSize = last && g.size / last.size > 0.85 && g.size / last.size < 1.18;
      if (cur && sameSize && gap > 0 && gap < last.size * 1.75) cur.push(l);
      else { if (cur) paras.push(cur); cur = [l]; }
      last = g;
    }
    if (cur) paras.push(cur);
    return paras;
  }

  // A paragraph's text, and where each of its characters came from: [item,
  // offset], or null for a space between items or lines. A word hyphenated at a
  // line end is joined without its hyphen ("Velo-" + "weg" reads "Veloweg").
  // A hyphen before "und", "oder" … stands for a word's shared ending
  // ("Korrektur- und Verbesserungsvorschläge") and is kept, with its space.
  const SUSPENDED = /^\s*(?:und|oder|bzw|beziehungsweise|sowie|bis|noch|als|wie)(?!\p{L})/u;
  function assemble(items, para) {
    let text = '';
    const from = [];
    const add = (s, i, o) => { for (let k = 0; k < s.length; k++) { text += s[k]; from.push(i == null ? null : [i, o + k]); } };
    para.forEach((line, li) => {
      line.forEach((i, j) => {
        const it = items[i];
        if (j > 0) {
          const prev = items[line[j - 1]];
          const gapX = it.t[4] - (prev.t[4] + prev.w);
          if (!/\s$/.test(prev.str) && !/^\s/.test(it.str) && it.str && gapX > (Math.hypot(it.t[2], it.t[3]) || 10) * 0.15) add(' ', null);
        }
        add(it.str, i, 0);
      });
      if (li < para.length - 1) {
        const next = para[li + 1].map(i => items[i].str).join('');
        const m = /(\p{L})-\s*$/u.exec(text);
        if (m && /^\s*\p{Ll}/u.test(next) && !SUSPENDED.test(next)) {
          // drop the hyphen (and spaces after it) from the text; the item keeps it
          const cut = text.length - m[0].length + 1;
          text = text.slice(0, cut); from.length = cut;
        } else if (!/\s$/.test(text)) add(' ', null);
      }
    });
    return { text, from, para };
  }

  const TOKEN = /\p{L}+|\p{N}+(?:['’.,]\p{N}+)*|\s+|[^\p{L}\p{N}\s]/gu;
  // Word-level differences, as [start, end) in the original text and the new text.
  function differences(a, b) {
    const x = [...a.matchAll(TOKEN)], y = b.match(TOKEN) || [];
    const out = [];
    let i = 0, j = 0;
    const same = (p, q) => { for (let k = 0; k < 3; k++) { if (p + k >= x.length && q + k >= y.length) return true; if (x[p + k]?.[0] !== y[q + k]) return false; } return true; };
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i][0] === y[j]) { i++; j++; continue; }
      let best = null;
      for (let s = 1; s <= 80 && !best; s++)
        for (let di = Math.max(0, s - 40); di <= Math.min(s, 40); di++) {
          const dj = s - di;
          if (i + di <= x.length && j + dj <= y.length && same(i + di, j + dj)) { best = [di, dj]; break; }
        }
      let [di, dj] = best || [x.length - i, y.length - j];
      let i0 = i, j0 = j;
      // an insertion or deletion goes with the word before it
      const fromText = x.slice(i, i + di).map(m => m[0]).join(''), toText = y.slice(j, j + dj).join('');
      if ((!fromText.trim() || !toText.trim()) && i0 > 0) {
        let k = 1;
        while (i0 - k > 0 && /^\s+$/.test(x[i0 - k][0])) k++;
        i0 -= k; j0 -= k;
      }
      while (i0 < i + di && /^\s+$/.test(x[i0][0]) && j0 < j + dj && /^\s+$/.test(y[j0])) { i0++; j0++; }
      let i1 = i + di, j1 = j + dj;
      while (i1 > i0 && /^\s+$/.test(x[i1 - 1][0]) && j1 > j0 && /^\s+$/.test(y[j1 - 1])) { i1--; j1--; }
      if (i1 > i0) out.push({ s: x[i0].index, e: x[i1 - 1].index + x[i1 - 1][0].length, t: y.slice(j0, j1).join('') });
      i += di; j += dj;
    }
    return out;
  }

  // Split a hyphenated word's replacement where the original was split.
  function splitAt(orig, repl, at) {
    let p = 0;
    while (p < orig.length && p < repl.length && orig[p] === repl[p]) p++;
    let q = 0;
    while (q < orig.length - p && q < repl.length - p && orig[orig.length - 1 - q] === repl[repl.length - 1 - q]) q++;
    if (at <= p) return at;
    if (at >= orig.length - q) return repl.length - (orig.length - at);
    return p;
  }

  // Edits in a paragraph's text, as edits of the items it was made from.
  function toItems(edits, { text, from }) {
    const out = [];
    const local = (s, e, t) => {
      const src = from.slice(s, e).filter(Boolean);
      if (!src.length) return;
      const groups = [];
      for (const [i, o] of src) {
        const g = groups[groups.length - 1];
        if (g && g.i === i && o === g.e) g.e = o + 1; else groups.push({ i, s: o, e: o + 1 });
      }
      return groups;
    };
    for (const ed of edits) {
      const groups = local(ed.s, ed.e);
      if (!groups) continue;
      if (groups.length === 1) { out.push({ ...groups[0], t: ed.t }); continue; }
      // Spread over several items: word by word, when the words still pair up.
      const words = [...text.slice(ed.s, ed.e).matchAll(/\S+/g)];
      const newWords = ed.t.split(/\s+/).filter(Boolean);
      if (words.length === newWords.length) {
        words.forEach((w, n) => {
          const s = ed.s + w.index, e = s + w[0].length;
          if (w[0] === newWords[n]) return;
          const parts = local(s, e);
          if (!parts) return;
          if (parts.length === 1) { out.push({ ...parts[0], t: newWords[n] }); return; }
          // a word hyphenated over two lines
          const firstLen = parts[0].e - parts[0].s;
          const cut = splitAt(w[0], newWords[n], firstLen);
          out.push({ ...parts[0], t: newWords[n].slice(0, cut) });
          out.push({ ...parts[1], t: newWords[n].slice(cut) });
          for (const extra of parts.slice(2)) out.push({ ...extra, t: '' });
        });
      } else {
        out.push({ ...groups[0], t: ed.t });
        for (const g of groups.slice(1)) out.push({ ...g, t: '' });
      }
    }
    return out;
  }

  // ---------- reflowing a changed paragraph ----------
  // A longer or shorter word must not squeeze or stretch its line. As a
  // typesetter would, the paragraph's words are broken into its lines again,
  // each line as wide as before: justified lines stay justified, ragged ones
  // may run to the column's edge. Paragraphs in one font only, not centred;
  // anything else keeps its lines and changes word by word.
  const measureCtx = new OffscreenCanvas(1, 1).getContext('2d');
  const measure = (text, family) => { measureCtx.font = `100px ${family || 'sans-serif'}`; return measureCtx.measureText(text).width / 100; };

  // Where each line's column ends: the furthest right edge among the page's
  // lines starting at about the same place.
  function columns(items) {
    const lines = [];
    let start = null;
    items.forEach((it, i) => {
      if (!it.str.trim()) { if (it.eol && start != null) { lines.push([start, i]); start = null; } return; }
      if (start == null) start = i;
      if (it.eol) { lines.push([start, i]); start = null; }
    });
    if (start != null) lines.push([start, items.length - 1]);
    const spans = lines.map(([a, b]) => {
      let last = b;
      while (last > a && !items[last].str.trim()) last--;
      return { x0: items[a].t[4], x1: items[last].t[4] + items[last].w };
    });
    return x0 => Math.max(x0, ...spans.filter(s => Math.abs(s.x0 - x0) < 30 || (x0 > s.x0 && x0 < s.x0 + 60)).map(s => s.x1));
  }

  // For a word changed in place: the line it is on, and how far that line
  // may grow before it reaches its column's edge.
  function lineRoom(items, column) {
    const out = new Map();
    let line = [];
    const flush = () => {
      const real = line.filter(i => items[i].str.trim());
      if (real.length) {
        const a = items[real[0]], z = items[real[real.length - 1]];
        const room = Math.max(0, column(a.t[4]) - (z.t[4] + z.w));
        for (const i of real) out.set(i, { lineLast: real[real.length - 1], room });
      }
      line = [];
    };
    items.forEach((it, i) => { line.push(i); if (it.eol) flush(); });
    flush();
    return out;
  }

  // How far a one-line paragraph (a heading, a label) may grow to the right:
  // to the next text on its line, or else to the page's right margin, taken
  // as wide as its left one. Its column alone would hold it to its old length.
  function openRight(items, view) {
    if (!view) return null;
    const left = Math.min(...items.filter(it => it.str.trim()).map(it => it.t[4]));
    const margin = view[2] - (left - view[0]);
    return (g, own, size) => {
      const next = items.filter((it, i) => !own.has(i) && it.str.trim() && Math.abs(it.t[5] - g.y) < size && it.t[4] >= g.x1 - 1)
        .map(it => it.t[4] - size * 0.5);
      return Math.min(margin, ...next);
    };
  }

  function reflow(items, { para }, text, column, open) {
    const lines = para.map(l => l.filter(i => items[i].str.trim())).filter(l => l.length);
    if (!lines.length) return null;
    const its = lines.flat().map(i => items[i]);
    if (new Set(its.map(it => it.f)).size !== 1) return null;                 // bold or italic words inside
    const geo = lines.map(l => {
      const a = items[l[0]], z = items[l[l.length - 1]];
      return { x0: a.t[4], x1: z.t[4] + z.w, y: a.t[5] };
    });
    const x0s = geo.slice(1).map(g => g.x0);
    if (x0s.length && Math.max(...x0s) - Math.min(...x0s) > 3) return null;   // centred or indented lines
    const family = items[lines[0][0]].ff;
    // how the document's font compares with the one measured here
    const k = its.reduce((w, it) => w + it.w, 0) / its.reduce((w, it) => w + measure(it.str, family), 0);
    if (!isFinite(k) || k <= 0) return null;
    const width = t => measure(t, family) * k;
    const space = width(' ');
    const right = Math.max(...geo.map(g => g.x1));
    const justified = geo.length > 1 && geo.slice(0, -1).every(g => right - g.x1 < 2);
    const words = text.trim().split(/\s+/);
    const fill = (cap, last) => {
      const take = [];
      let used = 0;
      while (w < words.length) {
        const add = width(words[w]) + (take.length ? space * (justified ? 0.85 : 1) : 0);
        if (!last && take.length && used + add > cap * 1.002) break;
        take.push(words[w++]);
        used += add;
      }
      return { text: take.join(' '), used };
    };
    let w = 0;
    const own = new Set(lines.flat());
    const size = Math.hypot(its[0].t[2], its[0].t[3]) || its[0].h || 10;
    const out = geo.map((g, n) => {
      const last = n === geo.length - 1;
      const edge = geo.length === 1 && open ? Math.max(column(g.x0), open(g, own, size)) : column(g.x0);
      const cap = justified && !last ? g.x1 - g.x0 : edge - g.x0;
      const { text: t } = fill(cap, false);
      return { line: n, text: t, justify: justified && !last, width: g.x1 - g.x0, cap };
    });
    // Words left over: the paragraph needs more lines. They go below it if
    // nothing else is there (and the overflow is worth a line); otherwise the
    // last line takes them and is squeezed a little.
    const more = [];
    if (w < words.length) {
      const lastGeo = geo[geo.length - 1], lastOut = out[out.length - 1];
      const rest = words.slice(w).join(' ');
      const leading = geo.length > 1 ? Math.abs(geo[0].y - geo[geo.length - 1].y) / (geo.length - 1) : size * 1.2;
      const cap = column(lastGeo.x0) - lastGeo.x0;
      const free = n => !items.some((it, i) => !own.has(i) && it.str.trim()
        && it.t[5] < lastGeo.y - 0.5 && it.t[5] > lastGeo.y - leading * (n + 0.6)
        && it.t[4] < lastGeo.x0 + cap && it.t[4] + it.w > lastGeo.x0);
      const lines2 = [];
      let left = words.slice(w);
      while (left.length) {
        const take = [];
        let used = 0;
        while (left.length) {
          const add = width(left[0]) + (take.length ? space : 0);
          if (take.length && used + add > cap) break;
          take.push(left.shift()); used += add;
        }
        lines2.push(take.join(' '));
      }
      if (width(rest) > cap * 0.03 && free(lines2.length)) {
        // the old last line is now a full line of the paragraph
        // (justified, it is as wide as the paragraph's other lines, not as it was)
        if (justified || geo.length === 1) Object.assign(lastOut, { justify: justified, ...(justified ? { width: right - lastGeo.x0 } : {}) });
        lines2.forEach((t, n) => more.push({ dy: -leading * (n + 1), text: t, cap }));
      } else {
        lastOut.text = [lastOut.text, rest].filter(Boolean).join(' ');
      }
    }
    const edits = [];
    out.forEach(({ line, text: t, justify, width: lw, cap }, n) => {
      const l = lines[line];
      const orig = l.map(i => items[i].str).join(' ').replace(/\s+/g, ' ').trim();
      const extra = n === out.length - 1 && more.length ? more : null;
      if (orig === t && !extra) return;             // this line reads as before
      l.forEach((i, j) => edits.push(j === 0
        ? { i, s: 0, e: items[i].str.length, t, line: { justify, width: lw, cap, ...(extra ? { more: extra } : {}) }, of: l[0] }
        : { i, s: 0, e: items[i].str.length, t: '', of: l[0] }));
    });
    return edits;
  }

  // reply(answer): the page's edits; redraw(answer): better edits after it was drawn
  async function convertPage({ page: idx, items, view }, reply, redraw) {
    const E = await engine();
    settings ||= await loadSettings();
    const pageText = items.map(it => it.str).join(' ');
    pagesText.set(idx, pageText);
    const docText = [...pagesText.values()].join(' ').slice(0, 20000);
    if (E.isMeta(pageText, 'page')) return reply({ edits: [], version: 1, changes: [] });
    const german = E.germanSpelling(docText, 3);
    const docGerman = germanish(docText);
    const jobs = [];
    for (const para of paragraphs(items)) {
      const asm = assemble(items, para);
      if (!asm.text.trim() || !(docGerman || germanish(asm.text))) continue;
      const r = E.convert(asm.text, { mode: settings.mode, context: pageText, german: german || E.germanSpelling(asm.text) });
      jobs.push({ asm, r, text: r.text });
    }
    const column = columns(items);
    const open = openRight(items, view);
    const room = lineRoom(items, column);
    const editsNow = () => jobs.flatMap(j => j.text === j.asm.text ? []
      : reflow(items, j.asm, j.text, column, open) || toItems(differences(j.asm.text, j.text), j.asm).map(ed => ({ ...ed, ...room.get(ed.i) })));
    const choices = settings.llm && jobs.some(j => j.r.pieces.some(p => typeof p === 'object'));
    let answered = false;
    // A final answer carries the page's list of changes (a cache may keep it);
    // one given before the model has spoken does not.
    const answer = (version, final) => { answered = true; reply({ edits: editsNow(), version, ...(final ? { changes: perPage.get(idx) } : {}) }); };
    if (!choices) { tally(idx, jobs); answer(1, true); return; }
    // The model settles the rest; the page waits for it a moment, so it is
    // drawn once, and is drawn again if the model takes longer.
    const timer = setTimeout(() => answer(1), 2500);
    for (const j of jobs) {
      if (!j.r.pieces.some(p => typeof p === 'object')) continue;
      try {
        await E.resolve(j.r.pieces, rankJobs => browser.runtime.sendMessage({ type: 'rank', jobs: rankJobs }));
        j.text = E.renderPieces(j.r.pieces);
      } catch { /* background not available: the rules' text stands */ }
    }
    clearTimeout(timer);
    tally(idx, jobs);
    if (!answered) answer(2, true);
    else redraw({ page: idx, edits: editsNow(), version: 2, changes: perPage.get(idx) });
  }

  // What changed on each page, for the popup's count and list.
  const perPage = new Map();
  function tally(idx, jobs) {
    perPage.set(idx, jobs.flatMap(j => differences(j.asm.text, j.text).map(d => [j.asm.text.slice(d.s, d.e), d.t])));
    publish();
  }
  // A page answered from a cache brings its list along.
  function remember(idx, list) {
    perPage.set(idx, list);
    publish();
  }
  function publish() {
    changes.clear();
    count = 0;
    for (const l of perPage.values()) for (const [from, to] of l) {
      count++;
      const k = from + '\0' + to;
      changes.set(k, (changes.get(k) || 0) + 1);
    }
    browser.runtime.sendMessage({
      type: 'count', count, meta: false, top: window.top === window, href: location.href,
      changes: [...changes].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([k, n]) => [...k.split('\0'), n]),
      names: [],
    }).catch(() => {});
  }

  return { convertPage, remember, status: () => ({ count, mode: settings?.mode || 'hamburg' }) };
})();
