// Conversion engine. Rules produce either a fixed replacement or, where they
// cannot decide (article after a gender change, parkt/geparkt, Busse, Masse/Maße …),
// a choice between candidate strings. Choices default to the safest option;
// the baby LLM (llm.js, run by background.js) picks among them afterwards.
// No DOM access, so this runs in tests too.
(function (root) {
  if (!root.HD_DICT && typeof require === 'function') { require('./dictionary.js'); require('./morph.js'); }
  const D = root.HD_DICT, M = root.HD_MORPH;

  const ENDINGS = ['', 'e', 'en', 'er', 'es', 'em'];
  // How much better a candidate must score (in nats) before the model may
  // overrule the rules' default. A wrong spelling or word choice is the most
  // visible kind of mistake, so those demand real confidence; for grammar the
  // rules already decided what to do and the model only picks the wording.
  const CONF = { spelling: 2, word: 2, form: 0.5, grammar: 0 };
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

  // Cues must start a word (and the others end one too): as bare substrings
  // "Silbe" matched "Silbernes" and "bedeutet" matched "bedeutete".
  const META_STRONG = new RegExp('(?<!\\p{L})(?:' + D.meta.strong + ')', 'iu');
  const META_SENTENCE = new RegExp('(?<!\\p{L})(?:' + D.meta.sentence + ')(?!\\p{L})', 'giu');
  const META_WEAK = new RegExp('(?<!\\p{L})(?:' + D.meta.weak + ')(?!\\p{L})', 'giu');
  const OPEN_QUOTE = /[«„“‚‹"'»]\s*$/;
  const CLOSE_QUOTE = /^\s*[»“”‘›"'«]/;

  const distinct = (text, re) => new Set((text.match(re) || []).map(m => m.toLowerCase()));

  // Is this text talking about words rather than using them? A strong cue always
  // counts. A single sentence needs one unmistakable cue ("in der Mehrzahl zu
  // Massen"); a page or block needs two cues of any kind.
  function isMeta(text, sentence) {
    if (!text) return false;
    if (META_STRONG.test(text)) return true;
    const clear = distinct(text, META_SENTENCE);
    if (sentence) return clear.size >= 1;
    return clear.size + distinct(text, META_WEAK).size >= 2;
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
    return { options: [w, ...variants], pick: 0, conf: CONF.spelling, key: 'ss:' + lower, cf: !ssContext.has(lower) };
  }

  const atSentenceStart = (text, at) => !text.slice(0, at).replace(/[\s"'«»„“‚‹(\[]+$/, '').match(/[^.!?]$/);

  // A word in quotes is being named, not used: «Velo», „Mass“.
  const quoted = (tokens, i) =>
    OPEN_QUOTE.test(tokens[i - 1]?.s || '') && CLOSE_QUOTE.test(tokens[i + 1]?.s || '');

  function wordPass(t, text, tokens, context) {
    const haystack = (context ? context + ' ' : '') + text;
    // Cues are judged on the sentence first, then the whole text, then the block
    // around it. A long note holds several sentences and "Koffer" in one of them
    // must not decide the spelling in another.
    const decide = (cue, sentence) => {
      if (!cue) return null;
      for (const hay of [sentence, text, haystack]) {
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
      const sentence = text.slice(span ? spans[span - 1].end : 0, spans[span]?.end ?? text.length);
      const w = tok.w;
      const noun = findNoun(t, w);
      if (noun) { tok.noun = noun; continue; }
      const hit = lookup(t, w);
      if (hit !== undefined) { tok.s = matchCase(w, hit); nameable(tok); continue; }
      const end = tok.at + w.length;
      const start = Math.max(text.lastIndexOf('.', tok.at), text.lastIndexOf('!', tok.at), text.lastIndexOf('?', tok.at)) + 1;
      const v = verb(t, w, text.slice(start, tok.at), text.slice(end, end + 40));
      if (v !== undefined) { if (typeof v === 'string') tok.s = v; else tok.piece = v; continue; }
      if (t.amb.has(w)) {
        const verdict = decide(t.cues.get(w.toLowerCase()), sentence);
        if (verdict === 1) tok.s = t.amb.get(w);          // topic settles it
        else if (verdict === null) tok.piece = { options: [w, t.amb.get(w)], pick: 0, conf: CONF.word }; // ask the model
        continue;
      }
      const lower = w.toLowerCase();
      if (D.zuegeln.finite[lower] || D.zuegeln.participle[lower]) { tok.zuegeln = true; continue; }
      const compounded = compound(t, w);
      const rule = ssRule(t, w, compounded, tok, text, haystack, sentence, decide);
      // Every "ss" goes to the fine-tuned model (training/), which decides them
      // from context; the rules' answer is shown first and stands wherever the
      // model is off, unsure, or the word was rebuilt from a Swiss compound.
      if (compounded == null && !allCaps(w) && /ss/.test(w) && !contrasted(haystack, w, w.replace(/ss/g, 'ß'))) {
        const ruleWord = typeof rule === 'string' ? rule : w;
        const form = w.toLowerCase();
        tok.piece = { kind: 'eszett', word: w, at: tok.at, rule: ruleWord, form,
                      name: [tok.at, tok.at + w.length],
                      cue: decide(t.ssCues.get(form), sentence),
                      // Mid-sentence, capitalisation fixes the word class, and for
                      // these words the word class fixes the spelling: "Aß" cannot
                      // exist. Only at a sentence start is it open.
                      fixed: !!D.ssCase?.[form] && !atSentenceStart(text, tok.at),
                      options: [...new Set([w, ruleWord])], pick: ruleWord === w ? 0 : 1 };
        continue;
      }
      if (typeof rule === 'string') { tok.s = rule; nameable(tok); }
      else if (rule) tok.piece = rule;
    }
  }

  // A capitalised word the rules changed could be part of a name: "Heiligen-Geist-
  // Spital", "Lucie Poulet", "Kinderspital Zürich". The change becomes a piece the
  // eszett model can veto, since the same pass also marks names (training/names_data.py).
  function nameable(tok, piece) {
    if (!isUpper(tok.w[0])) return piece;
    if (!piece) {
      if (tok.s === tok.w) return;
      piece = { options: [tok.s], pick: 0, rank: false };
      tok.piece = piece;
    }
    piece.name = [tok.at, tok.at + tok.w.length];
    return piece;
  }

  // Non-overlapping "ss" pairs in a word, as the model was trained to see them.
  function ssPairs(w) {
    const out = [];
    for (let i = 0; i < w.length - 1;) {
      if (w[i] === 's' && w[i + 1] === 's') { out.push(i); i += 2; } else i++;
    }
    return out;
  }

  // What the rules alone make of an ss-word: a replacement string, a choice for
  // the general model, or null to leave it.
  function ssRule(t, w, compounded, tok, text, haystack, sentence, decide) {
    if (D.ssWords?.[w]) return D.ssWords[w];
    const cased = D.ssCase?.[w.toLowerCase()];
    if (cased) {
      // A capitalised word mid-sentence is the noun; lowercase is the verb.
      const noun = isUpper(w[0]) && !atSentenceStart(text, tok.at);
      return matchCase(w, noun ? cased.upper : cased.lower);
    }
    const s = fixSS(compounded ?? w);
    // Both spellings in one text means they are being contrasted ("Masse" vs
    // "Maße"), so touching either one wrecks the comparison.
    if (s !== w) return contrasted(haystack, w, s) ? null : s;
    const c = ssChoice(w);
    if (!c || c.options.some(o => o !== w && contrasted(haystack, w, o))) return null;
    // "die Masse des Fensters" is about measurements, "die Masse strömte" is a
    // crowd. The topic decides where it can; otherwise the general model does.
    const verdict = decide(t.ssCues.get(w.toLowerCase()), sentence);
    if (verdict === 1) return matchCase(w, c.options[1]);
    return verdict === null ? c : null;
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

  // Dictionary words that are also ordinary German ("am Rande", "der Store"),
  // from a web crawl (training/german_too.py).
  const GERMAN_TOO = new Set(root.HD_GERMAN_TOO || []);

  function npPass(tokens, text) {
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
      const alsoGerman = GERMAN_TOO.has(e.sLemma) || GERMAN_TOO.has(tok.w);
      if (!outs.length) {
        const fallback = fallbackNoun(e, tok.noun, tok.w);
        if (alsoGerman) nameable(tok, tok.piece = { options: [tok.w, fallback], pick: 1, conf: CONF.word });
        else { tok.s = fallback; nameable(tok); }
        continue;
      }
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
      // The original stays a candidate where it may be German after all: a word
      // German also uses, or a bare noun opening a sentence, where German puts
      // verbs ("Entscheide dich"). The model keeps it only when clearly better.
      const bareStart = !det && !adjs.length && atSentenceStart(text, tok.at);
      const orig = tokens.slice(start, i + 1).map(t2 => t2.w ?? t2.s).join('');
      const piece = alsoGerman || bareStart
        ? { options: [orig, ...options], pick: 1, conf: CONF.word }
        : options.length === 1 ? { options, pick: 0, rank: false } : { options, pick: 0, conf: CONF.form };
      setSpan(tokens, start, i, piece);
      nameable(tok, piece);
      followUps(tokens, i, outs[0].oldCell, outs[0].cell, piece);
    }
  }

  // After a gender change, words referring back have to follow: "der Entscheid,
  // der …" -> "die Entscheidung, die …", and "… Er war knapp." -> "… Sie war knapp."
  // German pronouns agree with their antecedent's gender, so this is a rule; the
  // model is no help here (it prefers the old pronoun even when nothing matches it).
  // Stop at the first other noun, which could be the real antecedent.
  function followUps(tokens, i, oldCell, newCell, dep) {
    if (oldCell === newCell) return;
    // A pronoun only changes because the noun did; if the noun turns out to be
    // part of a name and is kept, so is the pronoun.
    const follow = (tk, forms, extra) => {
      tk.piece = forms.length === 1 ? { options: forms, pick: 0, rank: false, dep }
                                    : { options: forms, pick: 0, conf: CONF.form, dep, ...extra };
    };
    if (tokens[i + 1] && !tokens[i + 1].w && /^,\s*$/.test(tokens[i + 1].s)) {
      let r = i + 2;
      if (tokens[r]?.w && M.PREP[tokens[r].s.toLowerCase()] && isSpace(tokens[r + 1])) r += 2;
      const tk = tokens[r];
      if (free(tk)) {
        const forms = [...new Set(M.relMap(tk.s, oldCell, newCell).map(f => matchCase(tk.s, f)))].filter(f => f !== tk.s);
        const nounNext = isSpace(tokens[r + 1]) && tokens[r + 2]?.w && isUpper(tokens[r + 2].w[0]);
        if (forms.length && !nounNext) follow(tk, forms);   // a noun after it means "das" was an article; several forms: model picks the case
      }
    }
    if (oldCell === 'p' || newCell === 'p') return;
    let ends = 0, blocked = false, wordsInSentence = 0;
    for (let x = i + 1; x < tokens.length; x++) {
      const tk = tokens[x];
      if (!tk.w) {
        const n = (tk.s.match(/[.!?](?:\s|$)/g) || []).length; // not "1.250.000"
        if (n) { ends += n; if (ends >= 2) break; blocked = false; wordsInSentence = 0; }
        continue;
      }
      const first = wordsInSentence === 0;
      wordsInSentence++;
      if (!free(tk)) { blocked = true; continue; } // another noun of ours
      const forms = [...new Set(M.pronMap(tk.s, oldCell, newCell).map(f => matchCase(tk.s, f)))].filter(f => f !== tk.s);
      if (!forms.length) {
        if (isUpper(tk.w[0]) && !first) blocked = true; // some other noun it may refer to
        continue;
      }
      // In the next sentence only a pronoun that opens it continues the topic.
      // "… auf dem Trottoir. Weil es so heiss war" is about the weather, not the pavement.
      if (blocked || (ends && !first)) continue;
      if (tk.s.toLowerCase() === 'es' && impersonal(tokens, x)) continue;
      follow(tk, forms, { ctx: 2 });                   // several forms: model picks the case
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
          setSpan(tokens, a, i, { options: [spanText(tokens, a, i), swapped], pick: 0, conf: CONF.grammar });
        } else tok.piece = { options: [tok.w, repl], pick: 0, conf: CONF.grammar };
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
        setSpan(tokens, i - 2, i, { options: [spanText(tokens, i - 2, i), matchCase(prev.w, 'umzuziehen')], pick: 0, conf: CONF.grammar });
      } else if (last === i) {
        tok.piece = { options: [...new Set([tok.w, matchCase(tok.w, 'um' + form), matchCase(tok.w, form) + ' um'])], pick: 0, conf: CONF.grammar };
      } else {
        const moved = spanText(tokens, i, last, { [i]: matchCase(tok.w, form) }) + ' um';
        setSpan(tokens, i, last, { options: [spanText(tokens, i, last), moved], pick: 0, conf: CONF.grammar });
      }
    }
  }


  // ---------- Swiss grammar ----------

  const PARTICIPLE = /(?:^|[^\p{L}])ge\p{Ll}+(?:t|en)(?![\p{L}])/u;

  // Clause around token i, as text, for looking at what a construction contains.
  function clauseText(tokens, i, back) {
    let a = i, b = i;
    while (a > 0 && (tokens[a - 1].w || !/[.,;:!?]/.test(tokens[a - 1].s))) a--;
    while (b < tokens.length - 1 && (tokens[b + 1].w || !/[.,;:!?]/.test(tokens[b + 1].s))) b++;
    if (!back) a = i;
    return { a, b, text: tokens.slice(a, b + 1).map(tk => tk.piece !== undefined ? pieceText(tk.piece) : tk.s).join('') };
  }

  // "Ich bin gesessen" -> "Ich habe gesessen": position verbs take haben.
  function sein2habenPass(tokens) {
    const { forms, participles } = D.syntax.sein2haben;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!free(tok)) continue;
      const swap = forms[tok.s.toLowerCase()];
      if (!swap) continue;
      const { text } = clauseText(tokens, i);
      const words = text.toLowerCase().split(/[^\p{L}]+/u);
      if (!participles.some(pp => words.includes(pp))) continue;
      tok.s = matchCase(tok.s, swap);
    }
  }

  // Existential "es hat ..." -> "es gibt ...", and "Tische frei" -> "freie Tische".
  function esHatPass(tokens) {
    const { esHat, fronted } = D.syntax;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!free(tok)) continue;
      const swap = esHat[tok.s.toLowerCase()];
      if (!swap) continue;
      const isEs = w => w && w.w && w.s.toLowerCase() === 'es';
      const { a } = clauseText(tokens, i, true);
      let firstWord = a;
      while (firstWord < i && !tokens[firstWord].w) firstWord++;
      // "es hat …", or "hat es …?" where the verb opens the clause. In
      // "Sie hat es eilig" the subject is "sie", so it is an ordinary "haben".
      if (!isEs(tokens[i - 2]) && !(firstWord === i && isEs(tokens[i + 2]))) continue;
      const { b, text: rest } = clauseText(tokens, i);
      if (PARTICIPLE.test(rest)) continue;               // "es hat geregnet" is a perfect
      const swapped = spanText(tokens, i, b, { [i]: matchCase(tok.s, swap) });
      const options = [spanText(tokens, i, b), swapped];
      // "gibt ... Tische frei" also exists as "gibt ... freie Tische"
      const m = new RegExp('^(.*?)([A-ZÄÖÜ][A-Za-zäöüßÄÖÜ]+)\\s+(' + fronted.join('|') + ')\\b(.*)$').exec(swapped);
      if (m)
        for (const end of ['e', 'en', 'er', 'es', 'em'])
          options.push(`${m[1]}${m[3]}${end} ${m[2]}${m[4]}`);
      setSpan(tokens, i, b, { options: [...new Set(options)], pick: options.length > 2 ? 2 : 1, conf: CONF.grammar });
    }
  }

  // "Der Kollege, wo mir hilft" -> "der mir hilft". After a place or a time,
  // "wo" is ordinary German and stays.
  function woPass(tokens) {
    const keep = new RegExp(D.syntax.woKeep, 'i');
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!free(tok) || tok.s.toLowerCase() !== 'wo') continue;
      if (!tokens[i - 1] || tokens[i - 1].w || !/,\s*$/.test(tokens[i - 1].s)) continue;
      let n = i - 2;                                     // the noun before the comma
      while (n >= 0 && !tokens[n].w) n--;
      const noun = tokens[n];
      if (!noun || !isUpper(noun.s[0]) || keep.test(noun.s)) continue;
      let d = n - 2;                                     // its determiner, maybe after adjectives
      let det = null;
      while (d >= 0 && tokens[d].w) {
        det = M.parseDet(tokens[d].s);
        if (det || !M.splitAdj(tokens[d].s)) break;
        d -= 2;
      }
      if (!det) continue;
      const cells = M.detCells(det);
      const forms = [...new Set(cells.flatMap(({ cell }) => [0, 1, 2].map(c => M.REL[cell][c])))];
      if (!forms.length) continue;
      tok.piece = { options: [...forms, tok.s], pick: 0, conf: CONF.form };
    }
  }

  // ---------- rendering and model hand-off ----------

  // Kept as written: part of a name, or a pronoun that only changed because its
  // noun did, when that noun is kept (a name, or the model preferred the original).
  const kept = p => p.named || (p.dep && pieceText(p.dep) === p.dep.orig);
  const pieceText = p => typeof p === 'string' ? p : kept(p) ? p.orig : p.options[p.pick];
  const renderPieces = pieces => pieces.map(pieceText).join('');

  function render(tokens, fixed, source) {
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
    pieces.source = source;   // the text the eszett model reads, with every token's offset
    return { text: renderPieces(pieces), changes: fixed + countChoices(pieces), fixed, pieces };
  }

  // How many choices currently differ from the original text.
  const countChoices = pieces =>
    pieces.filter(p => typeof p === 'object' && pieceText(p) !== p.orig).length;

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
    npPass(tokens, text);
    sein2habenPass(tokens);
    esHatPass(tokens);
    woPass(tokens);
    zuegelnPass(tokens);
    return render(tokens, changes, text);
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
  // How sure the eszett model must be to overrule the rules: p(ß) above 0.5 + this
  // for ß, below 0.5 - this for ss. In between, the rules' spelling stands.
  const ESZETT_MARGIN = () => root.HD_ESZETT_MARGIN ?? 0.1;   // overridable for measurement
  // Fewer training examples than this of a spelling, and the model's view of it
  // is a prior rather than evidence.
  const MIN_EVIDENCE = 20;

  async function resolve(pieces, rank) {
    const jobs = [];
    const eszettPieces = [];
    const namePieces = [];
    pieces.forEach((p, q) => {
      if (typeof p !== 'object') return;
      if (p.name) namePieces.push(p);
      if (p.kind === 'eszett') { eszettPieces.push(p); return; }
      if (p.rank === false) return;                     // nothing to rank, only a name check
      jobs.push({ q, key: p.key, cf: p.cf, def: p.pick, conf: p.conf ?? CONF.form,
                  opts: p.options, texts: candidates(pieces, q) });
    });
    // All ss decisions and name checks of a text go to the eszett model in one pass.
    if (eszettPieces.length || namePieces.length) {
      const offsets = eszettPieces.flatMap(p => ssPairs(p.word).map(i => p.at + i));
      jobs.push({ type: 'eszett', text: pieces.source, offsets, spans: namePieces.map(p => p.name) });
    }
    if (!jobs.length) return false;
    const picks = await rank(jobs);
    if (!picks) return false;
    let moved = false;
    jobs.forEach((j, n) => {
      const pick = picks[n];
      if (j.type === 'eszett') {
        const { ss, names } = Array.isArray(pick) ? { ss: pick } : pick ?? {};   // an array: model without names
        if (names) moved = applyNames(namePieces, names) || moved;
        if (Array.isArray(ss)) moved = applyEszett(eszettPieces, ss) || moved;
        return;
      }
      if (pick == null || pick === pieces[j.q].pick) return;
      pieces[j.q].pick = pick;
      moved = true;
    });
    return moved;
  }

  // The model marks names; a word the rules changed inside one goes back to how it
  // was written ("Heiligen-Geist-Spital"). The ss/ß spelling is kept only for
  // people ("Herr Weiss"): places, organisations and titles take ß like any word
  // ("in Straßburg", "Universitätsklinik Gießen"). Keeping those too made 6.45
  // errors per 1000 on held-out web text, people only 4.72 (dev/heldout.html).
  const NAME_MIN = () => root.HD_NAME_MIN ?? 0.5;       // overridable for measurement
  const KEEPS_SPELLING = () => new Set((root.HD_NAME_KEEPS ?? 'PER').split(','));   // overridable for measurement

  function applyNames(namePieces, names) {
    let moved = false;
    namePieces.forEach((p, k) => {
      const n = names[k];
      const named = !!n && n.p > NAME_MIN() && (p.kind !== 'eszett' || KEEPS_SPELLING().has(n.kind));
      if (named !== !!p.named) { p.named = named; moved = true; }
      p.nameInfo = n;
    });
    return moved;
  }

  // Rebuild each ss-word from the model's per-pair probabilities, keeping the
  // rules' spelling for any pair the model is unsure about.
  function applyEszett(eszettPieces, probs) {
    let k = 0, moved = false;
    for (const p of eszettPieces) {
      const pairs = ssPairs(p.word);
      const ruleEszett = ruleSpelling(p.word, p.rule);
      // A topic cue only outranks the model for a spelling the model barely saw
      // in training (coverage.js): plural "Bußen" occurred 3 times.
      const unseen = p.cue != null && (root.HD_COVERAGE?.[p.form]?.[p.cue] ?? Infinity) < MIN_EVIDENCE;
      let word = '', from = 0;
      pairs.forEach((i, n) => {
        const prob = probs[k + n];
        const eszett = p.fixed ? ruleEszett[n]
          : unseen ? p.cue === 1
          : prob == null ? ruleEszett[n]
          : prob > 0.5 + ESZETT_MARGIN() ? true
          : prob < 0.5 - ESZETT_MARGIN() ? false
          : ruleEszett[n];
        word += p.word.slice(from, i) + (eszett ? 'ß' : 'ss');
        from = i + 2;
      });
      word += p.word.slice(from);
      k += pairs.length;
      if (!p.options.includes(word)) p.options.push(word);
      const pick = p.options.indexOf(word);
      if (pick !== p.pick) { p.pick = pick; moved = true; }
    }
    return moved;
  }

  // For each ss pair of the Swiss word, whether the rules' version spells it ß.
  // Only meaningful when the rules changed nothing but ss/ß.
  function ruleSpelling(word, rule) {
    const pairs = ssPairs(word);
    if (rule === word || rule.replace(/ß/g, 'ss') !== word) return pairs.map(() => false);
    const out = [];
    let r = 0;
    for (let i = 0; i < word.length;) {
      if (pairs.includes(i)) { out.push(rule[r] === 'ß'); r += rule[r] === 'ß' ? 1 : 2; i += 2; }
      else { r++; i++; }
    }
    return out;
  }

  const api = { convert, candidates, renderPieces, resolve, countChoices, isMeta, matchCase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HD_ENGINE = api;
})(globalThis);
