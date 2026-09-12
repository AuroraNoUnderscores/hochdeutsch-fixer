// Holds the baby LLM for the whole browser session and answers ranking requests
// from content scripts, one at a time. Decisions are cached; context-free ones
// (a word's ß spelling) by word, so a page full of "Strasse" costs one call.
import { load, score, MODEL } from './llm.js';

const state = { status: 'idle', progress: 0, decided: 0, error: null, model: MODEL };
const cache = new Map();
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
  await ensure();
  chain = chain.then(async () => {
    const picks = [];
    for (const j of jobs) {
      const key = j.cf && j.key ? j.key : JSON.stringify(j.texts);
      if (cache.has(key)) { picks.push(cache.get(key)); continue; }
      const scores = await score(j.texts);
      const best = scores.indexOf(Math.max(...scores));
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
  entry.frames.set(sender.frameId ?? 0, { count: msg.count, meta: msg.meta });
}

function tabTotal(id) {
  const entry = tabCounts.get(id);
  if (!entry) return null;
  let count = 0, meta = false, frames = 0;
  for (const [frameId, f] of entry.frames) {
    count += f.count;
    if (f.count) frames++;
    if (frameId === 0) meta = f.meta;
  }
  return { count, frames, meta };
}

browser.tabs?.onRemoved.addListener(id => tabCounts.delete(id));

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'count') { noteCount(sender, msg); return; }
  if (msg?.type === 'tab-count') return Promise.resolve(tabTotal(msg.tabId));
  if (msg?.type === 'rank') return rank(msg.jobs);
  if (msg?.type === 'llm-status') return Promise.resolve({ ...state });
  if (msg?.type === 'llm-load') { ensure().catch(() => {}); return Promise.resolve(true); }
  if (msg?.type === 'top-host') {
    try { return Promise.resolve(new URL(sender.tab?.url || '').hostname || null); } catch { return Promise.resolve(null); }
  }
});
