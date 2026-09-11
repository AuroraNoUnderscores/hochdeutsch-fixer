// Rules-only tests (no model): every choice takes its default option.
// Run with `node test.js`, or open test.html in a browser.
const E = typeof require === 'function' ? require('./engine.js') : globalThis.HD_ENGINE;
const log = typeof document !== 'undefined'
  ? s => document.body.insertAdjacentText('beforeend', s + '\n')
  : console.log;

// [input, expected, mode] - mode defaults to neutral
const cases = [
  // vocabulary and compounds
  ['Ich fahre mit dem Velo.', 'Ich fahre mit dem Fahrrad.'],
  ['Die Velos stehen auf dem Trottoir.', 'Die Fahrräder stehen auf dem Bürgersteig.'],
  ['Der Veloweg ist neu.', 'Der Radweg ist neu.'],
  ['Die Velostation beim Bahnhof.', 'Die Fahrradstation beim Bahnhof.'],
  ['Ein Elektrovelo kostet viel.', 'Ein Elektrofahrrad kostet viel.'],
  ['Velours ist ein Stoff.', 'Velours ist ein Stoff.'],
  ['Sie liegt im Kantonsspital.', 'Sie liegt im Kantonskrankenhaus.'],
  ['Das Hospital', 'Das Hospital'],
  ['Pouletbrust mit Rahm', 'Hähnchenbrust mit Sahne'],
  ['Der Rahmen bleibt.', 'Der Rahmen bleibt.'],
  ['pneumatisch und Pneuwechsel', 'pneumatisch und Reifenwechsel'],
  ['VELO', 'FAHRRAD'],

  // declension: gender, case and number after the swap
  ['Der Entscheid fällt morgen.', 'Die Entscheidung fällt morgen.'],
  ['Wir haben den Entscheid getroffen.', 'Wir haben die Entscheidung getroffen.'],
  ['Trotz des Entscheids bleibt alles offen.', 'Trotz der Entscheidung bleibt alles offen.'],
  ['Wir fahren mit den Velos.', 'Wir fahren mit den Fahrrädern.'],
  ['Der Preis des Velos ist hoch.', 'Der Preis des Fahrrads ist hoch.'],
  ['Das Tram kommt gleich.', 'Die Straßenbahn kommt gleich.'],
  ['Ich sitze im Tram.', 'Ich sitze in der Straßenbahn.'],
  ['Er steigt ins Tram.', 'Er steigt in die Straßenbahn.'],
  ['Ein wichtiger Entscheid', 'Eine wichtige Entscheidung'],
  ['Wegen des wichtigen Entscheids', 'Wegen der wichtigen Entscheidung'],
  ['Mein neues Velo', 'Mein neues Fahrrad'],
  ['Dieses alte Trottoir', 'Dieser alte Bürgersteig'],
  ['Der Entscheid, der gestern fiel, war knapp.', 'Die Entscheidung, die gestern fiel, war knapp.'],
  ['Das Billett, das ich kaufte', 'Die Fahrkarte, die ich kaufte'],
  ['Wir warten auf dem Perron.', 'Wir warten auf dem Bahnsteig.'],
  ['Sie kaufte ein Billett.', 'Sie kaufte eine Fahrkarte.'],
  ['Der Abwart öffnet die Tür.', 'Der Hausmeister öffnet die Tür.'],
  ['Er gab dem Buben ein Velo.', 'Er gab dem Jungen ein Fahrrad.'],

  // verbs
  ['Hier darf man nicht parkieren.', 'Hier darf man nicht parken.'],
  ['Er parkiert vor dem Haus.', 'Er parkt vor dem Haus.'],
  ['Er hat das Auto vor dem Haus parkiert.', 'Er hat das Auto vor dem Haus geparkt.'],
  ['Die parkierten Autos blockieren alles.', 'Die geparkten Autos blockieren alles.'],
  ['Grilliertes Gemüse', 'Gegrilltes Gemüse'],
  ['Ein Velofahrer ist verunfallt.', 'Ein Radfahrer ist verunglückt.'],

  // ß
  ['Das macht Spass!', 'Das macht Spaß!'],
  ['Grüsse aus der Bahnhofstrasse', 'Grüße aus der Bahnhofstraße'],
  ['Die Grösse und das Ausmass der Massnahme', 'Die Größe und das Ausmaß der Maßnahme'],
  ['Er weiss, dass das Wasser heiss ist.', 'Er weiß, dass das Wasser heiß ist.'],
  ['Der Beweisstück und das Hinweisschild', 'Der Beweisstück und das Hinweisschild'],
  ['Die Preissenkung für die Kreissäge', 'Die Preissenkung für die Kreissäge'],
  ['Er reisst den Reissverschluss auf.', 'Er reißt den Reißverschluss auf.'],
  ['Der Fluss, das Schloss, der Prozess, muss, dass', 'Der Fluss, das Schloss, der Prozess, muss, dass'],
  ['regelmässig, gemäss, schliesslich, draussen, ausserdem', 'regelmäßig, gemäß, schließlich, draußen, außerdem'],
  ['Der Fussball ist gross. Die Fussel', 'Der Fußball ist groß. Die Fussel'],
  ['Er sass im Estrich.', 'Er saß im Dachboden.'],

  // numbers, greetings, phrases
  ['Das kostet 1\'250\'000 Franken bzw. 3\'499.90 CHF.', 'Das kostet 1.250.000 Franken bzw. 3.499,90 CHF.'],
  ['Grüezi mitenand!', 'Moin zusammen!'],
  ['Grüezi, wie geht es?', 'Moin, wie geht es?'],

  // ambiguous words settled by the topic, without asking the model (ch.ch)
  ['Wie hoch sind die Bussen für zu schnelles Fahren?', 'Wie hoch sind die Geldstrafen für zu schnelles Fahren?'],
  ['Sie müssen mit folgenden Bussen (in Franken) rechnen.', 'Sie müssen mit folgenden Geldstrafen (in Franken) rechnen.'],
  ['Geldbusse oder Anzeige', 'Geldstrafe oder Anzeige'],
  ['Die Ordnungsbusse beträgt 40 Franken.', 'Die Geldstrafe beträgt 40 Franken.'],
  ['Die Bussen fahren ab dem Bahnhof im Halbstundentakt.', 'Die Bussen fahren ab dem Bahnhof im Halbstundentakt.'],

  // defaults without the model: choices keep the safe option
  ['Er musste eine Busse zahlen.', 'Er musste eine Geldstrafe zahlen.'], // "zahlen" is a cue
  ['Die Busse war hoch.', 'Die Busse war hoch.'],                        // no cue: model decides
  ['Die Masse des Zimmers', 'Die Masse des Zimmers'],
  ['Wir zügeln morgen nach Bern.', 'Wir zügeln morgen nach Bern.'],

  // things referring back to a noun whose gender changed
  ['Der Entscheid ist gefallen. Er war knapp.', 'Die Entscheidung ist gefallen. Sie war knapp.'],
  ['Das Tram kommt. Es ist voll.', 'Die Straßenbahn kommt. Sie ist voll.'],
  ['Ich nehme das Tram. Ich mag es.', 'Ich nehme die Straßenbahn. Ich mag sie.'],
  ['Das Tram kam. Es regnet seit gestern.', 'Die Straßenbahn kam. Es regnet seit gestern.'],
  ['Der Entscheid kam. Der Richter sagte, er sei knapp.', 'Die Entscheidung kam. Der Richter sagte, er sei knapp.'],
  ['Das Velo ist weg. Es war teuer.', 'Das Fahrrad ist weg. Es war teuer.'],
  ['Auf dem Trottoir parkieren ist verboten; es droht eine Busse.', 'Auf dem Bürgersteig parken ist verboten; es droht eine Geldstrafe.'],

  // text about words, not using them: left exactly as it is (verstaendlich.ch)
  ['Sowohl Mass (1) wie auch Masse (2) werden in der Mehrzahl zu Massen.',
   'Sowohl Mass (1) wie auch Masse (2) werden in der Mehrzahl zu Massen.'],
  ['Verantwortlich für diese Doppeldeutigkeit ist das Wort Massen.',
   'Verantwortlich für diese Doppeldeutigkeit ist das Wort Massen.'],
  ['In der Schweiz sagt man Velo, in Deutschland Fahrrad.',
   'In der Schweiz sagt man Velo, in Deutschland Fahrrad.'],
  ['Zur Rechtschreibung: Man schreibt Strasse in der Schweiz ohne ß.',
   'Zur Rechtschreibung: Man schreibt Strasse in der Schweiz ohne ß.'],
  ['Er stellte das Velo an die Strasse.', 'Er stellte das Fahrrad an die Straße.'], // one weak cue is not enough
  ['Er schrieb «Velo» an die Tafel und fuhr mit dem Velo davon.',
   'Er schrieb «Velo» an die Tafel und fuhr mit dem Fahrrad davon.'],
  ['Masse und Maße sind zwei Wörter.', 'Masse und Maße sind zwei Wörter.'],

  // Hamburg mode
  ['Ich kaufe zwei Weggli.', 'Ich kaufe zwei Rundstücke.', 'hamburg'],
  ['Am Samstag sind die Brötchen frisch.', 'Am Sonnabend sind die Rundstücke frisch.', 'hamburg'],
  ['Das Meitli isst ein Guetzli.', 'Die Deern isst ein Keks.', 'hamburg'], // acc "einen" needs the model
  ['Wir essen Znacht beim Metzger.', 'Wir essen Abendbrot beim Schlachter.', 'hamburg'],
  ['Grüezi! Guten Tag!', 'Moin! Moin!', 'hamburg'],
  ['Der Schreiner kommt am Samstagmorgen.', 'Der Tischler kommt am Sonnabendmorgen.', 'hamburg'],
  ['Sie schwatzt mit dem Bub.', 'Sie schnackt mit dem Jung.', 'hamburg'],
  ['Ein herziges Rüebli', 'Eine putzige Wurzel', 'hamburg'],
];

let fail = 0;
for (const [input, want, mode = 'neutral'] of cases) {
  const got = E.convert(input, { mode }).text;
  if (got !== want) { fail++; log(`FAIL [${mode}]\n  in:   ${input}\n  want: ${want}\n  got:  ${got}`); }
}
log(`${cases.length - fail}/${cases.length} passed`);
if (typeof process !== 'undefined') process.exit(fail ? 1 : 0);
