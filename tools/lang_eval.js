// How well the engine tells German from English, French and Italian (lang.js,
// with the dictionary's Swiss words as German words: E.language), against the
// word list it replaces, on sentences it never saw: the test sets of Universal
// Dependencies treebanks (news, reviews, web, Wikipedia), fetched once into
// tools/.ud/, and the Swiss sentences of the answer key and test.js (those the
// rules change, so Swiss German for sure).
//     node tools/lang_eval.js
const fs = require('fs'), path = require('path');
const E = require('../engine.js');
const DIR = path.join(__dirname, '.ud');
const SETS = {
  de: ['UD_German-GSD/de_gsd-ud-test', 'UD_German-HDT/de_hdt-ud-test'],
  en: ['UD_English-EWT/en_ewt-ud-test', 'UD_English-GUM/en_gum-ud-test'],
  fr: ['UD_French-GSD/fr_gsd-ud-test'],
  it: ['UD_Italian-ISDT/it_isdt-ud-test'],
};

// the check this replaces (content.js, pdftext.js before)
const GERMAN = /(?<!\p{L})(?:der|die|das|den|dem|des|und|ist|sind|war|nicht|mit|für|ein|eine|einen|einem|von|zu|zum|zur|auf|sich|wir|wird|werden|auch|aber|oder|im|am|beim|vom|bei|dass|haben|hat|habe|hast|hatte|kann|muss|nach|über|nur|noch|wie|was|schon|sehr|man|als|wenn|ich|mir|mich|dir|uns|euch|bin|bist|mein|meine|dein|sein|seine|kein|keine|wurde|bitte|danke|viele|heute|gestern|jetzt|hier|dort)(?!\p{L})/giu;
const old = t => { const n = (t.match(GERMAN) || []).length; return n >= 2 || (n >= 1 && /[äöüßÄÖÜ]/.test(t)); };

async function sentences(spec) {
  const file = path.join(DIR, path.basename(spec) + '.conllu');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DIR, { recursive: true });
    const res = await fetch(`https://raw.githubusercontent.com/UniversalDependencies/${path.dirname(spec)}/master/${path.basename(spec)}.conllu`);
    fs.writeFileSync(file, await res.text());
  }
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.startsWith('# text = ')).map(l => l.slice(9));
}

function swiss() {
  globalThis.window = globalThis;
  require('../dev/corpus.js');
  const src = fs.readFileSync(path.join(__dirname, '../test.js'), 'utf8');
  const cases = [...src.matchAll(/^\s*\['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'/gm)].filter(m => m[1] !== m[2]).map(m => m[1]);
  return [...globalThis.HD_CORPUS.map(c => c[0]), ...cases];
}

(async () => {
  const data = { swiss: swiss() };
  for (const [l, specs] of Object.entries(SETS)) data[l] = (await Promise.all(specs.map(sentences))).flat();
  const bucket = s => { const n = (s.match(/\p{L}+/gu) || []).length; return n <= 3 ? '1-3 words' : n <= 8 ? '4-8 words' : '9+ words'; };
  const rows = [];
  for (const [set, list] of Object.entries(data)) {
    const want = set === 'swiss' || set === 'de';
    for (const b of ['1-3 words', '4-8 words', '9+ words', 'all']) {
      const xs = list.filter(s => b === 'all' || bucket(s) === b);
      if (!xs.length) continue;
      const wrongOld = xs.filter(s => old(s) !== want).length;
      const wrongNew = xs.filter(s => (E.language(s).lang === 'de') !== want).length;
      rows.push([set, b, xs.length, (100 * wrongOld / xs.length).toFixed(1) + '%', (100 * wrongNew / xs.length).toFixed(1) + '%']);
    }
  }
  console.log('set    length       sentences  wrong: word list   engine');
  for (const r of rows) console.log(r[0].padEnd(7), r[1].padEnd(12), String(r[2]).padStart(9), r[3].padStart(17), r[4].padStart(8));
  if (process.argv[2] === '--show') for (const [set, list] of Object.entries(data))
    for (const s of list) if ((E.language(s).lang === 'de') !== (set === 'swiss' || set === 'de')) console.log(set, E.language(s).lang, s);
})();
