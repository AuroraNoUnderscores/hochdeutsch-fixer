// The 44 notes from the test artifact with the expected output from its answer
// key (claude.ai artifacts ffc783d2 / d6beabf7). Ground truth for the suite.
// A third entry is a second acceptable wording (the Hamburg layer, or the
// alternative the key itself names).
globalThis.HD_CORPUS = [
  // Montag — collisions: ss hides two different words
  ['Die Masse strömte nach dem Konzert auf die Strasse hinaus.', 'Die Masse strömte nach dem Konzert auf die Straße hinaus.'],
  ['Der Schreiner nahm die Masse des Fensters, bevor er den Rahmen bestellte.', 'Der Schreiner nahm die Maße des Fensters, bevor er den Rahmen bestellte.',
   'Der Tischler nahm die Maße des Fensters, bevor er den Rahmen bestellte.'], // Hamburg: Schreiner -> Tischler
  ['Wegen des Streiks fahren heute keine Busse in die Innenstadt.', 'Wegen des Streiks fahren heute keine Busse in die Innenstadt.'],
  ['Der Richter verhängte eine Busse von zweihundert Franken.', 'Der Richter verhängte eine Buße von zweihundert Franken.'],
  ['Er hat immer ein Ass im Ärmel, wenn es ums Pokern geht.', 'Er hat immer ein Ass im Ärmel, wenn es ums Pokern geht.'],
  ['Ich ass letzte Woche zum ersten Mal Fondue.', 'Ich aß letzte Woche zum ersten Mal Fondue.'],
  ['Die Katze rollte sich auf seinem Schoss zusammen und schlief ein.', 'Die Katze rollte sich auf seinem Schoß zusammen und schlief ein.'],
  ['Der Biathlet schoss zweimal daneben und musste eine Strafrunde drehen.', 'Der Biathlet schoss zweimal daneben und musste eine Strafrunde drehen.'],

  // Dienstag — plain ß restoration
  ['Können wir das draussen machen? Es ist so ein schöner Tag.', 'Können wir das draußen machen? Es ist so ein schöner Tag.'],
  ['Der Spass hört auf, sobald sich jemand verletzt.', 'Der Spaß hört auf, sobald sich jemand verletzt.'],
  ['Das neue Studio ist erstaunlich gross.', 'Das neue Studio ist erstaunlich groß.'],
  ['Wie heisst dein neuer Mitbewohner?', 'Wie heißt dein neuer Mitbewohner?'],
  ['Ich weiss noch nicht, ob ich mitkomme.', 'Ich weiß noch nicht, ob ich mitkomme.'],
  ['Nach dem Marathon taten ihm die Füsse weh.', 'Nach dem Marathon taten ihm die Füße weh.'],
  ['Herzlichen Gruss aus Zürich!', 'Herzlichen Gruß aus Zürich!'],
  ['Grüss deine Familie von mir!', 'Grüße deine Familie von mir!'],

  // Mittwoch — controls: ss stays ss
  ['Ich weiss, dass wir zu spät dran sind.', 'Ich weiß, dass wir zu spät dran sind.'],
  ['Wir müssen den Bericht bis Freitag abgeben.', 'Wir müssen den Bericht bis Freitag abgeben.'],
  ['Der Prozess gegen den Konzern zieht sich über Jahre hin.', 'Der Prozess gegen den Konzern zieht sich über Jahre hin.'],
  ['Der Ausschuss trifft sich jeden Montag um neun Uhr.', 'Der Ausschuss trifft sich jeden Montag um neun Uhr.'],
  ['Nach dem Regen war der Fluss deutlich höher als sonst.', 'Nach dem Regen war der Fluss deutlich höher als sonst.'],
  ['Zum Dessert gab es Nüsse mit Honig.', 'Zum Dessert gab es Nüsse mit Honig.'],
  ['Sie hat mir zum Abschied einen Kuss auf die Wange gegeben.', 'Sie hat mir zum Abschied einen Kuss auf die Wange gegeben.'],
  ['Die Massage nach dem Training tat unglaublich gut.', 'Die Massage nach dem Training tat unglaublich gut.'],
  ['Der Masseur empfahl mir, öfter zu dehnen.', 'Der Masseur empfahl mir, öfter zu dehnen.'],
  ['Wir haben die alten Skier und Kartons auf den Estrich gestellt.', 'Wir haben die alten Skier und Kartons auf den Dachboden gestellt.'],

  // Donnerstag + Freitag — vocabulary
  ['Ich fahre lieber mit dem Velo als mit dem Bus.', 'Ich fahre lieber mit dem Fahrrad als mit dem Bus.'],
  ['Pass auf, bleib auf dem Trottoir!', 'Pass auf, bleib auf dem Bürgersteig!'],
  ['Zum Zmittag gab es Poulet mit Pommes.', 'Zum Mittagessen gab es Hähnchen mit Pommes.'],
  ['Kannst du mir dein Natel kurz leihen?', 'Kannst du mir dein Handy kurz leihen?'],
  ['Das Lavabo im Bad tropft schon seit Tagen.', 'Das Waschbecken im Bad tropft schon seit Tagen.'],
  ['Am Freitagabend treffen wir uns in der Beiz um die Ecke.', 'Am Freitagabend treffen wir uns in der Kneipe um die Ecke.'],
  ['Hier darf man leider nicht parkieren.', 'Hier darf man leider nicht parken.'],
  ['Beim Coiffeur musste ich eine Stunde warten.', 'Beim Friseur musste ich eine Stunde warten.'],
  ['Hast du schon ein Billett für den Zug gekauft?', 'Hast du schon eine Fahrkarte für den Zug gekauft?'],
  ['Der Zug hält gleich am ersten Perron.', 'Der Zug hält gleich am ersten Bahnsteig.'],
  ['Ein Camion blockierte die ganze Kreuzung.', 'Ein Lastwagen blockierte die ganze Kreuzung.'],
  ['Der linke Pneu hat kaum noch Profil.', 'Der linke Reifen hat kaum noch Profil.'],
  ['Zum Kaffee gab es hausgemachte Guetzli.', 'Zum Kaffee gab es hausgemachte Kekse.',
   'Zum Kaffee gab es hausgemachte Plätzchen.'], // neutral mode says Plätzchen, which the key allows

  // Samstag — grammar
  ['Es hat heute Abend noch Tische frei im Restaurant.', 'Es gibt heute Abend noch freie Tische im Restaurant.'],
  ['Der Kollege, wo mir immer hilft, ist heute krank.', 'Der Kollege, der mir immer hilft, ist heute krank.'],
  ['Ich bin die ganze Vorlesung auf dem harten Stuhl gesessen.', 'Ich habe die ganze Vorlesung auf dem harten Stuhl gesessen.'],
  ['Er ist stundenlang an der Bushaltestelle gestanden.', 'Er hat stundenlang an der Bushaltestelle gestanden.'],

  // Sonntag — everything at once, in one text node
  ['Die Masse der Zuschauer stand schon früh auf dem Trottoir vor dem Stadion. Weil es so heiss war, ass ich rasch eine Glace, bevor ich mit dem Velo weiterfuhr. Ein Polizist erklärte mir, ich müsse eine Busse zahlen, weil mein Pneu praktisch platt war. Auf dem Perron nahm ich danach die Masse meines Koffers, damit er wirklich ins Gepäckfach passt. Der Typ, wo neben mir sass, hat mir sein Natel geliehen, weil es in der Beiz keinen Empfang hatte, und meinte nur: „Es hat hier sowieso immer zu viele Leute.“',
   'Die Masse der Zuschauer stand schon früh auf dem Bürgersteig vor dem Stadion. Weil es so heiß war, aß ich rasch ein Eis, bevor ich mit dem Fahrrad weiterfuhr. Ein Polizist erklärte mir, ich müsse eine Buße zahlen, weil mein Reifen praktisch platt war. Auf dem Bahnsteig nahm ich danach die Maße meines Koffers, damit er wirklich ins Gepäckfach passt. Der Typ, der neben mir saß, hat mir sein Handy geliehen, weil es in der Kneipe keinen Empfang hatte, und meinte nur: „Es gibt hier sowieso immer zu viele Leute.“'],
];
