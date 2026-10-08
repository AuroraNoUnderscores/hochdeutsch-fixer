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
  // Two grammar choices got measured thresholds of their own (e2e on hand-made
  // sets, the previous sentence in view): existential "es hat" -> "es gibt" had
  // margins of 5.7 and more where it is existential, under 5 for 7 of 9 where
  // "es" is a thing ("Das Kind ist müde. Es hat Hunger."); swapping "ist ...
  // gelegen" to "hat" needs 1, as the adjective ("ruhig gelegen") scored up to 0.9.
  const CONF = { spelling: 2, word: 2, form: 0.5, grammar: 0, existential: 5, position: 1 };
  const AUX = /(?:^|[^\p{L}])(?:hat|habe|hast|haben|habt|hatte|hattest|hatten|hattet|hätte|hätten|ist|bin|bist|sind|seid|war|warst|waren|wart|wäre|wären|wird|wirst|werden|werdet|wurde|wurden|worden|gewesen)(?![\p{L}])/iu;
  const SEIN = /(?<![\p{L}])(?:bin|bist|ist|sind|seid|war|warst|waren|wart|sei|seien|wäre|wären|sein|gewesen)(?![\p{L}])/iu;
  const SUBORDINATE = /^\s*(?:weil|dass|ob|wenn|als|da|obwohl|damit|bevor|nachdem|sobald|während|falls|sofern|indem|wer|was|wo|wie|welche[rsnm]?)(?![\p{L}])/iu;
  const AUX_AFTER = /^\s+(?:werden|wird|wurde|wurden|worden|sein|ist|sind|war|waren|wäre|wären|gewesen|habe|hast|hat|haben|habt|hatte|hatten|hätte|hätten)(?![\p{L}])/iu;
  const VERB_END = /^(?:en|e|st|t|et|te|ten|ter|tes|tem|test|tet|end|ende|enden|ender|endes|endem)$/;
  const NEXT_IS_NOUN = /^\s+\p{Lu}/u;
  const THOUSANDS = /(?<!\d)(\d{1,3}(?:['’]\d{3})+)(\.\d{1,2}(?!\d))?/g;
  const PRICE = /((?:CHF|SFr\.|Fr\.|EUR|€)\s?)(\d+)\.(\d{2}|[–-]{1,2})(?![\d])|(?<![\d.,'’])(\d+)\.(\d{2}|[–-]{1,2})(?=\s?(?:CHF|SFr\.|Fr\.|Franken|EUR|Euro|€)(?![\p{L}]))/gu;
  const INTENSIFIERS = new Set('sehr ganz besonders ziemlich recht echt total extrem relativ so noch zu'.split(' '));
  const NON_ADJ = new Set('haben werden wollen können müssen sollen dürfen mögen lassen geben sehen gehen kommen oder aber immer wieder unter über hinter wegen gegen neben seine meine deine'.split(' '));
  // "Es regnet" is not about anything, so it keeps its "es".
  const IMPERSONAL = new Set('regnet regnete schneit schneite hagelt donnert blitzt dämmert gibt gab geht ging handelt lohnt reicht heisst heißt droht drohte drohen folgt folgte gilt galt braucht'.split(' '));
  // Capitalised mid-sentence, these address the reader: "eine Offerte, die Sie überrascht".
  const POLITE = new Set('Sie Ihnen Ihr Ihre Ihren Ihrem Ihrer Ihres'.split(' '));
  const SETTINGS = new Set('hier dort da heute morgen gestern jetzt nun noch immer draussen draußen drinnen überall oben unten hinten vorne leider zurzeit momentan aktuell'.split(' '));
  const CONJUNCTIONS = new Set('und oder aber denn sondern doch weil dass da als wenn ob obwohl nachdem bevor sobald während damit falls'.split(' '));
  const INDEF = /^(?:ein|eine|einen|einem|einer|eines|kein|keine|keinen|keinem|keiner|keines)$/i;
  const NUMERALS = new Set('zwei drei vier fünf sechs sieben acht neun zehn elf zwölf viele mehrere einige beide alle wenige zahlreiche'.split(' '));

  // Cues must start a word (and the others end one too): as bare substrings
  // "Silbe" matched "Silbernes" and "bedeutet" matched "bedeutete".
  const META_STRONG = new RegExp('(?<!\\p{L})(?:' + D.meta.strong + ')', 'giu');
  const META_SENTENCE = new RegExp('(?<!\\p{L})(?:' + D.meta.sentence + ')(?!\\p{L})', 'giu');
  const META_WEAK = new RegExp('(?<!\\p{L})(?:' + D.meta.weak + ')(?!\\p{L})', 'giu');
  const OPEN_QUOTE = /[«„“‚‹"'»]\s*$/;
  const CLOSE_QUOTE = /^\s*[»“”‘›"'«]/;

  const distinct = (text, re) => new Set((text.match(re) || []).map(m => m.toLowerCase()));

  // distinct() of context + ' ' + text, the context's part kept between calls:
  // neighbouring paragraphs share their context. A global regex scans left to
  // right with no state but its position, and none of these cues is longer
  // than CUE_MAX, so a match that ends CUE_MAX before the end of the context
  // cannot see what follows it. Those matches are kept; the scan is resumed
  // after them, on the joined text, for the rest.
  const CUE_MAX = Math.max(...[D.meta.strong, D.meta.sentence, D.meta.weak].flatMap(a => a.split('|').map(x => x.length))) + 4;
  const scanned = new Map();       // regex -> { context, matches: [[start, end, lower]] }
  function distinctJoined(context, text, re) {
    let seen = scanned.get(re);
    if (!seen || seen.context !== context) {
      const matches = [];
      re.lastIndex = 0;
      for (let m; (m = re.exec(context));) {
        matches.push([m.index, re.lastIndex, m[0].toLowerCase()]);
        if (m[0] === '') re.lastIndex++;
      }
      scanned.set(re, (seen = { context, matches }));
    }
    let from = Math.max(0, context.length - CUE_MAX);
    for (const [a, b] of seen.matches) if (a < from && b > from) from = b;
    const out = new Set();
    for (const [, b, m] of seen.matches) if (b <= from) out.add(m);
    const joined = context + ' ' + text;
    re.lastIndex = from;
    for (let m; (m = re.exec(joined));) { out.add(m[0].toLowerCase()); if (m[0] === '') re.lastIndex++; }
    return out;
  }
  function isMetaJoined(context, text) {
    const strong = distinctJoined(context, text, META_STRONG).size, clear = distinctJoined(context, text, META_SENTENCE).size;
    const weak = distinctJoined(context, text, META_WEAK).size;
    return strong >= 1 || clear >= 2 || (clear >= 1 && weak >= 1);
  }

  // Is this text talking about words rather than using them? A sentence needs one
  // unmistakable cue ("in der Mehrzahl zu Massen"); a block a strong cue, two
  // clear ones, or one with a weak cue beside it; a whole page a strong cue with
  // any other beside it, or three clear ones. Weak cues alone never count:
  // "bedeutet" and "Bedeutung" in the first 6000 characters switched off 1.7% of
  // ordinary .ch pages (news, shops, blogs), and "Duden" alone a law firm's page.
  function isMeta(text, level = 'block') {
    if (!text) return false;
    const strong = distinct(text, META_STRONG).size, clear = distinct(text, META_SENTENCE).size;
    if (level === 'sentence') return strong + clear >= 1;
    const weak = distinct(text, META_WEAK).size;
    if (level === 'page') return clear >= 3 || (strong >= 1 && strong + clear + weak >= 2);
    return strong >= 1 || clear >= 2 || (clear >= 1 && weak >= 1);
  }

  // Per-sentence verdicts for one text, so one explaining sentence in an
  // ordinary paragraph suppresses only itself.
  function metaSentences(text) {
    const spans = [];
    const re = /[.!?]+(?:\s|$)/g;
    let start = 0, m;
    while ((m = re.exec(text))) {
      spans.push({ end: re.lastIndex, meta: isMeta(text.slice(start, re.lastIndex), 'sentence') });
      start = re.lastIndex;
    }
    if (start < text.length) spans.push({ end: text.length, meta: isMeta(text.slice(start), 'sentence') });
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
      sWeak: flags.includes('sw'), gWeak: flags.includes('gw'), gGen: val('gen'), inAuf: flags.includes('auf'), gInv: flags.includes('inv'),
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
    t.phraseMap = new Map();   // the Hamburg layer comes first and wins
    for (const [k, v] of phrases) if (!t.phraseMap.has(k)) t.phraseMap.set(k, v);
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

  // "parkiert" is "parkt" or "geparkt", decided by an auxiliary in its clause
  // ("hat … parkiert", "dass er parkiert hat", "muss parkiert werden"), one earlier
  // in the sentence when the verb closes its clause ("hat das Auto, das rot ist,
  // parkiert"), or a noun after it for an adjective. This stays a rule: the model
  // scores "Er geparkt das Auto" above "Er parkt das Auto", so asking it makes it worse.
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
      if (end !== 't') return NEXT_IS_NOUN.test(after) ? part : plain;
      const clause = before.slice(before.search(/[^,;:]*$/));
      // an earlier auxiliary only reaches a verb that closes a clause of its own
      // ("…, das rot ist, parkiert."), not one closing "weil er schlecht parkiert."
      const closes = /^\s*(?:[.,;:!?)"»“]|$)/.test(after) && !SUBORDINATE.test(clause);
      return AUX_AFTER.test(after) || AUX.test(clause) || (closes && AUX.test(before)) ? part : plain;
    }
  }

  function compound(t, w) {
    const lower = w.toLowerCase();
    for (const c of t.compounds) {
      const n = c.head.length;
      if (w.length - n < 3 || !lower.startsWith(c.head) || isUpper(w[n])) continue;
      if (c.ex && c.ex.test(lower)) continue;
      // "velofreundlich" stays an adjective: "fahrradfreundlich", not "Fahrradfreundlich"
      const repl = isUpper(w[0]) ? c.repl : c.repl[0].toLowerCase() + c.repl.slice(1);
      return matchCase(w.slice(0, n), repl) + w.slice(n);
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
    // a kept word of 5+ letters that starts or ends it: the word's own prefixes
    // and suffixes are looked up (a dozen lookups, not one per kept word)
    for (let n = 5; n < lower.length; n++)
      if (ssKeep.has(lower.slice(0, n)) || ssKeep.has(lower.slice(-n))) return null;
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

  function wordPass(t, text, tokens, { context, german }) {
    const haystack = (context ? context + ' ' : '') + text;
    joinedOf = { joined: haystack, parts: context ? [context, text] : [text] };
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
    // where the token's sentence starts: after the last . ! or ? before it,
    // tracked as the tokens go (searching back from each made a paragraph quadratic)
    let scan = 0, stop = -1;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.w || quoted(tokens, i)) continue;
      while (span < spans.length - 1 && tok.at >= spans[span].end) span++;
      if (spans[span]?.meta) continue; // this sentence is explaining a word
      const sentence = text.slice(span ? spans[span - 1].end : 0, spans[span]?.end ?? text.length);
      const w = tok.w;
      const noun = findNoun(t, w);
      if (noun) {
        tok.noun = noun;
        // a word German also uses, with a topic that settles its sense ("Risse im
        // Estrich" is screed, "Kisten auf dem Estrich" an attic)
        tok.cue = decide(t.cues.get(w.toLowerCase()), sentence);
        continue;
      }
      const end = tok.at + w.length;
      for (; scan <= tok.at; scan++) { const c = text.charCodeAt(scan); if (c === 46 || c === 33 || c === 63) stop = scan; }
      const start = stop + 1;
      // "Ich bin pressiert" is "in Eile", "Es pressiert" is "Es eilt".
      const pred = D.predicative?.[w];
      if (pred && SEIN.test(text.slice(start, tok.at).split(/[,;:]/).pop())) { tok.s = pred; continue; }
      const hit = lookup(t, w);
      if (hit !== undefined) { tok.s = matchCase(w, hit); nameable(tok); continue; }
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
      // Text that already spells ß chose every ss itself.
      const rule = german ? compounded : ssRule(t, w, compounded, tok, text, haystack, sentence, decide);
      // Every "ss" goes to the fine-tuned model (training/), which decides them
      // from context; the rules' answer is shown first and stands wherever the
      // model is off, unsure, or the word was rebuilt from a Swiss compound.
      if (!german && compounded == null && !allCaps(w) && /ss/.test(w) && !contrasted(haystack, w, w.replace(/ss/g, 'ß'))) {
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

  // An uninflected word between an article and its adjectives: "der eidgenössisch
  // anerkannten Maturität", "einer gut bestandenen Matura".
  const ADVERB_END = /(?:isch|lich|ig|bar|sam|haft|los|voll)$/;
  const ADVERBS = new Set(('gut neu frisch schön fein hoch tief lang kurz stark leicht schwer halb bereits schon bisher speziell extra eigens gross groß ' +
    'soeben eben gerade kürzlich jüngst erst zuletzt zuvor vorher damals gestern heute jetzt nun einst längst mal etwas').split(' '));
  // "die daraus folgende Limite", "das dafür nötige Billett"
  const PRONOMINAL = /^(?:da|dar|hier|wo)(?:an|auf|aus|bei|durch|für|gegen|hinter|in|mit|nach|neben|über|um|unter|von|vor|zu|zwischen)$/;
  const isAdverb = s => !isUpper(s[0]) && !M.PREP[s] && (INTENSIFIERS.has(s) || ADVERBS.has(s) || ADVERB_END.test(s) || PRONOMINAL.test(s));

  // "eine auf Sie zugeschnittene Offerte", "das auf dem Tisch liegende Billett":
  // an article, a phrase with a preposition in it, then the adjectives. Taken only
  // when article, adjectives and noun agree, so "dem" inside "auf dem Tisch" is not.
  function farDet(tokens, from, e, adjs, noun) {
    let words = 0, sawPrep = false;
    for (let x = from - 1; x >= 0 && words < 8; x--) {
      const tk = tokens[x];
      if (!tk.w) { if (/[.,;:!?()«»"„“”]/.test(tk.s)) return null; continue; }
      if (tk.noun || tk.skip || (tk.piece && tk.piece.kind !== 'eszett')) return null;
      words++;
      const d = tk.piece ? null : M.parseDet(tk.s);
      if (d && !d.prep && sawPrep && M.rewrite(e, { det: d, prep: null, adjs, noun: noun.noun, prefix: noun.prefix }).length)
        return { det: d, at: x };
      if (M.PREP[tk.s.toLowerCase()] || d?.prep) sawPrep = true;
    }
    return null;
  }

  // A word inside a noun phrase that is rewritten as a whole. An adjective there
  // may hold an ss the eszett model would otherwise decide ("die grosse
  // Offerte"); inside the phrase its spelling comes from the rules.
  const inPhrase = tk => free(tk) || (tk && tk.piece?.kind === 'eszett' && !tk.skip);
  const ruleSS = tk => tk.piece?.kind === 'eszett' ? tk.piece.rule : tk.s;

  function npPass(tokens, text, opts) {
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.noun || tok.skip) continue;
      const { e } = tok.noun;
      // A topic cue settles a word German also uses; without one the general
      // model may keep the original. The model judges only how a sentence
      // sounds, and on hand-labelled .ch sentences its margins did not separate
      // Estrich the attic from Estrich the screed, nor the two kinds of Peperoni.
      const alsoGerman = tok.cue !== 1 && (GERMAN_TOO.has(e.sLemma) || GERMAN_TOO.has(tok.w));
      // Text in German spelling (ß) is German, so a word German also uses is meant as German.
      if ((alsoGerman && opts.german) || tok.cue === 0) { tok.noun = null; continue; }
      // "das Sasara-Tram", "die Werbe-Trams": the article agrees with the last part.
      let head = i;
      while (tokens[head - 1]?.s === '-' && inPhrase(tokens[head - 2])) head -= 2;
      // "der Töff-Crack", "das Tram- und Busangebot": a first part only changes its
      // word, the article belongs to the last.
      const dash = tokens[i + 1]?.w ? '' : tokens[i + 1]?.s ?? '';
      const modifier = dash === '-' ? !!tokens[i + 2]?.w : /^-\s/.test(dash);
      let det = null, detIdx = -1, adjs = [], adjIdx = [], k = head, adverbs = 0;
      while (!modifier && isSpace(tokens[k - 1]) && inPhrase(tokens[k - 2])) {
        const s = tokens[k - 2].s;
        const d = tokens[k - 2].piece ? null : M.parseDet(s);
        if (d) { det = d; detIdx = k - 2; break; }
        if (adjs.length && adverbs < 2 && isAdverb(s)) { adverbs++; k -= 2; continue; }
        // capitalised only where it opens a sentence ("Grosse Offerte für alle")
        const a = isUpper(s[0]) && atSentenceStart(text, tokens[k - 2].at) ? s.toLowerCase() : s;
        if (!isUpper(a[0]) && !NON_ADJ.has(a) && M.splitAdj(a)) { adjs.unshift(a); adjIdx.unshift(k - 2); adverbs = 0; k -= 2; continue; }
        break;
      }
      if (!det && adjs.length) {
        const far = farDet(tokens, adjIdx[0], e, adjs, tok.noun);
        if (far) { det = far.det; detIdx = far.at; }
      }
      const first = det ? detIdx : adjs.length ? adjIdx[0] : head;
      let prep = det?.prep ?? null;
      if (!prep && isSpace(tokens[first - 1]) && free(tokens[first - 2]) && M.PREP[tokens[first - 2].s.toLowerCase()])
        prep = tokens[first - 2].s.toLowerCase();
      // Without an article or a preposition these may not be adjectives at all
      // ("wir senden Offerten"). Where they agree with the noun as adjectives,
      // the agreeing German forms come first and the model may keep them as they
      // were: "verbindliche Offerte" -> "verbindliches Angebot".
      let bare = null;
      if (!det && !prep) { if (adjs.length) bare = { adjs, adjIdx }; adjs = []; adjIdx = []; }
      const numAt = s => !det && (NUMERALS.has(tokens[s - 2]?.w?.toLowerCase()) ||
        /(?:^|\D)(?:[2-9]|\d{2,})\s*$/.test((tokens[s - 2]?.s ?? '') + (tokens[s - 1]?.s ?? ''))) ? 'pl' : null;
      const np = { det, prep, noun: tok.noun.noun, prefix: tok.noun.prefix };
      let outs = modifier ? [] : M.rewrite(e, { ...np, adjs, num: numAt(det ? detIdx : adjs.length ? adjIdx[0] : head) });
      if (bare && !modifier) {
        const agreeing = M.rewrite(e, { ...np, adjs: bare.adjs, num: numAt(bare.adjIdx[0]) });
        if (agreeing.some(o => o.adjs.some((a, j) => a !== bare.adjs[j]))) {
          ({ adjs, adjIdx } = bare);
          outs = [...agreeing, ...outs.map(o => ({ ...o, adjs }))];
        }
      }
      const start = det ? detIdx : adjs.length ? adjIdx[0] : head;
      // A preposition written apart from its article joins the phrase where it
      // must change: "in der Offerte" becomes "im Angebot", as German contracts
      // wherever it can; "in den Estrich" becomes "auf den Dachboden".
      const sep = det && !det.prep && prep ? detIdx - 2 : -1;
      if (!outs.length) {
        const fallback = fallbackNoun(e, tok.noun, tok.w);
        if (alsoGerman) nameable(tok, tok.piece = { options: [tok.w, fallback], pick: 1, conf: CONF.word });
        else { tok.s = fallback; nameable(tok); }
        continue;
      }
      const lead = o => {
        const p = e.inAuf && prep === 'in' ? 'auf' : prep;
        const joined = M.contract(p, o.det);
        return joined && !M.contract(prep, det.form) ? joined : p + tokens[sep + 1].s + o.det;
      };
      const needSep = sep >= 0 && outs.some(o => lead(o) !== tokens.slice(sep, detIdx + 1).map(t2 => t2.s).join('').toLowerCase());
      const from = needSep ? sep : start;
      const renderOut = o => {
        let s = '';
        for (let x = from; x <= i; x++) {
          const tk = tokens[x];
          if (needSep && x === sep) { s += matchCase(tk.s, lead(o)); x = detIdx; }
          else if (x === detIdx) s += matchCase(tk.s, o.det);
          else if (adjIdx.includes(x)) s += matchCase(tk.s, fixSS(o.adjs[adjIdx.indexOf(x)]));
          else if (x === i) s += allCaps(tk.w) ? o.noun.toUpperCase() : o.noun;
          else s += tk.w ? ruleSS(tk) : tk.s;
        }
        return s;
      };
      const options = [...new Set(outs.map(renderOut))];
      // Without an article, a Swiss noun that is the same in both numbers
      // ("Lauch und Rüebli", "Kaffee und Gipfeli") is most likely plural: German
      // would put an article before a singular.
      const pl = !det && outs.some(o => o.num === 'sg') ? outs.find(o => o.num === 'pl') : null;
      const pick = pl ? options.indexOf(renderOut(pl)) : 0;
      // The original stays a candidate where it may be German after all: a word
      // German also uses, or a bare noun opening a sentence, where German puts
      // verbs ("Entscheide dich"). The model keeps it only when clearly better.
      const bareStart = !det && !adjs.length && atSentenceStart(text, tokens[head].at);
      const orig = tokens.slice(from, i + 1).map(t2 => t2.w ?? t2.s).join('');
      const piece = alsoGerman || bareStart
        ? { options: [orig, ...options], pick: 1 + pick, conf: CONF.word }
        : options.length === 1 ? { options, pick: 0, rank: false } : { options, pick, conf: CONF.form };
      setSpan(tokens, from, i, piece);
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
        const nounNext = isSpace(tokens[r + 1]) && tokens[r + 2]?.w && isUpper(tokens[r + 2].w[0]) && !POLITE.has(tokens[r + 2].w);
        if (forms.length && !nounNext) follow(tk, forms);   // a noun after it means "das" was an article; several forms: model picks the case
      }
    }
    if (oldCell === 'p' || newCell === 'p') return;
    let ends = 0, blocked = false, wordsInSentence = 0, newClause = false;
    for (let x = i + 1; x < tokens.length; x++) {
      const tk = tokens[x];
      if (!tk.w) {
        const n = (tk.s.match(/[.!?](?:\s|$)/g) || []).length; // not "1.250.000"
        if (n) { ends += n; if (ends >= 2) break; blocked = false; wordsInSentence = 0; }
        if (/[,;:()–—]/.test(tk.s)) newClause = true;
        continue;
      }
      const first = wordsInSentence === 0;
      wordsInSentence++;
      if (CONJUNCTIONS.has(tk.w.toLowerCase())) newClause = true;
      // an ss-word ("dass", "muss") is no noun, unless capitalised mid-sentence
      if (tk.piece?.kind === 'eszett' && !tk.skip) { if (isUpper(tk.w[0]) && !first) blocked = true; continue; }
      if (!free(tk)) { blocked = true; continue; } // another noun of ours
      if (!first && POLITE.has(tk.w)) continue;        // "Sie" mid-sentence is the reader, not the noun
      const forms = [...new Set(M.pronMap(tk.s, oldCell, newCell).map(f => matchCase(tk.s, f)))].filter(f => f !== tk.s);
      if (!forms.length) {
        if (isUpper(tk.w[0]) && !first) blocked = true; // some other noun it may refer to
        continue;
      }
      // In the next sentence only a pronoun that opens it continues the topic.
      // "… auf dem Trottoir. Weil es so heiss war" is about the weather, not the pavement.
      if (blocked || (ends && !first)) continue;
      // A pronoun in the noun's own clause cannot refer to it: in "Wegen dem
      // Entscheid ärgert er sich" he is a person. It needs a new clause first.
      if (!ends && !newClause) continue;
      if (tk.s.toLowerCase() === 'es' && impersonal(tokens, x)) continue;
      follow(tk, forms, { ctx: 2 });                   // several forms: model picks the case
    }
  }

  // True when the text already shows both spellings, i.e. it is comparing them.
  // A word stands alone in the text exactly when it is one of the text's runs
  // of letters, so a word made of letters is looked up among them: the runs
  // are collected once per text, not searched for word by word.
  // Latin letters only, where lower case and the regex's case folding agree
  // (ſ folds to s); any other word is searched for as before.
  const LETTERS = /^(?:[A-Za-z\u00C0-\u024F\u1E9E](?<=\p{L}))+$/u;
  const caseKey = w => w.toLowerCase().replace(/ſ/g, 's');
  // A text's runs, the last few texts kept: a page's or a block's context is
  // the same for all its paragraphs. No run crosses the space that joins
  // context and text, so the runs of the two are those of each (joinedOf).
  const runSets = new Map();
  function runsIn(str) {
    let set = runSets.get(str);
    if (!set) {
      set = new Set((str.match(/\p{L}+/gu) || []).map(caseKey));
      runSets.set(str, set);
      if (runSets.size > 8) runSets.delete(runSets.keys().next().value);
    }
    return set;
  }
  let joinedOf = null;             // { joined, parts }: the haystack wordPass made, and what of
  function contrasted(haystack, from, to) {
    if (from === to) return false;
    if (LETTERS.test(to)) {
      const key = caseKey(to);
      return joinedOf?.joined === haystack ? joinedOf.parts.some(p => runsIn(p).has(key)) : runsIn(haystack).has(key);
    }
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
  // "gelegen" is also an adjective ("Das Hotel ist ruhig gelegen", "Mir ist daran
  // gelegen"), so there the model chooses and the original is the default.
  function sein2habenPass(tokens) {
    const { forms, participles, alsoAdjective = [] } = D.syntax.sein2haben;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!free(tok)) continue;
      const swap = forms[tok.s.toLowerCase()];
      if (!swap) continue;
      const { text } = clauseText(tokens, i);
      const words = text.toLowerCase().split(/[^\p{L}]+/u);
      const found = participles.filter(pp => words.includes(pp));
      if (!found.length) continue;
      const swapped = matchCase(tok.s, swap);
      if (found.every(pp => alsoAdjective.includes(pp))) tok.piece = { options: [tok.s, swapped], pick: 0, conf: CONF.position };
      else tok.s = swapped;
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
      // "es hat …", "hat es …?" where the verb opens the clause, or "hat es"
      // after a place or time ("Im Kühlschrank hat es noch Milch"). In "Sie hat
      // es eilig" the subject is "sie", so it is an ordinary "haben".
      const opener = tokens[firstWord]?.w?.toLowerCase();
      const setting = !!opener && firstWord < i && (M.PREP[opener] || M.parseDet(opener)?.prep || SETTINGS.has(opener));
      if (!isEs(tokens[i - 2]) && !((firstWord === i || setting) && isEs(tokens[i + 2]))) continue;
      const { b, text: rest } = clauseText(tokens, i);
      if (PARTICIPLE.test(rest)) continue;               // "es hat geregnet" is a perfect
      const swapped = spanText(tokens, i, b, { [i]: matchCase(tok.s, swap) });
      const options = [spanText(tokens, i, b), swapped];
      // "gibt ... Tische frei" also exists as "gibt ... freie Tische"
      const m = new RegExp('^(.*?)([A-ZÄÖÜ][A-Za-zäöüßÄÖÜ]+)\\s+(' + fronted.join('|') + ')\\b(.*)$').exec(swapped);
      if (m)
        for (const end of ['e', 'en', 'er', 'es', 'em'])
          options.push(`${m[1]}${m[3]}${end} ${m[2]}${m[4]}`);
      // Without the model the rules' "es gibt" stands; the model must find it
      // clearly better than the original, with the sentence before in view,
      // since "es" may be a thing mentioned there.
      setSpan(tokens, i, b, { options: [...new Set(options)], pick: options.length > 2 ? 2 : 1, def: 0,
                              conf: CONF.existential, ctx: 2 });
    }
  }

  // "Der Kollege, wo mir hilft" -> "der mir hilft". After a place or a time,
  // "wo" is ordinary German and stays. The last part of a compound decides:
  // "Wohnort" is a place, "Tagesmutter" is not.
  const LOCATIVE = /^(?:in|an|auf|unter|über|vor|hinter|neben|zwischen|bei)$/i;
  const SUBJECT = new Set(['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man']);
  // Does the clause after "wo" have a subject of its own ("wo er arbeitet",
  // "wo neue Sätze gefunden wurden")? Without one, "wo" is the subject itself
  // ("wo mir hilft"), and so a relative pronoun. A noun in a prepositional
  // phrase ("am Montag") is no subject.
  function ownSubject(tokens, i) {
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j];
      if (!t.w) { if (/[,;:.!?]/.test(t.s)) return false; continue; }
      if (SUBJECT.has(t.w.toLowerCase())) return true;
      if (!isUpper(t.w[0])) continue;
      let k = j - 2;                                     // before its determiner and adjectives
      while (k > i && tokens[k].w && (M.parseDet(tokens[k].w) && !M.parseDet(tokens[k].w).prep || M.splitAdj(tokens[k].w))) k -= 2;
      const before = k > i && tokens[k].w?.toLowerCase();
      if (!before || !(M.PREP[before] || M.parseDet(before)?.prep)) return true;
    }
    return false;
  }
  function woPass(tokens) {
    const keep = new RegExp('(?:' + D.syntax.woKeep + ')$', 'i');
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
      // in a place the noun names ("in der Forschung, wo neue Sätze …"): a
      // dative after a preposition of place, and a clause with a subject of its
      // own; "wo" is German there too. "Bei der Familie, wo nett ist" has none.
      // The model may still choose the pronoun.
      let p = d - 1;
      while (p >= 0 && !tokens[p].w) p--;
      const place = p >= 0 && LOCATIVE.test(tokens[p].s) && /^(?:dem|der|einem|einer)$/i.test(tokens[d].s) && ownSubject(tokens, i);
      tok.piece = { options: [...forms, tok.s], pick: place ? forms.length : 0, conf: CONF.form };
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
      if (typeof piece === 'object') { piece.orig = orig; piece.at = tk.at; pieces.push(piece); }
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

  // A text's choices, with where each sits in the converted text.
  function choicesOf(pieces) {
    const out = [];
    let at = 0;
    for (const p of pieces || []) {
      const text = typeof p === 'string' ? p : renderPieces([p]);
      if (typeof p === 'object') out.push([at, at + text.length, p]);
      at += text.length;
    }
    return out;
  }

  // Why the converted text's a to b reads `to` where the original read `from`,
  // for the card shown over a changed word: a rule, the model's pick (and what
  // it picked over), or the ss/ß spelling. opts: the mode and whether the model
  // is on (llm) and has answered for this text (ranked).
  function explain(pieces, a, b, from, to, { mode = 'hamburg', llm = true, ranked = false } = {}) {
    const p = choicesOf(pieces).find(([s, e]) => s < b && e > a)?.[2];
    const over = p && p.kind !== 'eszett' && p.rank !== false
      ? [...new Set(p.options.filter((o, i) => i !== p.pick && o !== to && o.trim()))] : [];
    if (over.length) {
      const list = over.slice(0, 3).map(o => `„${o.trim()}“`).join(', ') + (over.length > 3 ? ' …' : '');
      const by = !llm ? "The rules' pick (model off), over "
        : ranked ? "The model's pick, over " : "The rules' pick (the model hasn't checked it yet), over ";
      return by + list;
    }
    if (from.replace(/ss/g, 'ß') === to || to.replace(/ß/g, 'ss') === from) return 'Swiss spelling: ss → ß';
    // Hamburg only where the flavour itself makes the difference: the words
    // alone, converted both ways (in context the rest may differ for other reasons)
    if (mode === 'hamburg') {
      const neutral = convert(from, { mode: 'neutral' }).text;
      if (neutral !== convert(from, { mode: 'hamburg' }).text)
        return neutral === from ? 'Hamburg flavour' : `Hamburg flavour (Neutral: „${neutral}“)`;
    }
    return /\s/.test(from) || /\s/.test(to) ? 'Swiss usage' : 'Swiss word';
  }

  // Is this text written in German spelling? Swiss spelling has no ß, so text
  // with ß (at least `min` of them) and hardly any ss where the rules expect ß
  // was written in Germany or Austria: its ss choices are the writer's own, and a
  // word German also uses ("Estrich", "Store") is meant as German.
  function germanSpelling(text, min = 2) {
    const eszett = (text.match(/ß/g) || []).length;
    if (eszett < min) return false;
    let swiss = 0;
    for (const w of text.match(/\p{L}*ss\p{L}*/gu) || []) if (fixSS(w) !== w) swiss++;
    return eszett > 3 * swiss;
  }

  function convert(text, opts = {}) {
    const t = tables(opts.mode || 'hamburg');
    // Pages and blocks explaining words keep their examples ("sagt man Velo",
    // "in der Mehrzahl zu Massen"); rewriting those would say the opposite.
    if (opts.meta || (opts.context ? isMetaJoined(opts.context, text) : isMeta(text)))
      return { text, changes: 0, fixed: 0, pieces: [text] };
    let changes = 0;
    if (t.phraseRe) text = text.replace(t.phraseRe, m => { changes++; return t.phraseMap.get(m); });
    text = text.replace(THOUSANDS, (m, int, dec) => {
      changes++;
      return int.replace(/['’]/g, '.') + (dec ? ',' + dec.slice(1) : '');
    });
    // Swiss prices take a decimal point: "CHF 12.50", "Fr. 3.–", "12.50 Franken".
    text = text.replace(PRICE, (m, cur, int, dec, int2, dec2) => {
      changes++;
      return cur !== undefined ? `${cur}${int},${dec}` : `${int2},${dec2}`;
    });
    const tokens = [];
    for (const m of text.matchAll(/(\p{L}+)|[^\p{L}]+/gu))
      tokens.push(m[1] ? { w: m[1], s: m[1], at: m.index } : { s: m[0], at: m.index });
    wordPass(t, text, tokens, opts);
    npPass(tokens, text, opts);
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
      // `def` is what the model must beat; usually the rules' pick, but a choice
      // may show the rules' answer first and still ask the model to beat the original.
      jobs.push({ q, key: p.key, cf: p.cf, def: p.def ?? p.pick, conf: p.conf ?? CONF.form,
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

  const api = { convert, candidates, renderPieces, choicesOf, explain, resolve, countChoices, isMeta, germanSpelling, matchCase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HD_ENGINE = api;
})(globalThis);
