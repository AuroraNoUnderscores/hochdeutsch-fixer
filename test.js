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
  ['Er sass im Estrich.', 'Er saß auf dem Dachboden.'],        // German keeps things on the attic

  // numbers, greetings, phrases
  ['Das kostet 1\'250\'000 Franken bzw. 3\'499.90 CHF.', 'Das kostet 1.250.000 Franken bzw. 3.499,90 CHF.'],
  ['Grüezi mitenand!', 'Hallo zusammen!'],                     // Moin is the Hamburg flavour only
  ['Grüezi, wie geht es?', 'Guten Tag, wie geht es?'],
  ['Grüezi mitenand!', 'Moin zusammen!', 'hamburg'],
  ['Grüss Gott, Herr Meier!', 'Grüß Gott, Herr Meier!'],
  ['Grüss dich!', 'Grüß dich!'],
  ['Grüss deine Familie von mir!', 'Grüße deine Familie von mir!'],
  ['Das kostet CHF 12.50 bzw. Fr. 3.– oder 12.50 Franken.', 'Das kostet CHF 12,50 bzw. Fr. 3,– oder 12,50 Franken.'],
  ['Am 12.05.2024 um 12.30 Uhr', 'Am 12.05.2024 um 12.30 Uhr'],

  // ambiguous words settled by the topic, without asking the model (ch.ch)
  ['Wie hoch sind die Bussen für zu schnelles Fahren?', 'Wie hoch sind die Bußen für zu schnelles Fahren?'],
  ['Sie müssen mit folgenden Bussen (in Franken) rechnen.', 'Sie müssen mit folgenden Bußen (in Franken) rechnen.'],
  ['Geldbusse oder Anzeige', 'Geldbuße oder Anzeige'],
  ['Die Ordnungsbusse beträgt 40 Franken.', 'Das Bußgeld beträgt 40 Franken.'],
  ['Die Bussen fahren ab dem Bahnhof im Halbstundentakt.', 'Die Bussen fahren ab dem Bahnhof im Halbstundentakt.'],

  // ss spellings the topic can settle without the model
  ['Der Schreiner nahm die Masse des Fensters.', 'Der Tischler nahm die Maße des Fensters.', 'hamburg'],
  ['Die Masse strömte nach dem Konzert auf die Strasse hinaus.', 'Die Masse strömte nach dem Konzert auf die Straße hinaus.'],

  // defaults without the model: choices keep the safe option
  ['Er musste eine Busse zahlen.', 'Er musste eine Buße zahlen.'], // "zahlen" is a cue
  ['Die Busse war hoch.', 'Die Busse war hoch.'],                        // no cue: model decides
  ['Die Masse des Zimmers', 'Die Maße des Zimmers'], // "Zimmer" is a cue
  ['Wir zügeln morgen nach Bern.', 'Wir zügeln morgen nach Bern.'],

  // things referring back to a noun whose gender changed
  ['Der Entscheid ist gefallen. Er war knapp.', 'Die Entscheidung ist gefallen. Sie war knapp.'],
  ['Das Tram kommt. Es ist voll.', 'Die Straßenbahn kommt. Sie ist voll.'],
  ['Ich nehme das Tram. Ich mag es.', 'Ich nehme die Straßenbahn. Ich mag es.'], // only a pronoun that opens the next sentence is rewritten
  ['Das Tram kam. Es regnet seit gestern.', 'Die Straßenbahn kam. Es regnet seit gestern.'],
  ['Der Entscheid kam. Der Richter sagte, er sei knapp.', 'Die Entscheidung kam. Der Richter sagte, er sei knapp.'],
  ['Das Velo ist weg. Es war teuer.', 'Das Fahrrad ist weg. Es war teuer.'],
  ['Auf dem Trottoir parkieren ist verboten; es droht eine Busse.', 'Auf dem Bürgersteig parken ist verboten; es droht eine Buße.'],

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

  // Swiss grammar
  ['Ich bin die ganze Vorlesung gesessen.', 'Ich habe die ganze Vorlesung gesessen.'],
  ['Er ist stundenlang gestanden.', 'Er hat stundenlang gestanden.'],
  ['Es hat gestern geregnet.', 'Es hat gestern geregnet.'],           // perfect, not existential
  ['Sie hat es eilig.', 'Sie hat es eilig.'],                         // "sie" is the subject
  ['Er hat es mir gegeben.', 'Er hat es mir gegeben.'],
  ['Es hat noch viele Leute hier.', 'Es gibt noch viele Leute hier.'],
  ['Der Kollege, wo mir hilft, ist krank.', 'Der Kollege, der mir hilft, ist krank.'],
  ['Die Stadt, wo ich wohne, ist klein.', 'Die Stadt, wo ich wohne, ist klein.'], // a place keeps "wo"
  ['Es gibt Durchbrüche in der mathematischen Forschung, wo neue Sätze gefunden wurden.', 'Es gibt Durchbrüche in der mathematischen Forschung, wo neue Sätze gefunden wurden.'], // in a place the noun names
  ['Ich warte auf den Kollegen, wo mir hilft.', 'Ich warte auf den Kollegen, der mir hilft.'], // "auf den": not a place
  ['Er hat Erfolg in der Firma, wo er arbeitet.', 'Er hat Erfolg in der Firma, wo er arbeitet.'], // a subject of its own: a place
  ['Ich wohne bei einer Familie, wo sehr nett ist.', 'Ich wohne bei einer Familie, die sehr nett ist.'], // no subject: "wo" is it
  ['Er sitzt neben dem Mann, wo gestern angerufen hat.', 'Er sitzt neben dem Mann, der gestern angerufen hat.'],
  ['Ich stehe vor dem Lehrer, wo mich am Montag geprüft hat.', 'Ich stehe vor dem Lehrer, der mich am Montag geprüft hat.'], // "am Montag" is no subject
  ['Er hat ein Ass im Ärmel.', 'Er hat ein Ass im Ärmel.'],
  ['Ich ass zu viel.', 'Ich aß zu viel.'],
  ['Sie sass auf seinem Schoss.', 'Sie saß auf seinem Schoß.'],
  ['Der Torhüter schoss daneben.', 'Der Torhüter schoss daneben.'],

  // found on real .ch pages (dev/swiss.html)
  ['Die grosse Offerte kam gestern.', 'Das große Angebot kam gestern.'],       // an ss-adjective broke agreement
  ['Der grosse Entscheid fiel gestern.', 'Die große Entscheidung fiel gestern.'],
  ['Diese Dienstleistung kann in der Offerte enthalten sein.', 'Diese Dienstleistung kann im Angebot enthalten sein.'],
  ['Wir gehen zu der Beiz.', 'Wir gehen zu der Kneipe.'],                    // the writer chose "zu der" over "zur"
  ['Das berühmte Sasara-Tram kommt.', 'Die berühmte Sasara-Straßenbahn kommt.'],
  ['Den Töff-Crack kennt jeder.', 'Den Motorrad-Crack kennt jeder.'],        // the last part decides the article
  ['Welche Eigenschaften braucht eine MaturandIn?', 'Welche Eigenschaften braucht eine MaturandIn?'],
  ['Die Frau trägt einen kleinen Bub auf dem Arm.', 'Die Frau trägt einen kleinen Jungen auf dem Arm.'],
  ['zur eidgenössisch anerkannten gymnasialen Maturität', 'zum eidgenössisch anerkannten gymnasialen Abitur'],
  ['mit einer gut bestandenen Matura', 'mit einem gut bestandenen Abitur'],
  ['Wir stellen die Kisten in den Estrich.', 'Wir stellen die Kisten auf den Dachboden.'],
  ['Lauch und Rüebli dazugeben.', 'Lauch und Karotten dazugeben.'],          // no article: plural
  ['Die Stadt ist sehr velofreundlich.', 'Die Stadt ist sehr fahrradfreundlich.'],
  ['Das Auto muss hier parkiert werden.', 'Das Auto muss hier geparkt werden.'],
  ['Er sagt, dass er falsch parkiert hat.', 'Er sagt, dass er falsch geparkt hat.'],
  ['Er hat das Auto, das rot ist, parkiert.', 'Er hat das Auto, das rot ist, geparkt.'],
  ['Er ist müde, weil er schlecht parkiert.', 'Er ist müde, weil er schlecht parkt.'],
  ['Er hat gesagt, er parkiert hier.', 'Er hat gesagt, er parkt hier.'],
  ['Wegen dem Entscheid ärgert er sich.', 'Wegen der Entscheidung ärgert er sich.'], // "er" is a person
  ['Der Entscheid fiel und er war knapp.', 'Die Entscheidung fiel und sie war knapp.'],
  ['Das Hotel ist ruhig gelegen.', 'Das Hotel ist ruhig gelegen.'],          // an adjective: model decides, default kept
  ['Ich bin pressiert.', 'Ich bin in Eile.'],
  ['Bist du pressiert?', 'Bist du in Eile?'],
  ['Es pressiert.', 'Es eilt.'],
  ['Die Tagesmutter, wo ich kenne, ist nett.', 'Die Tagesmutter, die ich kenne, ist nett.'],
  ['Er erstellt eine faire Offerte, die Sie überraschen wird.', 'Er erstellt ein faires Angebot, das Sie überraschen wird.'], // "Sie" is the reader
  ['Wir bauen das Tram- und Busangebot aus.', 'Wir bauen das Straßenbahn- und Busangebot aus.'],
  ['Falls das soeben gekaufte Billett fehlt', 'Falls die soeben gekaufte Fahrkarte fehlt'],
  ['mit Verweis auf das Messerstecher-Inserat', 'mit Verweis auf die Messerstecher-Anzeige'],
  ['Er wurde Vater eines Buben und eines Meitli.', 'Er wurde Vater eines Jungen und eines Mädchens.'],
  ['Wir erstellen eine auf Sie zugeschnittene Offerte.', 'Wir erstellen ein auf Sie zugeschnittenes Angebot.'],
  ['Die auf dem Tisch liegende Offerte ist neu.', 'Das auf dem Tisch liegende Angebot ist neu.'],
  ['Ein Curry kostet 8.90 EUR.', 'Ein Curry kostet 8,90 EUR.'],
  // words found by measurement on .ch pages
  ['Gemäss Medienmitteilung wurde der Gemeindepräsident Ende Jahr pensioniert.', 'Gemäß Pressemitteilung wurde der Bürgermeister Ende des Jahres pensioniert.'],
  ['Die Lehrpersonen der Primarschule treffen sich im Schulzimmer.', 'Die Lehrkräfte der Grundschule treffen sich im Klassenzimmer.'],
  ['Die Baubewilligung wurde nach einer Einsprache erteilt.', 'Die Baugenehmigung wurde nach einem Einspruch erteilt.'],
  ['Wir haben eine Reservation für heute.', 'Wir haben eine Reservierung für heute.'],
  ['Auf 20 Hektaren wachsen Reben.', 'Auf 20 Hektar wachsen Reben.'],
  ['Resp. die Anmeldung ist bis anhin nicht aufgeschaltet.', 'Bzw. die Anmeldung ist bisher nicht freigeschaltet.'],
  ['Wir suchen eine Zügelfirma für den Zügeltermin.', 'Wir suchen eine Umzugsfirma für den Umzugstermin.'],
  ['Die Rahmsauce und die Rahmenbedingungen', 'Die Sahnesauce und die Rahmenbedingungen'],
  ['Von den Peperoni die Kerne entfernen.', 'Von den Paprika die Kerne entfernen.'],        // no dative -n after a vowel
  ['Von den scharfen Peperoni die Kerne entfernen.', 'Von den scharfen Peperoni die Kerne entfernen.'], // chili: German too
  ['Die Storen sind kaputt.', 'Die Jalousien sind kaputt.'],
  ['Im App Store gibt es den Store nicht.', 'Im App Store gibt es den Store nicht.'],      // a shop unless it says blind
  ['Die Koffer sind im Estrich verstaut.', 'Die Koffer sind auf dem Dachboden verstaut.'],
  ['Die Risse im Estrich muss der Estrichleger ausbessern.', 'Die Risse im Estrich muss der Estrichleger ausbessern.'], // screed
  ['Lade die App im Google Play Store herunter.', 'Lade die App im Google Play Store herunter.'],

  // agreement without an article, and around adverbs
  ['Antrag und Umschreibung Führerausweises', 'Antrag und Umschreibung Führerscheins'],
  ['die daraus folgende Limite', 'das daraus folgende Limit'],
  ['verbindliche Offerte von einem Partner', 'verbindliches Angebot von einem Partner'],
  ['Grosse Offerte für alle', 'Großes Angebot für alle'],
  ['Nach zwei Jahren pandemiebedingtem Unterbruch', 'Nach zwei Jahren pandemiebedingter Unterbrechung'],
  ['Das Rezept für eine mal etwas andere Wähe.', 'Das Rezept für einen mal etwas anderen Blechkuchen.'],
  ['Wir senden Offerten an alle.', 'Wir senden Angebote an alle.'],
  ['Mit seinem Übernamen war er bekannt.', 'Mit seinem Spitznamen war er bekannt.'],
  ['die Beurteilung des Anfangsmietzinses', 'die Beurteilung der Anfangsmiete'],
  ['Der Neulenker muss vorsichtig fahren.', 'Der Fahranfänger muss vorsichtig fahren.'],
  ['Für Neulenkerinnen gilt eine Probezeit.', 'Für Fahranfängerinnen gilt eine Probezeit.'],

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
