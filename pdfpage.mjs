// Runs in the PDF viewer page itself, before pdf.js. The viewer is the
// browser's own (pdfjs/, see tools/sync_pdfjs.py); this file gives it what the
// browser normally provides from its privileged side, and the hooks through
// which converted text reaches the screen:
// - document.l10n: the viewer's strings (Fluent), in the browser's UI language;
// - globalThis.__hdfx: called by the patched pdf.mjs for every page, it asks
//   pdfview.js (the content script) for the page's converted text, then swaps
//   the glyphs of changed words as they are drawn and the words in the text
//   layer used for selecting, copying and finding.
import { textStream, onRedraw, highlightLayer } from './pdfhooks.mjs';

const BASE = new URL('pdfjs/', import.meta.url).href;
globalThis.__hdfxBase = BASE;
const root = document.documentElement;

// ---------- Fluent, for the viewer's strings ----------
// The viewer's .ftl files use messages, attributes, variables, plural and
// PLATFORM() selectors, NUMBER() and DATETIME(): this implements exactly that.

const LANG = root.dataset.hdfxLang || 'en-US';
const FSI = '⁨', PDI = '⁩';   // Fluent isolates placeables, as the browser does

function parseFtl(src) {
  const messages = new Map();
  let cur = null, attr = null;
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    let m;
    if (line.startsWith('#')) continue;
    if ((m = /^(-?[a-zA-Z][\w-]*) *= *(.*)$/.exec(line))) {
      cur = { value: m[2] ? [m[2]] : [], attrs: {} };
      attr = null;
      messages.set(m[1], cur);
    } else if (!cur) {
      continue;
    } else if ((m = /^\s+\.([\w-]+) *= *(.*)$/.exec(line))) {
      attr = m[1];
      cur.attrs[attr] = m[2] ? [m[2]] : [];
    } else if (line === '' || /^\s/.test(line)) {
      (attr ? cur.attrs[attr] : cur.value).push(line);
    } else {
      cur = null;
    }
  }
  // Fluent drops the common indentation of continuation lines, and blank lines at the end.
  const join = lines => {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return null;
    const inline = !/^\s/.test(lines[0]) ? [lines.shift()] : [];
    const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
    return [...inline, ...lines.map(l => l.slice(Number.isFinite(ind) ? ind : 0))].join('\n');
  };
  for (const msg of messages.values()) {
    msg.value = join(msg.value);
    for (const k of Object.keys(msg.attrs)) msg.attrs[k] = join(msg.attrs[k]) ?? '';
  }
  return messages;
}

// A pattern is text with { placeables }; a placeable may be a selector.
function parsePattern(src) {
  const out = [];
  let i = 0, text = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      if (text) out.push(text), text = '';
      const [node, end] = parsePlaceable(src, i + 1);
      out.push(node);
      i = end;
    } else { text += c; i++; }
  }
  if (text) out.push(text);
  return out;
}

function skipWs(s, i) { while (i < s.length && /\s/.test(s[i])) i++; return i; }

function parseExpr(s, i) {
  i = skipWs(s, i);
  let m;
  if (s[i] === '"') {
    const j = s.indexOf('"', i + 1);
    return [{ type: 'str', value: s.slice(i + 1, j) }, j + 1];
  }
  if ((m = /^\$([\w-]+)/.exec(s.slice(i)))) return [{ type: 'var', name: m[1] }, i + m[0].length];
  if ((m = /^-?\d+(?:\.\d+)?/.exec(s.slice(i)))) return [{ type: 'num', value: +m[0] }, i + m[0].length];
  if ((m = /^([A-Z][A-Z0-9_]*)\(/.exec(s.slice(i)))) {
    i += m[0].length;
    const args = [], named = {};
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === ')') { i++; break; }
      if (s[i] === ',') { i++; continue; }
      const nm = /^([\w-]+)\s*:\s*/.exec(s.slice(i));
      if (nm) {
        i += nm[0].length;
        const [v, e] = parseExpr(s, i);
        named[nm[1]] = v.value; i = e;
      } else {
        const [v, e] = parseExpr(s, i);
        args.push(v); i = e;
      }
    }
    return [{ type: 'fn', name: m[1], args, named }, i];
  }
  if ((m = /^(-?[a-zA-Z][\w-]*)(?:\.([\w-]+))?/.exec(s.slice(i)))) return [{ type: 'ref', id: m[1], attr: m[2] }, i + m[0].length];
  throw new Error('ftl: cannot parse ' + s.slice(i, i + 20));
}

