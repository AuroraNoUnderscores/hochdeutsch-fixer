// Holds the baby LLM for the whole browser session and answers ranking requests
// from content scripts, one at a time. Decisions are cached; context-free ones
// (a word's ß spelling) by word, so a page full of "Strasse" costs one call.
import { load, score, eszett, MODEL } from './llm.js';
import { download as pdfDownload, verify as pdfVerify, local as pdfLocal } from './pdfnet.js';

const state = { status: 'idle', progress: 0, decided: 0, error: null, model: MODEL };
const cache = new Map();
const log = [];   // what the model recently did, for the popup

function note(entry) {
  log.unshift(entry);
  log.length = Math.min(log.length, 20);
}
let chain = Promise.resolve();
let started = null;

function ensure() {
  started ??= (async () => {
    state.status = 'loading';
    state.progress = 0;
    try {
      await load(p => {
        if (p.status === 'progress' && /\.onnx/.test(p.file || '')) state.progress = Math.round(p.progress || 0);
      });
      state.status = 'ready';
      state.progress = 100;
    } catch (e) {
      state.status = 'error';
      state.error = String(e?.message || e);
      started = null;
      throw e;
    }
  })();
  return started;
}

async function rank(jobs) {
  const { llm = true } = await browser.storage.local.get('llm');
  if (!llm) return null;
  // The general model downloads; if it cannot (offline, blocked), the bundled
  // eszett model still decides ss/ß and names, and the rules' defaults stand.
  let general = true;
  if (jobs.some(j => j.type !== 'eszett')) await ensure().catch(() => { general = false; });
  chain = chain.then(async () => {
    const picks = [];
    for (const j of jobs) {
      if (j.type === 'eszett') {                        // ss/ß for a whole text, one pass
        picks.push(await eszett(j.text, j.offsets, j.spans));
        state.decided += j.offsets.length;
        continue;
      }
      if (!general) { picks.push(null); continue; }
      const key = j.cf && j.key ? j.key : JSON.stringify([j.texts, j.def, j.conf]);
      if (cache.has(key)) { picks.push(cache.get(key)); continue; }
      const scores = await score(j.texts);
      let best = scores.indexOf(Math.max(...scores));
      // Only overrule the rules when clearly better; a near-tie keeps their
      // default, which is what stops confident-sounding nonsense.
      const def = j.def ?? 0;
      const margin = scores[best] - scores[def];
      const shy = best !== def && margin < (j.conf ?? 0);
      if (shy) best = def;
      if (j.opts && (best !== def || shy)) note({
        from: j.opts[def], to: j.opts[shy ? scores.indexOf(Math.max(...scores)) : best],
        margin: +margin.toFixed(1), kept: shy,
      });
      cache.set(key, best);
      if (cache.size > 20000) cache.delete(cache.keys().next().value);
      state.decided++;
      picks.push(best);
    }
    return picks;
  }).catch(e => { console.error('[Hochdeutsch-Fixer]', e); return null; });
  return chain;
}

// What each frame of each tab has changed. The popup talks only to the top
// frame, but the work often happens in an iframe (an artifact, an embedded
// reader), so the totals are collected here.
const tabCounts = new Map(); // tabId -> { href, frames: Map(frameId -> {count, meta}) }

function noteCount(sender, msg) {
  const id = sender.tab?.id;
  if (id == null) return;
  let entry = tabCounts.get(id);
  if (!entry || (msg.top && entry.href !== msg.href)) {
    entry = { href: msg.top ? msg.href : entry?.href, frames: new Map() };
    tabCounts.set(id, entry);
  }
  entry.frames.set(sender.frameId ?? 0, { count: msg.count, meta: msg.meta, changes: msg.changes || [], names: msg.names || [] });
}

function tabTotal(id) {
  const entry = tabCounts.get(id);
  if (!entry) return null;
  let count = 0, meta = false, frames = 0;
  const changes = new Map(), names = new Map();
  for (const [frameId, f] of entry.frames) {
    count += f.count;
    if (f.count) frames++;
    if (frameId === 0) meta = f.meta;
    for (const [from, to, n] of f.changes) changes.set(from + '\0' + to, (changes.get(from + '\0' + to) || 0) + n);
    for (const [word, n] of f.names) names.set(word, (names.get(word) || 0) + n);
  }
  const sorted = m => [...m].sort((p, q) => q[1] - p[1]);
  return {
    count, frames, meta,
    changes: sorted(changes).map(([k, n]) => [...k.split('\0'), n]),
    names: sorted(names),
  };
}

browser.tabs?.onRemoved.addListener(id => tabCounts.delete(id));

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'count') { noteCount(sender, msg); return; }
  if (msg?.type === 'tab-count') return Promise.resolve(tabTotal(msg.tabId));
  if (msg?.type === 'rank') return rank(msg.jobs);
  if (msg?.type === 'llm-status') return Promise.resolve({ ...state, log: log.slice(0, 5) });
  if (msg?.type === 'llm-load') { ensure().catch(() => {}); return Promise.resolve(true); }
  if (msg?.type === 'pdf-verify') return Promise.resolve(pdfVerify(msg.token, sender));
  if (msg?.type === 'pdf-download') return pdfVerify(msg.token, sender) ? pdfDownload(msg) : Promise.resolve();
  if (msg?.type === 'pdf-browser-info') return pdfBrowserInfo();
  if (msg?.type === 'pdf-local') return pdfLocal(msg, sender);
  if (msg?.type === 'top-host') {
    try { return Promise.resolve(new URL(sender.tab?.url || '').hostname || null); } catch { return Promise.resolve(null); }
  }
});

// What the browser's own viewer is told about the browser (PdfStreamConverter's
// getBrowserPrefs); the limits are the browser's defaults.
let browserInfo = null;
function pdfBrowserInfo() {
  browserInfo ??= (async () => {
    const [b, p] = await Promise.all([browser.runtime.getBrowserInfo(), browser.runtime.getPlatformInfo()]);
    return {
      version: b.version,
      os: p.os === 'win' ? 'WINNT' : p.os === 'mac' ? 'Darwin' : 'Linux',
      locale: browser.i18n.getUILanguage(),
      allowedGlobalEvents: ['documentloaded', 'pagesloaded', 'layersloaded', 'outlineloaded'],
      canvasMaxAreaInBytes: 2147483647,
      maxCanvasDim: 65535,
    };
  })();
  return browserInfo;
}
