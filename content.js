// Rewrites Swiss Standard German on the page. Two passes: the rules land
// immediately, then the baby LLM settles the choices they could not decide and
// the text is patched again. Only text nodes are touched (never the DOM
// structure), and originals are kept so switching off restores the page.
(() => {
  // A PDF shown in the viewer page is converted by pdfview.js instead.
  if (document.documentElement?.hasAttribute('data-hdfx-pdf')) return;
  const E = globalThis.HD_ENGINE;
  const originals = new Map(); // text node -> { orig, conv, counted }
  let host = location.hostname;
  let mode = 'hamburg', llm = true, count = 0, active = false, observer = null, pageMeta = false, pageGerman = false;
  const queue = [];
  let pumping = false;
  let reported = '', reportTimer = null;
  let highlight = false;

  // Tell the background what this frame has done, so the popup can add up all
  // frames. Work often happens in an iframe the popup never talks to.
  function report() {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      const { changes, names } = summary();
      const sig = JSON.stringify([count, pageMeta, changes, names]);
      if (sig === reported) return;
      reported = sig;
      browser.runtime.sendMessage({
        type: 'count', count, meta: pageMeta, changes, names,
        top: window.top === window, href: location.href,
      }).catch(() => {});
      paint();
    }, 300);
  }

  // ---------- what changed, for the popup's list and the highlights ----------

  const TOKEN = /\p{L}+|\p{N}+(?:['’.,]\p{N}+)*|\s+|[^\p{L}\p{N}\s]/gu;   // 1'250'000 is one token
  const RESYNC = 3;     // tokens that must match again after a change
  const REACH = 40;     // how far, in tokens, a change may reach on either side

  // Word-level differences between a node's original and converted text, as
  // [start, end, from, to] with offsets into the converted text. Rewrites are
  // local (a word, an article with its noun, a particle moved to the clause end),
  // so after a mismatch the next few matching tokens are searched for nearby.
  function diff(a, b) {
    const x = a.match(TOKEN) || [], y = b.match(TOKEN) || [];
    const out = [];
    let i = 0, j = 0, at = 0;
    const same = (p, q) => {
      for (let k = 0; k < RESYNC; k++) {
        if (p + k >= x.length && q + k >= y.length) return true;
        if (x[p + k] !== y[q + k]) return false;
      }
      return true;
    };
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { at += y[j].length; i++; j++; continue; }
      let best = null;
      for (let s = 1; s <= 2 * REACH && !best; s++)
        for (let di = Math.max(0, s - REACH); di <= Math.min(s, REACH); di++) {
          const dj = s - di;
          if (i + di <= x.length && j + dj <= y.length && same(i + di, j + dj)) { best = [di, dj]; break; }
        }
      const [di, dj] = best || [x.length - i, y.length - j];
      let from = x.slice(i, i + di).join(''), to = y.slice(j, j + dj).join('');
      let start = at;
      // A bare insertion or deletion ("… nach Bern" -> "… nach Bern um") reads
      // better with the word before it.
      if ((!from.trim() || !to.trim()) && (from.trim() || to.trim())) {
        let k = 1;
        while (i - k >= 0 && /^\s+$/.test(x[i - k])) k++;
        if (i - k >= 0) {
          const before = x.slice(i - k, i).join('');
          from = before + from; to = before + to; start -= before.length;
        }
      }
      const lead = to.length - to.trimStart().length;
      if (from.trim() || to.trim())
        out.push([start + lead, start + to.trimEnd().length, from.trim(), to.trim()]);
      at += y.slice(j, j + dj).join('').length; i += di; j += dj;
    }
    return out;
  }

  const changesOf = rec => {
    if (rec.diff?.conv !== rec.conv) rec.diff = { conv: rec.conv, list: diff(rec.orig, rec.conv) };
    return rec.diff.list;
  };

  // Words the model kept because they are part of a name, with their offsets in
  // the converted text: just the name word, not the article that came with it.
  function namesOf(rec) {
    if (!rec.pieces) return [];
    const out = [];
    let at = 0;
    for (const p of rec.pieces) {
      const text = typeof p === 'string' ? p : E.renderPieces([p]);
      if (typeof p === 'object' && p.named && p.options[p.pick] !== p.orig) {
        const off = Math.max(0, p.name[0] - p.at), len = p.name[1] - p.name[0];
        out.push([at + off, at + off + len, p.orig.slice(off, off + len)]);
      }
      at += text.length;
    }
    return out;
  }

  function summary() {
    const changes = new Map(), names = new Map();
    for (const [node, rec] of originals) {
      if (node.nodeValue !== rec.conv) continue;
      for (const [, , from, to] of changesOf(rec)) {
        const k = from + '\0' + to;
        changes.set(k, (changes.get(k) || 0) + 1);
      }
      for (const [, , word] of namesOf(rec)) names.set(word, (names.get(word) || 0) + 1);
    }
    const top = (m, n) => [...m].sort((p, q) => q[1] - p[1]).slice(0, n);
    return {
      changes: top(changes, 300).map(([k, n]) => [...k.split('\0'), n]),
      names: top(names, 100),
    };
  }

  // Changed words tinted, names the model kept underlined. CSS Custom
  // Highlights colour text ranges without wrapping them in elements, so the page
  // itself stays exactly as the site built it.
  const STYLE_ID = 'hochdeutsch-fixer-highlight';
  function paint() {
    if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
    CSS.highlights.delete('hd-changed');
    CSS.highlights.delete('hd-name');
    document.getElementById(STYLE_ID)?.remove();
    if (!highlight || !active) return;
    const changed = [], kept = [];
    const range = (node, a, b) => {
      const r = document.createRange();
      r.setStart(node, Math.min(a, node.length));
      r.setEnd(node, Math.min(b, node.length));
      return r;
    };
    for (const [node, rec] of originals) {
      if (node.nodeValue !== rec.conv || !node.isConnected) continue;
      for (const [a, b] of changesOf(rec)) if (b > a) changed.push(range(node, a, b));
      for (const [a, b] of namesOf(rec)) kept.push(range(node, a, b));
    }
    CSS.highlights.set('hd-changed', new Highlight(...changed));
    CSS.highlights.set('hd-name', new Highlight(...kept));
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '::highlight(hd-changed){background-color:rgba(255,200,0,.45)}'
      + '::highlight(hd-name){text-decoration:underline dotted #0a84ff 2px}';
    (document.head || document.documentElement).append(style);
  }

  const SKIP = 'script,style,noscript,textarea,input,select,code,pre,kbd,samp,[contenteditable=""],[contenteditable="true"]';
  // Italics, quotes and definition markup around a word or two name the word
  // rather than use it: "in der Schweiz sagt man <em>Velo</em>".
  const MENTION = 'em,i,q,cite,dfn,abbr,var';
  const BLOCK = 'p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,figcaption,dd,dt,section,article,main,div,body';
  // (\b would not see a word boundary before "über": JavaScript's \b is ASCII-only)
  const GERMAN = /(?<!\p{L})(?:der|die|das|den|dem|des|und|ist|sind|war|nicht|mit|für|ein|eine|einen|einem|von|zu|zum|zur|auf|sich|wir|wird|werden|auch|aber|oder|im|am|beim|vom|bei|dass|haben|hat|habe|hast|hatte|kann|muss|nach|über|nur|noch|wie|was|schon|sehr|man|als|wenn|ich|mir|mich|dir|uns|euch|bin|bist|mein|meine|dein|sein|seine|kein|keine|wurde|bitte|danke|viele|heute|gestern|jetzt|hier|dort)(?!\p{L})/giu;
  const blocks = new WeakMap();

  // A text node as the site wrote it, not as this extension changed it: the
  // spelling check must not count the ß written here.
  const origText = n => { const rec = originals.get(n); return rec && n.nodeValue === rec.conv ? rec.orig : n.nodeValue; };

  // Text of an element as the site wrote it: script and style contents would
  // otherwise count towards the language check and the topic cues.
  function visibleText(el, max = 3000) {
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement?.closest('script,style,noscript,template')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let out = '';
    for (let n; (n = tw.nextNode()) && out.length < max;) out += origText(n) + ' ';
    return out.slice(0, max);
  }

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
      const text = visibleText(el);
      const hits = (text.match(GERMAN) || []).length;
      info = { len, text, german: hits >= 2 || (hits >= 1 && /[äöüßÄÖÜ]/.test(text)), eszett: E.germanSpelling(text) };
      blocks.set(el, info);
    }
    return info;
  }

  function eligible(node) {
    const el = node.parentElement;
    if (!el || el.isContentEditable || el.closest(SKIP)) return false;
    const mention = el.closest(MENTION);
    if (mention && mention.textContent.trim().split(/\s+/).length <= 3) return false;
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
    const info = blockInfo(node);
    // Text already in German spelling keeps its ss and its German words.
    const r = E.convert(node.nodeValue, { mode, meta: pageMeta, context: info.text, german: pageGerman || info.eszett });
    const choices = r.pieces.some(p => typeof p === 'object');
    if (!r.changes && !choices) return;
    const rec = { orig: node.nodeValue, conv: r.changes ? r.text : node.nodeValue, counted: r.changes, pieces: r.pieces };
    originals.set(node, rec);
    if (r.changes) { node.nodeValue = r.text; count += r.changes; report(); }
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
      if (!moved || !active) { report(); continue; }   // names the model kept still count for the list
      if (originals.get(node) !== rec || rec.conv !== node.nodeValue) continue;
      const text = E.renderPieces(pieces);
      const now = fixed + E.countChoices(pieces);
      count += now - rec.counted;
      rec.counted = now;
      rec.conv = text;
      node.nodeValue = text;
      report();
    }
    pumping = false;
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) return fix(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) fix(n);
  }

  // A whole page about language (a spelling blog, a dictionary entry) is left
  // alone, not just the paragraphs whose own text gives it away. Anything
  // already changed is put back. A page in German spelling (ß) is German, so
  // its ss and its words that German also uses stay as written.
  function checkPage(late) {
    if (pageMeta) return;
    const title = document.querySelector('title');
    const t = (title ? visibleText(title) : '') + visibleText(document.body || document.documentElement, 6000);
    const german = E.germanSpelling(t, 3);
    if (E.isMeta(t, 'page')) {
      pageMeta = true;
      revert();
    } else if (late && german && !pageGerman) {
      stop();                          // the article rendered late: redo the page as German
      start();
    }
    pageGerman = german;
  }

  function start() {
    active = true;
    pageMeta = false;
    checkPage(false);
    if (pageMeta) return;
    walk(document.documentElement);
    setTimeout(() => active && checkPage(true), 1500); // late-rendered articles
    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') fix(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    report();
  }

  function revert() {
    observer?.disconnect();
    observer = null;
    queue.length = 0;
    for (const [node, { orig, conv }] of originals) if (node.nodeValue === conv) node.nodeValue = orig;
    originals.clear();
    count = 0;
    report();
  }

  function stop() {
    active = false;
    revert();
  }

  async function sync() {
    const s = await browser.storage.local.get(['enabled', 'disabledSites', 'mode', 'llm', 'highlight']);
    if (!!s.highlight !== highlight) { highlight = !!s.highlight; paint(); }
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
      return Promise.resolve({ host, count, active, mode, meta: pageMeta, pending: queue.length });
  });

  (async () => {
    if (window.top !== window) {
      try { host = await browser.runtime.sendMessage({ type: 'top-host' }) || host; } catch {}
    }
    sync();
  })();
})();