function parsePlaceable(s, i) {
  const [sel, j0] = parseExpr(s, i);
  let j = skipWs(s, j0);
  if (s[j] === '}') return [sel, j + 1];
  if (s.slice(j, j + 2) !== '->') throw new Error('ftl: expected -> at ' + s.slice(j, j + 20));
  j += 2;
  const variants = [];
  let def = 0;
  for (;;) {
    j = skipWs(s, j);
    if (s[j] === '}') { j++; break; }
    const star = s[j] === '*';
    if (star) j++;
    const close = s.indexOf(']', j);
    const key = s.slice(j + 1, close).trim();
    j = close + 1;
    // the variant's pattern runs to the next line starting with [ or *[ or the closing }
    let depth = 0, k = j;
    for (; k < s.length; k++) {
      if (s[k] === '{') depth++;
      else if (s[k] === '}') { if (depth === 0) break; depth--; }
      else if (s[k] === '\n' && depth === 0 && /^\s*(\*?\[|\})/.test(s.slice(k + 1))) break;
    }
    const body = s.slice(j, k).replace(/^[ \t]+/, '').replace(/\n[ \t]+/g, '\n').trim();
    if (star) def = variants.length;
    variants.push({ key, pattern: parsePattern(body) });
    j = k;
  }
  return [{ type: 'select', sel, variants, def }, j];
}

const plural = new Intl.PluralRules(LANG);
const PLATFORM = /Win/.test(navigator.platform) ? 'windows' : /Mac/.test(navigator.platform) ? 'macos' : /Linux/.test(navigator.platform) ? 'linux' : 'other';

class Bundle {
  constructor(messages) { this.messages = messages; this.cache = new Map(); }
  pattern(src) {
    if (!this.cache.has(src)) this.cache.set(src, parsePattern(src));
    return this.cache.get(src);
  }
  value(node, args) {
    switch (node.type) {
      case 'str': return node.value;
      case 'num': return node.value;
      case 'var': return args?.[node.name];
      case 'ref': {
        const m = this.messages.get(node.id);
        const src = m && (node.attr ? m.attrs[node.attr] : m.value);
        return src == null ? `{${node.id}}` : this.format(src, args);
      }
      case 'fn': {
        const v = node.args[0] ? this.value(node.args[0], args) : undefined;
        if (node.name === 'NUMBER') return typeof v === 'number' ? new Intl.NumberFormat(LANG, node.named).format(v) : v;
        if (node.name === 'DATETIME') { const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? String(v) : new Intl.DateTimeFormat(LANG, node.named).format(d); }
        if (node.name === 'PLATFORM') return PLATFORM;
        return v;
      }
      case 'select': {
        const v = this.value(node.sel, args);
        let hit = node.variants.findIndex(x => x.key === String(v));
        if (hit < 0 && typeof v === 'number') hit = node.variants.findIndex(x => x.key === plural.select(v));
        if (hit < 0 && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) hit = node.variants.findIndex(x => x.key === plural.select(+v));
        return this.render(node.variants[hit < 0 ? node.def : hit].pattern, args);
      }
    }
    return '';
  }
  render(parts, args) {
    let out = '';
    for (const p of parts) {
      if (typeof p === 'string') { out += p; continue; }
      let v = this.value(p, args);
      if (typeof v === 'number') v = new Intl.NumberFormat(LANG).format(v);
      out += p.type === 'select' ? v : FSI + (v ?? '') + PDI;
    }
    return out;
  }
  format(src, args) { return this.render(this.pattern(src), args); }
}

const ftl = document.getElementById('hdfx-ftl');
const bundle = new Bundle(parseFtl(ftl?.textContent || ''));
ftl?.remove();

function formatMessage(id, args) {
  const m = bundle.messages.get(id);
  if (!m) return null;
  return {
    value: m.value == null ? null : bundle.format(m.value, args),
    attributes: Object.entries(m.attrs).map(([name, src]) => ({ name, value: bundle.format(src, args) })),
  };
}

