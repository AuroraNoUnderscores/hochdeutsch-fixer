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
    armHover();
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
      + '::highlight(hd-name){text-decoration:underline dotted #0a84ff 2px}'
      + '::highlight(hd-hover){background-color:rgba(255,170,0,.7)}';
    (document.head || document.documentElement).append(style);
  }

  // ---------- the original, on hover ----------
  // With highlights on, pointing at a changed word shows what the site wrote and
  // why it changed: a rule, the model's pick (and what it picked over), or the
  // ss/ß spelling; a name the model kept says what kind of name it took it for.
  // The card lives in a closed shadow root on top of the page: the page's styles
  // cannot reach it, it takes no pointer events, and the text stays untouched.
  const NAME_KINDS = { PER: "a person's name", LOC: 'a place', ORG: 'an organisation' };
  let tip = null, shownKey = null, hideTimer = null, frame = 0, armed = false;

  // A node's choices, with where each sits in the converted text.
  function choicesOf(rec) {
    const out = [];
    let at = 0;
    for (const p of rec.pieces || []) {
      const text = typeof p === 'string' ? p : E.renderPieces([p]);
      if (typeof p === 'object') out.push([at, at + text.length, p]);
      at += text.length;
    }
    return out;
  }

  function why(rec, a, b, from, to) {
    const p = choicesOf(rec).find(([s, e]) => s < b && e > a)?.[2];
    const over = p && p.kind !== 'eszett' && p.rank !== false
      ? [...new Set(p.options.filter((o, i) => i !== p.pick && o !== to && o.trim()))] : [];
    if (over.length) {
      const list = over.slice(0, 3).map(o => `„${o.trim()}“`).join(', ') + (over.length > 3 ? ' …' : '');
      return (llm ? "The model's pick, over " : 'The rules\' pick (model off), over ') + list;
    }
    if (from.replace(/ss/g, 'ß') === to || to.replace(/ß/g, 'ss') === from) return 'Swiss spelling: ss → ß';
    if (mode === 'hamburg') {
      const neutral = E.convert(from, { mode: 'neutral' }).text;
      if (neutral !== to) return neutral === from ? 'Hamburg flavour' : `Hamburg flavour (Neutral: „${neutral}“)`;
    }
    return /\s/.test(from) || /\s/.test(to) ? 'Swiss usage' : 'Swiss word';
  }

  // The changed word or kept name under the pointer, if any. The caret position
  // lands on the nearest text even beside it, so the word's own boxes decide.
  function hit(x, y) {
    let node, off;
    const pos = document.caretPositionFromPoint?.(x, y);
    if (pos) { node = pos.offsetNode; off = pos.offset; }
    else { const r = document.caretRangeFromPoint?.(x, y); node = r?.startContainer; off = r?.startOffset; }
    const rec = node && originals.get(node);
    if (!rec || node.nodeValue !== rec.conv) return null;
    const spans = [
      ...changesOf(rec).filter(([a, b]) => b > a).map(([a, b, from, to]) => ({ a, b, from, to, note: () => why(rec, a, b, from, to) })),
      ...namesOf(rec).map(([a, b, word]) => {
        const p = choicesOf(rec).find(([s, e]) => s <= a && e >= b)?.[2];
        return { a, b, from: null, to: word, note: () => `Kept as written: looks like ${NAME_KINDS[p?.nameInfo?.kind] || 'a name'}`
          + (p ? ` (otherwise „${p.options[p.pick]}“)` : '') };
      }),
    ];
    for (const s of spans) {
      if (off < s.a || off > s.b) continue;
      const range = document.createRange();
      range.setStart(node, s.a);
      range.setEnd(node, Math.min(s.b, node.length));
      const rect = [...range.getClientRects()].find(r => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1);
      if (rect) return { ...s, range, rect, key: s.a + ':' + s.b, node };
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
    const root = host.attachShadow({ mode: 'closed' });
    const style = el('style', null, root);
    style.textContent = `
      :host { --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.12); --mark: #e8a200; }
      @media (prefers-color-scheme: dark) { :host { --bg: #2b2a33; --fg: #fbfbfe; --muted: #a8a8b3; --line: rgba(255,255,255,.14); --mark: #ffc845; } }
      .card { position: fixed; left: 0; top: 0; max-width: 300px; box-sizing: border-box; padding: 7px 10px 8px;
        font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg);
        border: 1px solid var(--line); border-radius: 7px; box-shadow: 0 6px 20px rgba(0,0,0,.14), 0 1px 3px rgba(0,0,0,.08);
        opacity: 0; transform: translate3d(var(--x, 0), calc(var(--y, 0) + var(--dy, 4px)), 0);
        transition: opacity 120ms ease-out, transform 180ms cubic-bezier(.2,.8,.2,1); will-change: transform, opacity; }
      .card.on { opacity: 1; --dy: 0px; }
      .card.below { --dy: -4px; }
      .card.on.below { --dy: 0px; }
      .card.still { transition: none; }
      .row { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
      .from { position: relative; color: var(--muted); }
      .from::after { content: ''; position: absolute; left: -1px; right: -1px; top: 54%; height: 1.5px; border-radius: 1px;
        background: currentColor; transform: scaleX(1); transform-origin: left center; }
      .card.fresh .from::after { animation: strike 220ms 70ms cubic-bezier(.4,0,.2,1) both; }
      @keyframes strike { from { transform: scaleX(0); } }
      .arrow { color: var(--muted); font-size: 12px; }
      .to { font-weight: 600; box-shadow: inset 0 -2px 0 var(--mark); }
      .row.kept .from, .row.kept .arrow { display: none; }
      .row.kept .to { box-shadow: none; text-decoration: underline dotted #0a84ff 2px; text-underline-offset: 3px; }
      .note { margin-top: 3px; font-size: 11.5px; color: var(--muted); white-space: normal; }
      @media (prefers-reduced-motion: reduce) {
        .card { transition: opacity 100ms linear; transform: translate3d(var(--x, 0), var(--y, 0), 0); }
        .card.fresh .from::after { animation: none; }
      }`;
    const card = el('div', 'card', root);
    card.setAttribute('role', 'tooltip');
    const row = el('div', 'row', card);
    const from = el('span', 'from', row);
    el('span', 'arrow', row).textContent = '→';
    const to = el('span', 'to', row);
    const note = el('div', 'note', card);
    document.documentElement.append(host);
    return { host, card, row, from, to, note };
  }

  function show(h) {
    clearTimeout(hideTimer);
    if (h.key + h.to === shownKey && tip?.card.classList.contains('on')) return;
    tip ||= makeTip();
    if (!tip.host.isConnected) document.documentElement.append(tip.host);
    const { card, row, from, to, note } = tip;
    const wasOn = card.classList.contains('on');
    shownKey = h.key + h.to;
    row.classList.toggle('kept', h.from == null);
    from.textContent = h.from || '∅';
    to.textContent = h.to || '∅';
    note.textContent = h.note();
    // where it goes: above the word, or below it at the top of the window
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
    if (globalThis.CSS?.highlights && typeof Highlight !== 'undefined') {
      const hl = new Highlight(h.range);
      hl.priority = 1;
      CSS.highlights.set('hd-hover', hl);
    }
  }

  function hide(now) {
    clearTimeout(hideTimer);
    const go = () => {
      shownKey = null;
      tip?.card.classList.remove('on', 'fresh');
      globalThis.CSS?.highlights?.delete('hd-hover');
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
  const onScroll = () => hide(true);

  // Listening only while highlights are on, and only where something changed.
  function armHover() {
    const want = highlight && active && originals.size > 0;
    if (want === armed) return;
    armed = want;
    const add = want ? addEventListener : removeEventListener;
    add('pointermove', onMove, { passive: true, capture: true });
    add('pointerdown', onTap, { passive: true, capture: true });
    add('keydown', onKey, true);
    add('scroll', onScroll, { passive: true, capture: true });
    add('blur', onScroll);
    if (!want) { hide(true); tip?.host.remove(); }
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
