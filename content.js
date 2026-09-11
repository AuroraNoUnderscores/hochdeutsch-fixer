// Rewrites Swiss Standard German on the page. Two passes: the rules land
// immediately, then the baby LLM settles the choices they could not decide and
// the text is patched again. Only text nodes are touched (never the DOM
// structure), and originals are kept so switching off restores the page.
(() => {
  const E = globalThis.HD_ENGINE;
  const originals = new Map(); // text node -> { orig, conv, counted }
  let host = location.hostname;
  let mode = 'hamburg', llm = true, count = 0, active = false, observer = null;
  const queue = [];
  let pumping = false;

  const SKIP = 'script,style,noscript,textarea,input,select,code,pre,kbd,samp,[contenteditable=""],[contenteditable="true"]';
  const BLOCK = 'p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,figcaption,dd,dt,section,article,main,div,body';
  const GERMAN = /\b(der|die|das|den|dem|des|und|ist|sind|war|nicht|mit|für|ein|eine|einen|einem|von|zu|zum|zur|auf|sich|wir|wird|werden|auch|aber|oder|im|am|beim|vom|bei|dass|haben|hat|habe|hast|hatte|kann|muss|nach|über|nur|noch|wie|was|schon|sehr|man|als|wenn|ich|mir|mich|dir|uns|euch|bin|bist|mein|meine|dein|sein|seine|kein|keine|wurde|bitte|danke|viele|heute|gestern|jetzt|hier|dort)\b/gi;
  const blocks = new WeakMap();

  // The block a text node sits in: its text decides the language, and gives the
  // rules the topic they need for words like "Busse" (fine, or buses?).
  function blockInfo(node) {
    let el = node.parentElement?.closest(BLOCK);
    while (el && el !== document.body && el.textContent.trim().length < 60 && el.parentElement)
      el = el.parentElement.closest(BLOCK);
    if (!el) return { german: false, text: '' };
    const len = el.textContent.length;
    let info = blocks.get(el);
    if (!info || Math.abs(info.len - len) > 40) {
      const text = el.textContent.slice(0, 3000);
      const hits = (text.match(GERMAN) || []).length;
      info = { len, text, german: hits >= 2 || (hits >= 1 && /[äöüßÄÖÜ]/.test(text)) };
      blocks.set(el, info);
    }
    return info;
  }

  function eligible(node) {
    const el = node.parentElement;
    if (!el || el.isContentEditable || el.closest(SKIP)) return false;
    // A page's lang is often its interface language, not the text's: webmail
    // shows German mail inside lang="en". So German-looking text counts too.
    const lang = el.closest('[lang]')?.lang;
    if (lang && /^(de|gsw)\b/i.test(lang)) return true;
    return blockInfo(node).german;
  }

  const inView = node => {
    const r = node.parentElement?.getBoundingClientRect();
    return r && r.bottom > 0 && r.top < innerHeight;
  };

  function fix(node) {
    if (originals.get(node)?.conv === node.nodeValue) return; // our own write
    if (!eligible(node)) return;
    const r = E.convert(node.nodeValue, { mode, context: blockInfo(node).text });
    const choices = r.pieces.some(p => typeof p === 'object');
    if (!r.changes && !choices) return;
    const rec = { orig: node.nodeValue, conv: r.changes ? r.text : node.nodeValue, counted: r.changes };
    originals.set(node, rec);
    if (r.changes) { node.nodeValue = r.text; count += r.changes; }
    if (choices && llm) {
      const item = { node, rec, pieces: r.pieces, fixed: r.fixed };
      inView(node) ? queue.unshift(item) : queue.push(item);
      pump();
    }
  }

  async function pump() {
    if (pumping || !llm) return;
    pumping = true;
    while (queue.length && active && llm) {
      const { node, rec, pieces, fixed } = queue.shift();
      if (originals.get(node) !== rec || rec.conv !== node.nodeValue) continue; // page moved on
      let moved = false;
      try {
        moved = await E.resolve(pieces, jobs => browser.runtime.sendMessage({ type: 'rank', jobs }));
      } catch { /* background not available */ }
      if (!moved || !active) continue;
      if (originals.get(node) !== rec || rec.conv !== node.nodeValue) continue;
      const text = E.renderPieces(pieces);
      const now = fixed + E.countChoices(pieces);
      count += now - rec.counted;
      rec.counted = now;
      rec.conv = text;
      node.nodeValue = text;
    }
    pumping = false;
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) return fix(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) fix(n);
  }

  function start() {
    active = true;
    walk(document.documentElement);
    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') fix(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function stop() {
    active = false;
    observer?.disconnect();
    observer = null;
    queue.length = 0;
    for (const [node, { orig, conv }] of originals) if (node.nodeValue === conv) node.nodeValue = orig;
    originals.clear();
    count = 0;
  }

  async function sync() {
    const s = await browser.storage.local.get(['enabled', 'disabledSites', 'mode', 'llm']);
    const want = s.enabled !== false && !(s.disabledSites || []).includes(host);
    const newMode = s.mode || 'hamburg';
    const newLlm = s.llm !== false;
    const reload = active && (newMode !== mode || (newLlm && !llm));
    mode = newMode;
    llm = newLlm;
    if (reload) stop();
    if (want && !active) start();
    else if (!want && active) stop();
    if (active && llm) pump();
  }

  browser.storage.onChanged.addListener(sync);
  browser.runtime.onMessage.addListener(msg => {
    if (msg === 'hd-status' && window.top === window)
      return Promise.resolve({ host, count, active, mode, pending: queue.length });
  });

  (async () => {
    if (window.top !== window) {
      try { host = await browser.runtime.sendMessage({ type: 'top-host' }) || host; } catch {}
    }
    sync();
  })();
})();