const roots = new Set();
let paused = false;
const observer = new MutationObserver(muts => {
  if (paused) return;
  const els = new Set();
  for (const m of muts) {
    if (m.type === 'attributes') els.add(m.target);
    else for (const n of m.addedNodes) if (n.nodeType === 1) {
      if (n.hasAttribute('data-l10n-id')) els.add(n);
      n.querySelectorAll('[data-l10n-id]').forEach(e => els.add(e));
    }
  }
  translateElements([...els]);
});

function translateElement(el) {
  const id = el.getAttribute('data-l10n-id');
  if (!id) return;
  let args = null;
  try { args = JSON.parse(el.getAttribute('data-l10n-args') || 'null'); } catch {}
  const msg = formatMessage(id, args);
  if (!msg) return;
  if (msg.value != null && !el.firstElementChild && el.textContent !== msg.value) el.textContent = msg.value;
  for (const { name, value } of msg.attributes) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function translateElements(els) {
  const was = paused;
  paused = true;
  for (const el of els) translateElement(el);
  observer.takeRecords();
  paused = was;
  return Promise.resolve();
}

const l10n = {
  ready: Promise.resolve(),
  async formatMessages(keys) { return keys.map(({ id, args }) => formatMessage(id, args)); },
  async formatValue(id, args) { return formatMessage(id, args)?.value ?? null; },
  async formatValues(keys) { return keys.map(({ id, args }) => formatMessage(id, args)?.value ?? null); },
  setAttributes(el, id, args) {
    el.setAttribute('data-l10n-id', id);
    if (args) el.setAttribute('data-l10n-args', JSON.stringify(args)); else el.removeAttribute('data-l10n-args');
  },
  getAttributes(el) {
    let args = null;
    try { args = JSON.parse(el.getAttribute('data-l10n-args') || 'null'); } catch {}
    return { id: el.getAttribute('data-l10n-id'), args };
  },
  connectRoot(el) {
    roots.add(el);
    observer.observe(el, { attributes: true, attributeFilter: ['data-l10n-id', 'data-l10n-args'], childList: true, subtree: true });
  },
  disconnectRoot(el) { roots.delete(el); },
  translateRoots() {
    const els = [];
    for (const r of roots) {
      if (r.hasAttribute?.('data-l10n-id')) els.push(r);
      els.push(...r.querySelectorAll('[data-l10n-id]'));
    }
    return translateElements(els);
  },
  translateElements,
  translateFragment(frag) { return translateElements([...frag.querySelectorAll('[data-l10n-id]')]); },
  pauseObserving() { paused = true; },
  resumeObserving() { paused = false; },
};
Object.defineProperty(Document.prototype, 'l10n', { configurable: true, get() { return this === document ? l10n : undefined; } });
// The browser localizes its viewer page as a whole, before it is shown.
l10n.connectRoot(root);
l10n.translateRoots();

// The browser starts the viewer's worker before the viewer asks for it. On a
// site's page a worker may not come from the extension, so a blob imports it;
// on the extension's own page (a PDF from this computer) the extension's
// rules forbid blob workers, and the worker is the extension's file itself.
const WORKER = BASE + 'build/pdf.worker.mjs';
globalThis.pdfjsPreloadedWorker = location.protocol === 'moz-extension:'
  ? new Worker(WORKER, { type: 'module' })
  : new Worker(URL.createObjectURL(new Blob([`import ${JSON.stringify(WORKER)};`], { type: 'text/javascript' })), { type: 'module' });

// ---------- converted text, drawn and selectable (pdfhooks.mjs) ----------

onRedraw(idx => {
  const app = globalThis.PDFViewerApplication;
  const view = app?.pdfViewer?.getPageView(idx);
  if (view) { view.reset?.(); app.pdfViewer.update?.(); app.forceRendering?.(); }
  app?.pdfThumbnailViewer?.getThumbnail?.(idx)?.reset?.();
  if (findLayers.has(idx)) { findLayers.get(idx).remove(); findLayers.delete(idx); findQueue.push(idx); pumpFind(); }
});

// ---------- find ----------
// The browser's find bar searches this page's text. pdf.js only makes text for
// pages it has drawn, so every other page gets its (converted) text from here,
// in pdf.js's own TextLayer, invisible like pdf.js's. When pdf.js draws the
// page it brings its own layer: this one goes, and a match the find bar had
// selected in it is selected again in pdf.js's layer.
const FIND = 'hdfx-find';
const findLayers = new Map();   // pageIndex -> div
let findQueue = [], findBusy = false;

const textNodes = el => {
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const out = [];
  for (let n; (n = tw.nextNode());) out.push(n);
  return out;
};

function handOver(ours, theirs) {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  if (!ours.contains(r.startContainer)) return;
  const a = textNodes(ours), b = textNodes(theirs);
  const map = (node, off) => { const i = a.indexOf(node); return i >= 0 && b[i] ? [b[i], Math.min(off, b[i].length)] : null; };
  const s = map(r.startContainer, r.startOffset), e = map(r.endContainer, r.endOffset);
  if (s && e) sel.setBaseAndExtent(s[0], s[1], e[0], e[1]);
}

function ownLayer(view) {
  const div = view.textLayer?.div;
  return div && div.isConnected && div.childNodes.length ? div : null;
}

async function buildFindLayer(view) {
  const idx = view.id - 1;
  if (ownLayer(view) || findLayers.get(idx)?.isConnected || !view.pdfPage || !view.div) return;
  const { TextLayer, setLayerDimensions } = globalThis.pdfjsLib;
  const div = document.createElement('div');
  div.className = 'textLayer ' + FIND;
  setLayerDimensions(div, view.viewport);
  const layer = new TextLayer({ textContentSource: textStream(view.pdfPage, { includeMarkedContent: true, disableNormalization: true }), container: div, viewport: view.viewport });
  await layer.render();
  if (ownLayer(view)) return;            // pdf.js was faster
  view.div.append(div);
  findLayers.set(idx, div);
}

async function pumpFind() {
  if (findBusy) return;
  findBusy = true;
  const viewer = globalThis.PDFViewerApplication?.pdfViewer;
  while (findQueue.length && viewer) {
    const idx = findQueue.shift();
    const view = viewer.getPageView(idx);
    try { if (view) await buildFindLayer(view); } catch (err) { console.error('[Hochdeutsch-Fixer]', err); }
    await new Promise(r => setTimeout(r, 0));
  }
  findBusy = false;
}

function queueAll() {
  const viewer = globalThis.PDFViewerApplication?.pdfViewer;
  if (!viewer?.pagesCount) return;
  const cur = (viewer.currentPageNumber || 1) - 1;
  // nearby pages first
  findQueue = [...Array(viewer.pagesCount).keys()].sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
  pumpFind();
}

function dropFindLayers() {
  for (const div of findLayers.values()) div.remove();
  findLayers.clear();
}

(function watchViewer() {
  const app = globalThis.PDFViewerApplication;
  if (!app?.eventBus) { setTimeout(watchViewer, 50); return; }
  const bus = app.eventBus;
  bus.on('pagesloaded', queueAll);
  bus.on('textlayerrendered', ({ pageNumber, source }) => {
    if (source?.textLayer?.div) highlightLayer(source.textLayer.div, pageNumber - 1);
    const ours = findLayers.get(pageNumber - 1);
    if (!ours) return;
    const theirs = source?.textLayer?.div;
    if (theirs) handOver(ours, theirs);
    ours.remove();
    findLayers.delete(pageNumber - 1);
  });
  // a new zoom gives every page new dimensions; pdf.js's own layers follow, these are made again
  bus.on('scalechanging', () => { dropFindLayers(); setTimeout(queueAll, 300); });
  bus.on('rotationchanging', () => { dropFindLayers(); setTimeout(queueAll, 300); });
  // pdf.js may drop a far-away page's layer to save memory; then this page needs ours again
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.removedNodes)
      if (n.nodeType === 1 && n.classList.contains('textLayer') && !n.classList.contains(FIND)) {
        const page = m.target.closest?.('.page');
        const idx = page ? +page.dataset.pageNumber - 1 : -1;
        if (idx >= 0 && !findQueue.includes(idx)) { findQueue.push(idx); pumpFind(); }
      }
  }).observe(document.getElementById('viewer') || document.body, { childList: true, subtree: true });
})();
