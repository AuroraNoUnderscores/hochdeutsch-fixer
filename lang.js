// Which language a text is in: German, English, French or Italian. A naive
// Bayes reading of its words: how often each language uses each word (the most
// frequent words, lang_data.js from wordfreq), and for a word not on the lists
// how much it is spelled like that language's words (letter trigrams), so
// "Velostation" reads German and "offertory" English. Words both languages use
// ("was", "man", "die", "will") weigh what they weigh in each, so they no longer
// count as German.
(root => {
  if (!root.HD_LANG_DATA && typeof require === 'function') require('./lang_data.js');
  const D = root.HD_LANG_DATA;
  const LANGS = Object.keys(D);
  let tables = null;

  function build() {
    tables = {};
    for (const l of LANGS) {
      const words = new Map();
      for (const [cost, list] of Object.entries(D[l].words)) for (const w of list.split(' ')) words.set(w, +cost / 10);
      tables[l] = { words, grams: new Map(Object.entries(D[l].grams)), ctx: new Map(Object.entries(D[l].ctx)),
                    oov: D[l].oov / 10, cut: D[l].cut / 10, base: Math.log10(D[l].alphabet) };
    }
  }

  // -log10 P(word | language). German lists more words than English (for
  // compounds, listed below); for telling languages apart both read as many.
  function cost(w, l) {
    const t = tables[l];
    const listed = t.words.get(w);
    if (listed !== undefined && listed <= t.cut) return listed;
    const s = '^^' + w + '$';
    let c = t.oov;
    for (let i = 0; i < s.length - 2; i++) {
      const g = t.grams.get(s.slice(i, i + 3));
      c += g !== undefined ? g / 10 : (t.ctx.get(s.slice(i, i + 2)) ?? t.base * 10) / 10;
    }
    return c;
  }

  const WORD = /\p{L}+/gu;
  const cache = new Map();
  // A word the caller knows to be German though the lists do not ("Velo",
  // "Grüezi": Swiss German vocabulary) costs at most this much in German, what
  // a word of moderate frequency costs there (1 in 100000 running words).
  const KNOWN = 5;

  // Per language, -log10 P(text | language), and the words read.
  // known(word): is this a German word the lists may not know?
  function costs(text, known) {
    if (!tables) build();
    const out = Object.fromEntries(LANGS.map(l => [l, 0]));
    let n = 0;
    for (const [m] of text.matchAll(WORD)) {
      const w = m.toLowerCase();
      let c = cache.get(w);
      if (!c) {
        c = LANGS.map(l => cost(w, l));
        if (cache.size > 20000) cache.clear();
        cache.set(w, c);
      }
      LANGS.forEach((l, k) => { out[l] += l === 'de' && known?.(m) ? Math.min(c[k], KNOWN) : c[k]; });
      n++;
    }
    return { costs: out, words: n };
  }

  // The likeliest language, and by how much (log10) German is behind it, or
  // ahead of the next one. prior: log10 odds per language from around the text
  // (the block a sentence is in), added to its own. Text without words is
  // German: there is nothing to say otherwise.
  function detect(text, prior = null, known = null) {
    const { costs: c, words } = costs(text, known);
    const score = l => -c[l] + (prior?.[l] ?? 0);
    const ranked = [...LANGS].sort((a, b) => score(b) - score(a));
    const best = ranked[0];
    const other = best === 'de' ? ranked[1] : 'de';
    return { lang: best, margin: score(best) - score(other), words,
             odds: Object.fromEntries(LANGS.map(l => [l, score(l) - score('de')])) };
  }

  // Is this a German word? Listed among the 20000 commonest, rarest included.
  function german(w) {
    if (!tables) build();
    return tables.de.words.has(w.toLowerCase());
  }

  const api = { detect, costs, german, LANGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HD_LANG = api;
})(globalThis);
