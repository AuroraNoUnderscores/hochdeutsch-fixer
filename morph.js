// German noun-phrase morphology: rebuilds "den wichtigen Entscheid" as
// "die wichtige Entscheidung" when a replacement noun has another gender.
// Cells are m/f/n (singular) or p (plural); cases are nom, acc, dat, gen.
(function (root) {
  const DEF = { m: ['der', 'den', 'dem', 'des'], f: ['die', 'die', 'der', 'der'], n: ['das', 'das', 'dem', 'des'], p: ['die', 'die', 'den', 'der'] };
  const DER_W = { m: ['er', 'en', 'em', 'es'], f: ['e', 'e', 'er', 'er'], n: ['es', 'es', 'em', 'es'], p: ['e', 'e', 'en', 'er'] };
  const EIN_W = { m: ['', 'en', 'em', 'es'], f: ['e', 'e', 'er', 'er'], n: ['', '', 'em', 'es'], p: ['e', 'e', 'en', 'er'] };
  const WEAK = { m: ['e', 'en', 'en', 'en'], f: ['e', 'e', 'en', 'en'], n: ['e', 'e', 'en', 'en'], p: ['en', 'en', 'en', 'en'] };
  const MIXED = { m: ['er', 'en', 'en', 'en'], f: ['e', 'e', 'en', 'en'], n: ['es', 'es', 'en', 'en'], p: ['en', 'en', 'en', 'en'] };
  const STRONG = { m: ['er', 'en', 'em', 'en'], f: ['e', 'e', 'er', 'er'], n: ['es', 'es', 'em', 'en'], p: ['e', 'e', 'en', 'er'] };
  const REL = { m: ['der', 'den', 'dem', 'dessen'], f: ['die', 'die', 'der', 'deren'], n: ['das', 'das', 'dem', 'dessen'], p: ['die', 'die', 'denen', 'deren'] };
  const PRON = { m: ['er', 'ihn', 'ihm'], f: ['sie', 'sie', 'ihr'], n: ['es', 'es', 'ihm'] };

  const CONTRACT = { im: ['in', 'dem'], am: ['an', 'dem'], zum: ['zu', 'dem'], zur: ['zu', 'der'], vom: ['von', 'dem'], beim: ['bei', 'dem'], ins: ['in', 'das'], ans: ['an', 'das'], aufs: ['auf', 'das'], durchs: ['durch', 'das'], fürs: ['für', 'das'], ums: ['um', 'das'] };
  const CONTRACTED = {};
  for (const [short, [prep, det]] of Object.entries(CONTRACT)) (CONTRACTED[prep] ??= {})[det] = short;

  // Cases a preposition allows (0 nom, 1 acc, 2 dat, 3 gen).
  const PREP = {};
  const setPrep = (words, cases) => words.split(' ').forEach(w => { PREP[w] = cases; });
  setPrep('mit von zu bei aus nach seit gegenüber ab', [2]);
  setPrep('für durch gegen ohne um bis', [1]);
  setPrep('in an auf über unter vor hinter neben zwischen', [1, 2]);
  setPrep('wegen trotz während statt innerhalb ausserhalb außerhalb', [3, 2]);

  const DER_WORD = /^(dies|jen|jed|welch|manch|solch|all)(e|er|en|em|es)$/;
  const EIN_WORD = /^(ein|kein|mein|dein|sein|ihr|unser|euer|eur)(e|er|en|em|es)?$/;

  function parseDet(word) {
    const w = word.toLowerCase();
    if (CONTRACT[w]) return { kind: 'def', prep: CONTRACT[w][0], form: CONTRACT[w][1] };
    if (['der', 'die', 'das', 'den', 'dem', 'des'].includes(w)) return { kind: 'def', form: w };
    let m = DER_WORD.exec(w);
    if (m) return { kind: 'der', stem: m[1], form: w };
    m = EIN_WORD.exec(w);
    if (m && !(m[1] === 'eur' && !m[2]) && !(m[1] === 'euer' && m[2])) return { kind: 'ein', stem: m[1] === 'eur' ? 'euer' : m[1], form: w };
    return null;
  }

  function detForm(det, cell, c) {
    if (det.kind === 'def') return DEF[cell][c];
    if (det.kind === 'der') return det.stem + DER_W[cell][c];
    if (cell === 'p' && det.stem === 'ein') return null; // "ein" has no plural
    const end = EIN_W[cell][c];
    return (det.stem === 'euer' && end ? 'eur' : det.stem) + end;
  }

  function renderDet(det, cell, c) {
    const form = detForm(det, cell, c);
    if (form === null) return null;
    if (!det.prep) return form;
    return CONTRACTED[det.prep]?.[form] ?? `${det.prep} ${form}`;
  }

  function adjTable(det, cell) {
    if (!det || (det.kind === 'ein' && cell === 'p' && det.stem === 'ein')) return STRONG;
    return det.kind === 'ein' ? MIXED : WEAK;
  }

  const ADJ = /^(\p{Ll}+?)(e|en|er|es|em)$/u;
  const splitAdj = w => { const m = ADJ.exec(w); return m && { stem: m[1], end: m[2] }; };

  const genS = w => w + (/(s|ß|x|z|sch|tz)$/.test(w) ? 'es' : 's');
  const weakForm = w => w + (w.endsWith('e') ? 'n' : 'en');
  const datPl = w => /[ns]$/.test(w) ? w : w + 'n';

  // Forms a Swiss noun takes for number (sg|pl) and case c.
  function swissForms(e, num, c) {
    if (num === 'pl') {
      if (!e.sPl.length) return [];
      return c === 2 ? e.sPl.flatMap(p => [p, datPl(p)]) : e.sPl;
    }
    if (e.sG === 'p') return [];
    if (e.sG === 'f') return [e.sLemma];
    if (e.sWeak) return c === 0 ? [e.sLemma] : [weakForm(e.sLemma)];
    return c === 3 ? [e.sLemma + 's', e.sLemma + 'es'] : [e.sLemma];
  }

  // German noun form (last word of the replacement only).
  function germanNoun(e, num, c) {
    if (num === 'pl') return c === 2 ? datPl(e.gPl) : e.gPl;
    if (e.gG === 'f') return e.gLemma;
    if (e.gWeak) return c === 0 ? e.gLemma : weakForm(e.gLemma);
    return c === 3 ? (e.gGen || genS(e.gLemma)) : e.gLemma;
  }

  function newNumber(e, num) {
    if (e.gG === 'p') return 'pl';
    if (num === 'pl' && !e.gPl) return 'sg'; // uncountable: "Randen" -> "Rote Bete"
    return num;
  }

  // Build the German replacement words: "Rot+ Bete" declines "Rot" as an adjective.
  function germanWords(e, cell, c, table, num) {
    const words = e.gWords.map(w => w.endsWith('+') ? w.slice(0, -1) + table[cell][c] : w);
    words.push(germanNoun(e, num, c));
    return words;
  }

  // All consistent readings of an NP, then the distinct German renderings.
  // np = { det, prep, adjs: [string], noun: string (Swiss form without compound prefix), prefix }
  function rewrite(e, np) {
    const readings = [];
    const prepCases = np.prep ? PREP[np.prep.toLowerCase()] : null;
    for (const num of ['sg', 'pl']) {
      const cell = num === 'pl' ? 'p' : e.sG;
      if (cell === 'p' && num === 'sg') continue;
      if (np.num && np.num !== num) continue; // "zwei Weggli" is plural
      for (let c = 0; c < 4; c++) {
        if (prepCases && !prepCases.includes(c)) continue;
        if (!swissForms(e, num, c).includes(np.noun)) continue;
        if (np.det ? detForm(np.det, cell, c) !== np.det.form : c === 3 && num === 'sg') continue; // bare genitive singular is rare
        const table = adjTable(np.det, cell);
        if (!np.adjs.every(a => splitAdj(a)?.end === table[cell][c])) continue;
        readings.push({ num, c });
      }
    }
    const outs = [];
    for (const { num, c } of readings) {
      const n2 = newNumber(e, num);
      const cell = n2 === 'pl' ? 'p' : e.gG;
      const table = adjTable(np.det, cell);
      const det = np.det ? renderDet(np.det, cell, c) : null;
      if (np.det && det === null) continue;
      const adjs = np.adjs.map(a => splitAdj(a).stem + table[cell][c]);
      const g = germanWords(e, cell, c, table, n2);
      g[g.length - 1] = np.prefix ? np.prefix + g[g.length - 1].toLowerCase() : g[g.length - 1];
      outs.push({ det, adjs, noun: g.join(' '), cell, c, oldCell: num === 'pl' ? 'p' : e.sG });
    }
    return outs;
  }

  function relMap(word, oldCell, newCell) {
    const w = word.toLowerCase(), out = new Set();
    REL[oldCell].forEach((f, c) => { if (f === w) out.add(REL[newCell][c]); });
    return [...out];
  }

  function pronMap(word, oldCell, newCell) {
    const w = word.toLowerCase(), out = new Set();
    if (!PRON[oldCell] || !PRON[newCell]) return [];
    PRON[oldCell].forEach((f, c) => { if (f === w) out.add(PRON[newCell][c]); });
    return [...out];
  }

  // Which gender/case cells a determiner can stand for: "der" is masculine
  // nominative, but also feminine dative or genitive, and genitive plural.
  function detCells(det) {
    const out = [];
    for (const cell of ['m', 'f', 'n', 'p'])
      for (let c = 0; c < 4; c++)
        if (detForm(det, cell, c) === det.form) out.push({ cell, c });
    return out;
  }

  root.HD_MORPH = { parseDet, rewrite, relMap, pronMap, splitAdj, detCells, PREP, PRON, REL };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HD_MORPH;
})(globalThis);
