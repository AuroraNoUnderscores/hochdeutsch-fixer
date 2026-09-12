// Conversion engine. Rules produce either a fixed replacement or, where they
// cannot decide (article after a gender change, parkt/geparkt, Busse, Masse/Maße …),
// a choice between candidate strings. Choices default to the safest option;
// the baby LLM (llm.js, run by background.js) picks among them afterwards.
// No DOM access, so this runs in tests too.
(function (root) {
  if (!root.HD_DICT && typeof require === 'function') { require('./dictionary.js'); require('./morph.js'); }
  const D = root.HD_DICT, M = root.HD_MORPH;

  const ENDINGS = ['', 'e', 'en', 'er', 'es', 'em'];
  const AUX = /(?:^|[^\p{L}])(?:hat|habe|hast|haben|habt|hatte|hattest|hatten|hattet|hätte|hätten|ist|bin|bist|sind|seid|war|warst|waren|wart|wäre|wären|wird|wirst|werden|werdet|wurde|wurden|worden|gewesen)(?![\p{L}])/iu;
  const VERB_END = /^(?:en|e|st|t|et|te|ten|ter|tes|tem|test|tet|end|ende|enden|ender|endes|endem)$/;
  const NEXT_IS_NOUN = /^\s+\p{Lu}/u;
  const THOUSANDS = /(?<!\d)(\d{1,3}(?:['’]\d{3})+)(\.\d{1,2}(?!\d))?/g;
  const INTENSIFIERS = new Set('sehr ganz besonders ziemlich recht echt total extrem relativ so noch zu'.split(' '));
  const NON_ADJ = new Set('haben werden wollen können müssen sollen dürfen mögen lassen geben sehen gehen kommen oder aber immer wieder unter über hinter wegen gegen neben seine meine deine'.split(' '));
  // "Es regnet" is not about anything, so it keeps its "es".
  const IMPERSONAL = new Set('regnet regnete schneit schneite hagelt donnert blitzt dämmert gibt gab geht ging handelt lohnt reicht heisst heißt droht drohte drohen folgt folgte gilt galt braucht'.split(' '));
  const INDEF = /^(?:ein|eine|einen|einem|einer|eines|kein|keine|keinen|keinem|keiner|keines)$/i;
  const NUMERALS = new Set('zwei drei vier fünf sechs sieben acht neun zehn elf zwölf viele mehrere einige beide alle wenige zahlreiche'.split(' '));

  const META_STRONG = new RegExp(D.meta.strong, 'i');
  const META_WEAK = new RegExp(D.meta.weak, 'gi');
  const OPEN_QUOTE = /[«„“‚‹"'»]\s*$/;
  const CLOSE_QUOTE = /^\s*[»“”‘›"'«]/;

  const weakCues = text => new Set((text.match(META_WEAK) || []).map(m => m.toLowerCase())).size;

  // Is this text talking about words rather than using them? A page or block
  // needs a strong cue or two weak ones; a single sentence needs only one,
  // since "in der Mehrzahl zu Massen" is already about the word.
  function isMeta(text, sentence) {
    if (!text) return false;
    return META_STRONG.test(text) || weakCues(text) >= (sentence ? 1 : 2);
  }

  // Per-sentence verdicts for one text, so one explaining sentence in an
  // ordinary paragraph suppresses only itself.
  function metaSentences(text) {
    const spans = [];
    const re = /[.!?]+(?:\s|$)/g;
    let start = 0, m;
    while ((m = re.exec(text))) {
      spans.push({ end: re.lastIndex, meta: isMeta(text.slice(start, re.lastIndex), true) });
      start = re.lastIndex;
    }
    if (start < text.length) spans.push({ end: text.length, meta: isMeta(text.slice(start), true) });
    return spans;
  }

  const isUpper = c => c !== c.toLowerCase();
  const allCaps = w => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function matchCase(orig, repl) {
    if (allCaps(orig)) return repl.toUpperCase();
    if (isUpper(orig[0])) return repl[0].toUpperCase() + repl.slice(1);
    return repl;
  }

  // ---------- dictionary tables (built once per mode) ----------

  function parseNoun(line) {
    const [main, flagStr = ''] = line.split(' | ');
    const [left, right] = main.split(' = ');
    const [sLemma, sG, sPl] = left.split('/');
    const [gFull, gG, gPl] = right.split('/');
    const gParts = gFull.split(' ');
    const flags = flagStr.split(' ').filter(Boolean);
    const val = k => flags.find(f => f.startsWith(k + '='))?.slice(k.length + 1);
    return {
      sLemma, sG,
      sPl: sG === 'p' ? [sLemma] : sPl === '-' ? [] : sPl.split(','),
      gLemma: gParts[gParts.length - 1], gWords: gParts.slice(0, -1), gG,
      gPl: gG === 'p' ? gParts[gParts.length - 1] : gPl === '-' ? null : gPl,
      sWeak: flags.includes('sw'), gWeak: flags.includes('gw'), gGen: val('gen'),
      suffix: flags.includes('s'), except: val('x') && new RegExp(val('x')),
    };
  }

  function nounForms(e) {
    const f = new Set(e.sG === 'p' ? [] : [e.sLemma]);
    if (e.sG === 'm' || e.sG === 'n') { f.add(e.sLemma + 's'); f.add(e.sLemma + 'es'); }
    if (e.sWeak) f.add(e.sLemma + (e.sLemma.endsWith('e') ? 'n' : 'en'));
    for (const p of e.sPl) { f.add(p); if (!/[ns]$/.test(p)) f.add(p + 'n'); }
    return [...f].sort((a, b) => b.length - a.length);
  }

  const tableCache = {};
  function tables(mode) {
    if (tableCache[mode]) return tableCache[mode];
    const H = (mode === 'hamburg' && D.hamburg) || {};
    const t = { exact: new Map(), folded: new Map(), nouns: new Map(), suffix: [], amb: new Map() };
    const add = (k, v) => {
      if (t.exact.has(k)) return;
      t.exact.set(k, v);
      if (!t.folded.has(k.toLowerCase())) t.folded.set(k.toLowerCase(), v);
    };
    for (const line of [...(H.words || []), ...D.words]) {
      const [l, r] = line.split('>');
      const ls = l.split(','), rs = r.split(',');
      ls.forEach((k, i) => {
        const v = rs[Math.min(i, rs.length - 1)];
        if (k.endsWith('*')) for (const e of ENDINGS) add(k.slice(0, -1) + e, v.slice(0, -1) + e);
        else add(k, v);
      });
    }
    const seen = new Set();
    for (const line of [...(H.nouns || []), ...D.nouns]) {
      const e = parseNoun(line);
      if (seen.has(e.sLemma)) continue;
      seen.add(e.sLemma);
      e.forms = nounForms(e);
      for (const f of e.forms) if (!t.nouns.has(f)) t.nouns.set(f, e);
      if (e.suffix) t.suffix.push(e);
    }
    t.verbs = [...(H.verbs || []), ...D.verbs];
    t.compounds = [...(H.compounds || []), ...D.compounds].map(([head, repl, ex]) => ({ head, repl, ex: ex && new RegExp(ex) }));
    const phrases = [...(H.phrases || []), ...D.phrases]
      .flatMap(line => { const [l, r] = line.split('>'); return l.split(',').map(k => [k, r]); })
      .sort((a, b) => b[0].length - a[0].length);
    t.phraseMap = new Map(phrases);
    t.phraseRe = phrases.length && new RegExp(`(?<!\\p{L})(?:${phrases.map(([k]) => escapeRe(k)).join('|')})(?!\\p{L})`, 'gu');
    for (const line of D.ambiguous) { const [k, v] = line.split('>'); t.amb.set(k, v); }
    t.cues = new Map();
    t.ssCues = new Map();
    for (const [name, src] of [['cues', D.cues], ['ssCues', D.ssCues]])
      for (const [keys, cue] of Object.entries(src || {}))
        for (const k of keys.split(','))
          t[name].set(k, { pro: cue.pro && new RegExp(cue.pro, 'i'), contra: cue.contra && new RegExp(cue.contra, 'i') });
    return (tableCache[mode] = t);
  }

  const ssRules = D.ss.map(s => {
    const [stem, ex] = s.split('!');
    return { re: new RegExp(stem, 'gi'), ex: ex && new RegExp(ex) };
  });
  const ssKeep = new Set(D.ssKeep);
  const ssContext = new Set(D.ssContext);

  // ---------- word-level rules ----------

  function lookup(t, w) {
    if (t.exact.has(w)) return t.exact.get(w);
    if (allCaps(w)) return t.folded.get(w.toLowerCase());
    if (isUpper(w[0])) return t.exact.get(w[0].toLowerCase() + w.slice(1)); // sentence start
  }

  function findNoun(t, w) {
    if (!isUpper(w[0])) return null;
    const key = allCaps(w) ? w[0] + w.slice(1).toLowerCase() : w;
    if (t.nouns.has(key)) return { e: t.nouns.get(key), noun: key, prefix: '' };
    const lower = w.toLowerCase();
    for (const e of t.suffix) {
      if (e.except && e.except.test(lower)) continue;
      for (const f of e.forms) {
        if (w.length - f.length >= 3 && lower.endsWith(f.toLowerCase()))
          return { e, noun: f, prefix: key.slice(0, w.length - f.length) };
      }
    }
    return null;
  }

  // "parkiert" is "parkt" or "geparkt", decided by the auxiliary earlier in the
  // sentence or an adjective before a noun. This stays a rule: the model scores
  // "Er geparkt das Auto" above "Er parkt das Auto", so asking it makes it worse.
  function verb(t, w, before, after) {
    const lower = w.toLowerCase();
    for (const [stem, repl, ge] of t.verbs) {
      if (!lower.startsWith(stem)) continue;
      const end = lower.slice(stem.length);
      if (!VERB_END.test(end)) continue;
      const plain = matchCase(w, repl + end), part = matchCase(w, ge + repl + end);
      if (!ge) return plain;
      if (/^t(er|es|em)$/.test(end)) return part;           // only ever an adjective
      if (end !== 't' && end !== 'te' && end !== 'ten') return plain;
      return (end === 't' ? AUX.test(before) : NEXT_IS_NOUN.test(after)) ? part : plain;
    }
  }

  function compound(t, w) {
    const lower = w.toLowerCase();
    for (const c of t.compounds) {
      const n = c.head.length;
      if (w.length - n < 3 || !lower.startsWith(c.head) || isUpper(w[n])) continue;
      if (c.ex && c.ex.test(lower)) continue;
      return matchCase(w.slice(0, n), c.repl) + w.slice(n);
    }
  }

  function fixSS(w) {
    if (!/ss/.test(w) || allCaps(w)) return w;
    const lower = w.toLowerCase();
    for (const r of ssRules) {
      if (r.ex && r.ex.test(lower)) continue;
      w = w.replace(r.re, m => m.replace('ss', 'ß'));
    }
    return w;
  }

  // Any other ss after a vowel might be ß ("Floss" -> "Floß"); let the model decide.
  function ssChoice(w) {
    const lower = w.toLowerCase();
    if (allCaps(w) || ssKeep.has(lower)) return null;
    for (const k of ssKeep) if (k.length >= 5 && (lower.startsWith(k) || lower.endsWith(k))) return null;
    const idx = [];
    for (let i = 1; i < w.length - 1; i++)
      if (w[i] === 's' && w[i + 1] === 's' && /[aeiouäöüy]/i.test(w[i - 1])) idx.push(i);
    if (!idx.length) return null;
    const swap = at => w.slice(0, at) + 'ß' + w.slice(at + 2);
    const variants = idx.map(swap);
    if (idx.length > 1) variants.push(idx.reduceRight((s, at) => s.slice(0, at) + 'ß' + s.slice(at + 2), w));
    return { options: [w, ...variants], pick: 0, key: 'ss:' + lower, cf: !ssContext.has(lower) };
  }

  // A word in quotes is being named, not used: «Velo», „Mass“.
  const quoted = (tokens, i) =>
    OPEN_QUOTE.test(tokens[i - 1]?.s || '') && CLOSE_QUOTE.test(tokens[i + 1]?.s || '');

  function wordPass(t, text, tokens, context) {
    const haystack = (context ? context + ' ' : '') + text;
    // Cues in this very text beat cues from the block around it: a page of short
    // notes shares one block, and "Fenster" in one note must not decide another.
    const decide = cue => {
      if (!cue) return null;
      for (const hay of [text, haystack]) {
        if (cue.pro?.test(hay)) return 1;
        if (cue.contra?.test(hay)) return 0;
      }
      return null;
    };
    const spans = metaSentences(text);
    let span = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.w || quoted(tokens, i)) continue;
      while (span < spans.length - 1 && tok.at >= spans[span].end) span++;
      if (spans[span]?.meta) continue; // this sentence is explaining a word
      const w = tok.w;
      const noun = findNoun(t, w);
      if (noun) { tok.noun = noun; continue; }
      const hit = lookup(t, w);
      if (hit !== undefined) { tok.s = matchCase(w, hit); continue; }
      const end = tok.at + w.length;
      const start = Math.max(text.lastIndexOf('.', tok.at), text.lastIndexOf('!', tok.at), text.lastIndexOf('?', tok.at)) + 1;
      const v = verb(t, w, text.slice(start, tok.at), text.slice(end, end + 40));
      if (v !== undefined) { if (typeof v === 'string') tok.s = v; else tok.piece = v; continue; }
      if (t.amb.has(w)) {
        const verdict = decide(t.cues.get(w.toLowerCase()));
        if (verdict === 1) tok.s = t.amb.get(w);          // topic settles it
        else if (verdict === null) tok.piece = { options: [w, t.amb.get(w)], pick: 0 }; // ask the model
        continue;
      }
      const lower = w.toLowerCase();
      if (D.zuegeln.finite[lower] || D.zuegeln.participle[lower]) { tok.zuegeln = true; continue; }
      const s = fixSS(compound(t, w) ?? w);
      // Both spellings in one text means they are being contrasted ("Masse" vs
      // "Maße"), so touching either one wrecks the comparison.
      if (s !== w && !contrasted(haystack, w, s)) { tok.s = s; continue; }
      if (s !== w) continue;
      const c = ssChoice(w);
      if (!c || c.options.some(o => o !== w && contrasted(haystack, w, o))) continue;
      // "die Masse des Fensters" is about measurements, "die Masse strömte" is a
      // crowd. The topic decides where it can; otherwise the model does.
      const verdict = decide(t.ssCues.get(w.toLowerCase()));
      if (verdict === 1) tok.s = matchCase(w, c.options[1]);
      else if (verdict === null) tok.piece = c;
    }
  }

  // ---------- noun phrases, relative pronouns, pronouns ----------

  const isSpace = tk => tk && !tk.w && /^[  ]+$/.test(tk.s);
  const free = tk => tk && tk.w && tk.piece === undefined && !tk.noun && !tk.skip;

  function setSpan(tokens, a, b, piece) {
    tokens[a].piece = piece;
    tokens[a].spanEnd = b;
    for (let x = a + 1; x <= b; x++) tokens[x].skip = true;
  }

  function fallbackNoun(e, { noun, prefix }, w) {
    const plural = e.sPl.some(p => p === noun || p + 'n' === noun) && e.gPl;
    const g = plural ? e.gPl : e.gLemma;
    const words = [...e.gWords.map(x => x.replace(/\+$/, 'e')), prefix ? prefix + g.toLowerCase() : g].join(' ');
    return allCaps(w) ? words.toUpperCase() : words;
  }

  function npPass(tokens) {
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.noun || tok.skip) continue;
      const { e } = tok.noun;
      let det = null, detIdx = -1, adjs = [], adjIdx = [], k = i;
      while (isSpace(tokens[k - 1]) && free(tokens[k - 2])) {
        const s = tokens[k - 2].s;
        const d = M.parseDet(s);
        if (d) { det = d; detIdx = k - 2; break; }
        if (INTENSIFIERS.has(s) && adjs.length) { k -= 2; continue; }
        if (!isUpper(s[0]) && !NON_ADJ.has(s) && M.splitAdj(s)) { adjs.unshift(s); adjIdx.unshift(k - 2); k -= 2; continue; }
        break;
      }
      const first = det ? detIdx : adjs.length ? adjIdx[0] : i;
      let prep = det?.prep ?? null;
      if (!prep && isSpace(tokens[first - 1]) && tokens[first - 2]?.w && M.PREP[tokens[first - 2].s.toLowerCase()])
        prep = tokens[first - 2].s.toLowerCase();
      if (!det && !prep) { adjs = []; adjIdx = []; } // unsure these are adjectives
      const start = det ? detIdx : adjs.length ? adjIdx[0] : i;
      const ctxBefore = (tokens[start - 2]?.s ?? '') + (tokens[start - 1]?.s ?? '');
      const num = !det && (NUMERALS.has(tokens[start - 2]?.w?.toLowerCase()) || /(?:^|\D)(?:[2-9]|\d{2,})\s*$/.test(ctxBefore)) ? 'pl' : null;

      const outs = M.rewrite(e, { det, prep, adjs, num, noun: tok.noun.noun, prefix: tok.noun.prefix });
      if (!outs.length) { tok.s = fallbackNoun(e, tok.noun, tok.w); continue; }
      const renderOut = o => {
        let s = '';
        for (let x = start; x <= i; x++) {
          const tk = tokens[x];
          if (x === detIdx) s += matchCase(tk.s, o.det);
          else if (adjIdx.includes(x)) s += matchCase(tk.s, o.adjs[adjIdx.indexOf(x)]);
          else if (x === i) s += allCaps(tk.w) ? o.noun.toUpperCase() : o.noun;
          else s += tk.s;
        }
        return s;
      };
      const options = [...new Set(outs.map(renderOut))];
      setSpan(tokens, start, i, options.length === 1 ? options[0] : { options, pick: 0 });
      followUps(tokens, i, outs[0].oldCell, outs[0].cell);
    }
  }

  // After a gender change, words referring back have to follow: "der Entscheid,
  // der …" -> "die Entscheidung, die …", and "… Er war knapp." -> "… Sie war knapp."
  // German pronouns agree with their antecedent's gender, so this is a rule; the
  // model is no help here (it prefers the old pronoun even when nothing matches it).
  // Stop at the first other noun, which could be the real antecedent.
  function followUps(tokens, i, oldCell, newCell) {
    if (oldCell === newCell) return;
    if (tokens[i + 1] && !tokens[i + 1].w && /^,\s*$/.test(tokens[i + 1].s)) {
      let r = i + 2;
      if (tokens[r]?.w && M.PREP[tokens[r].s.toLowerCase()] && isSpace(tokens[r + 1])) r += 2;
      const tk = tokens[r];
      if (free(tk)) {
        const forms = [...new Set(M.relMap(tk.s, oldCell, newCell).map(f => matchCase(tk.s, f)))].filter(f => f !== tk.s);
        const nounNext = isSpace(tokens[r + 1]) && tokens[r + 2]?.w && isUpper(tokens[r + 2].w[0]);
        if (forms.length && !nounNext) {              // a noun after it means "das" was an article
          if (forms.length === 1) tk.s = forms[0];
          else tk.piece = { options: forms, pick: 0 }; // which case: model decides
        }
      }
    }
    if (oldCell === 'p' || newCell === 'p') return;
    let ends = 0, blocked = false, sentenceStart = false;
    for (let x = i + 1; x < tokens.length; x++) {
      const tk = tokens[x];
      if (!tk.w) {
        const n = (tk.s.match(/[.!?](?:\s|$)/g) || []).length; // not "1.250.000"
        if (n) { ends += n; if (ends >= 2) break; blocked = false; sentenceStart = true; }
        continue;
      }
      if (!free(tk)) { blocked = true; sentenceStart = false; continue; } // another noun of ours
      const forms = [...new Set(M.pronMap(tk.s, oldCell, newCell).map(f => matchCase(tk.s, f)))].filter(f => f !== tk.s);
      if (!forms.length) {
        if (isUpper(tk.w[0]) && !sentenceStart) blocked = true; // some other noun it may refer to
        sentenceStart = false;
        continue;
      }
      sentenceStart = false;
      if (blocked || (tk.s.toLowerCase() === 'es' && impersonal(tokens, x))) continue;
      if (forms.length === 1) tk.s = forms[0];
      else tk.piece = { options: forms, pick: 0, ctx: 2 }; // which case: model decides
    }
  }

  // True when the text already shows both spellings, i.e. it is comparing them.
  function contrasted(haystack, from, to) {
    if (from === to) return false;
    return new RegExp(`(?<!\\p{L})${to}(?!\\p{L})`, 'iu').test(haystack);
  }

  // "es" in "weil es keinen Veloweg gab" or "es droht eine Geldstrafe" refers to
  // nothing — an impersonal verb, or the real subject following as an indefinite
  // noun phrase. Look to the end of the clause.
  function impersonal(tokens, x) {
    for (let y = x + 1; y < tokens.length; y++) {
      if (!tokens[y].w) { if (/[,.;:!?]/.test(tokens[y].s)) return false; continue; }
      const w = tokens[y].w.toLowerCase();
      if (IMPERSONAL.has(w) || INDEF.test(w)) return true;
    }
    return false;
  }

  // ---------- zügeln (separable "umziehen") ----------

  function spanText(tokens, a, b, over = {}) {
    let s = '';
    for (let x = a; x <= b; x++) {
      if (tokens[x].skip && !(x in over)) continue;
      s += x in over ? over[x] : pieceText(tokens[x].piece ?? tokens[x].s);
    }
    return s;
  }

  function zuegelnPass(tokens) {
    const Z = D.zuegeln;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.zuegeln || tok.skip) continue;
      const lower = tok.w.toLowerCase();
      if (Z.participle[lower]) {
        const repl = matchCase(tok.w, Z.participle[lower]);
        let a = i - 1;
        while (a >= 0 && !(tokens[a].w && Z.aux[tokens[a].s.toLowerCase()]) && (tokens[a].w || !/[.!?]/.test(tokens[a].s))) a--;
        const aux = a >= 0 && tokens[a].w && Z.aux[tokens[a].s.toLowerCase()];
        if (aux && !tokens.slice(a, i).some(tk => tk.spanEnd >= i)) {
          const swapped = spanText(tokens, a, i, { [a]: matchCase(tokens[a].s, aux), [i]: repl });
          setSpan(tokens, a, i, { options: [spanText(tokens, a, i), swapped], pick: 0 });
        } else tok.piece = { options: [tok.w, repl], pick: 0 };
        continue;
      }
      const form = Z.finite[lower];
      let c = i + 1;
      while (c < tokens.length && (tokens[c].w || !/[.,;:!?()]/.test(tokens[c].s))) c++;
      let last = c - 1;
      while (last > i && !tokens[last].w) last--;
      while (tokens[last]?.skip) last++; // don't cut through a noun phrase
      const prev = tokens[i - 2];
      if (last === i && lower === 'zügeln' && isSpace(tokens[i - 1]) && prev?.w?.toLowerCase() === 'zu' && prev.piece === undefined) {
        setSpan(tokens, i - 2, i, { options: [spanText(tokens, i - 2, i), matchCase(prev.w, 'umzuziehen')], pick: 0 });
      } else if (last === i) {
        tok.piece = { options: [...new Set([tok.w, matchCase(tok.w, 'um' + form), matchCase(tok.w, form) + ' um'])], pick: 0 };
      } else {
        const moved = spanText(tokens, i, last, { [i]: matchCase(tok.w, form) }) + ' um';
        setSpan(tokens, i, last, { options: [spanText(tokens, i, last), moved], pick: 0 });
      }
    }
  }

  // ---------- rendering and model hand-off ----------

  const pieceText = p => typeof p === 'string' ? p : p.options[p.pick];
  const renderPieces = pieces => pieces.map(pieceText).join('');

  function render(tokens, fixed) {
    const pieces = [];
    for (let x = 0; x < tokens.length; x++) {
      const tk = tokens[x];
      if (tk.skip) continue;
      const end = tk.spanEnd ?? x;
      const orig = tokens.slice(x, end + 1).map(t2 => t2.w ?? t2.s).join('');
      const piece = tk.piece ?? tk.s;
      if (typeof piece === 'object') { piece.orig = orig; pieces.push(piece); }
      else {
        if (piece !== orig) fixed++;
        if (typeof pieces[pieces.length - 1] === 'string') pieces[pieces.length - 1] += piece;
        else pieces.push(piece);
      }
    }
    return { text: renderPieces(pieces), changes: fixed + countChoices(pieces), fixed, pieces };
  }

  // How many choices currently differ from the original text.
  const countChoices = pieces =>
    pieces.filter(p => typeof p === 'object' && p.options[p.pick] !== p.orig).length;

  function convert(text, opts = {}) {
    const t = tables(opts.mode || 'hamburg');
    // Pages and blocks explaining words keep their examples ("sagt man Velo",
    // "in der Mehrzahl zu Massen"); rewriting those would say the opposite.
    if (opts.meta || isMeta((opts.context ? opts.context + ' ' : '') + text))
      return { text, changes: 0, fixed: 0, pieces: [text] };
    let changes = 0;
    if (t.phraseRe) text = text.replace(t.phraseRe, m => { changes++; return t.phraseMap.get(m); });
    text = text.replace(THOUSANDS, (m, int, dec) => {
      changes++;
      return int.replace(/['’]/g, '.') + (dec ? ',' + dec.slice(1) : '');
    });
    const tokens = [];
    for (const m of text.matchAll(/(\p{L}+)|[^\p{L}]+/gu))
      tokens.push(m[1] ? { w: m[1], s: m[1], at: m.index } : { s: m[0], at: m.index });
    wordPass(t, text, tokens, opts.context);
    npPass(tokens);
    zuegelnPass(tokens);
    return render(tokens, changes);
  }

  // Candidate texts the model compares for choice q: its sentence (plus the one
  // before for pronouns, which need their antecedent), with each option inserted.
  function candidates(pieces, q) {
    const left = renderPieces(pieces.slice(0, q)), right = renderPieces(pieces.slice(q + 1));
    const bounds = [...left.matchAll(/[.!?]\s+/g)].map(m => m.index + m[0].length);
    const back = pieces[q].ctx || 1;
    let from = bounds.length >= back ? bounds[bounds.length - back] : 0;
    from = Math.max(from, left.length - 300);
    const stop = right.search(/[.!?](\s|$)/);
    const to = stop < 0 ? Math.min(right.length, 200) : Math.min(stop + 1, 200);
    return pieces[q].options.map(o => (left.slice(from) + o + right.slice(0, to)).trim());
  }

  // Ask `rank` (the baby LLM) to settle every choice. Returns true if anything moved.
  async function resolve(pieces, rank) {
    const jobs = [];
    pieces.forEach((p, q) => {
      if (typeof p === 'object') jobs.push({ q, key: p.key, cf: p.cf, texts: candidates(pieces, q) });
    });
    if (!jobs.length) return false;
    const picks = await rank(jobs);
    if (!picks) return false;
    let moved = false;
    jobs.forEach((j, n) => {
      const pick = picks[n];
      if (pick == null || pick === pieces[j.q].pick) return;
      pieces[j.q].pick = pick;
      moved = true;
    });
    return moved;
  }

  const api = { convert, candidates, renderPieces, resolve, countChoices, isMeta, matchCase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HD_ENGINE = api;
})(globalThis);
