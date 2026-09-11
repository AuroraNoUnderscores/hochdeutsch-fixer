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

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'rank') return rank(msg.jobs);
  if (msg?.type === 'llm-status') return Promise.resolve({ ...state });
  if (msg?.type === 'llm-load') { ensure().catch(() => {}); return Promise.resolve(true); }
  if (msg?.type === 'top-host') {
    try { return Promise.resolve(new URL(sender.tab?.url || '').hostname || null); } catch { return Promise.resolve(null); }
  }
});
