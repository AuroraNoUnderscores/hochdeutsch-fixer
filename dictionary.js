// Swiss Standard German -> German Standard German (with an optional Hamburg layer).
//
// nouns: "Swiss/gender/plural = German/gender/plural | flags"
//   gender m/f/n, or p for plural-only words. Plural "-" = uncountable,
//   commas separate alternative plurals. In the German part "Rot+ Bete" means
//   "Rot" declines like an adjective. Flags: s = also matches as the end of a
//   compound ("Elektrovelo"), sw/gw = weak masculine (den Buben / den Jungen),
//   gen=Form = irregular genitive, x=regex = compound exceptions.
// words: "swiss,forms>german,forms" for everything that doesn't decline like
//   a noun. Paired by position; the last German form is reused if the list is
//   shorter. A trailing * expands adjective endings. Keys are case-sensitive.
// phrases: multi-word "a,b>c". verbs: [swissStem, germanStem, participlePrefix].
// compounds: [head, replacement] for compounds whose last part stays
//   ("Veloweg"); gender comes from the last part, so no declension changes.
// ambiguous: "swiss>german" words that are also valid German with another
//   meaning (Busse = fine or buses); the language model decides.
// ss: stems where Swiss "ss" is "ß" in Germany ("stem!exceptionRegex").
//   Other ss-words go to the language model unless listed in ssKeep.
globalThis.HD_DICT = {
  nouns: [
    // Verkehr
    'Velo/n/Velos = Fahrrad/n/Fahrräder | s x=velours|veloci|velodrom|veloce',
    'Velofahrer/m/Velofahrer = Radfahrer/m/Radfahrer',
    'Velofahrerin/f/Velofahrerinnen = Radfahrerin/f/Radfahrerinnen',
    'Velofahren/n/- = Radfahren/n/-',
    'Veloweg/m/Velowege = Radweg/m/Radwege',
    'Velotour/f/Velotouren = Radtour/f/Radtouren',
    'Velostreifen/m/Velostreifen = Radfahrstreifen/m/Radfahrstreifen',
    'Trottoir/n/Trottoirs = Bürgersteig/m/Bürgersteige',
    'Perron/m/Perrons = Bahnsteig/m/Bahnsteige',
    'Billett/n/Billette,Billetts = Fahrkarte/f/Fahrkarten',
    'Retourbillett/n/Retourbillette,Retourbilletts = Rückfahrkarte/f/Rückfahrkarten',
    'Kondukteur/m/Kondukteure = Schaffner/m/Schaffner',
    'Kondukteurin/f/Kondukteurinnen = Schaffnerin/f/Schaffnerinnen',
    'Camion/m/Camions = Lastwagen/m/Lastwagen',
    'Reisecar/m/Reisecars = Reisebus/m/Reisebusse | gen=Reisebusses',
    'Pneu/m/Pneus = Reifen/m/Reifen',
    'Führerausweis/m/Führerausweise = Führerschein/m/Führerscheine',
    'Fahrausweis/m/Fahrausweise = Führerschein/m/Führerscheine',
    'Lichtsignal/n/Lichtsignale = Ampel/f/Ampeln',
    'Lichtsignalanlage/f/Lichtsignalanlagen = Ampelanlage/f/Ampelanlagen',
    'Töff/m/Töffs = Motorrad/n/Motorräder',
    'Töffli/n/Töffli,Töfflis = Mofa/n/Mofas',
    'Trottinett/n/Trottinetts = Tretroller/m/Tretroller',
    'Parking/n/Parkings = Parkhaus/n/Parkhäuser',
    'Parkierung/f/- = Parken/n/-',
    'Tram/n/Trams = Straßenbahn/f/Straßenbahnen',
    'Match/m/Matchs,Matches = Spiel/n/Spiele',

    // Essen
    'Poulet/n/Poulets = Hähnchen/n/Hähnchen | s',
    'Rüebli/n/Rüebli = Karotte/f/Karotten',
    'Glace/f/Glacen = Eis/n/-',
    'Glacé/n/Glacés = Eis/n/-',
    'Rahm/m/- = Sahne/f/-',
    'Schlagrahm/m/- = Schlagsahne/f/-',
    'Vollrahm/m/- = Sahne/f/-',
    'Halbrahm/m/- = Kochsahne/f/-',
    'Peperoni/f/Peperoni = Paprika/f/Paprika',
    'Nüsslisalat/m/- = Feldsalat/m/-',
    'Rande/f/Randen = Rot+ Bete/f/-',
    'Gipfeli/n/Gipfeli = Croissant/n/Croissants',
    'Weggli/n/Weggli = Brötchen/n/Brötchen',
    'Bürli/n/Bürli = Brötchen/n/Brötchen',
    'Brötli/n/Brötli = Brötchen/n/Brötchen',
    'Konfitüre/f/Konfitüren = Marmelade/f/Marmeladen',
    'Kartoffelstock/m/- = Kartoffelbrei/m/-',
    'Crevette/f/Crevetten = Garnele/f/Garnelen | s',
    'Zucchetti/p/Zucchetti = Zucchini/p/Zucchini',
    'Baumnuss/f/Baumnüsse = Walnuss/f/Walnüsse',
    'Kefe/f/Kefen = Zuckerschote/f/Zuckerschoten',
    'Federkohl/m/- = Grünkohl/m/-',
    'Chabis/m/- = Weißkohl/m/-',
    'Bouillon/f/Bouillons = Brühe/f/Brühen',
    'Müesli/n/Müesli = Müsli/n/Müslis',
    'Guetzli/n/Guetzli = Plätzchen/n/Plätzchen',
    'Guetsli/n/Guetsli = Plätzchen/n/Plätzchen',
    'Schoggi/f/Schoggis = Schokolade/f/Schokoladen',
    'Zeltli/n/Zeltli = Bonbon/n/Bonbons',
    'Wienerli/n/Wienerli = Wiener Würstchen/n/Würstchen',
    'Hahnenwasser/n/- = Leitungswasser/n/-',
    'Morgenessen/n/- = Frühstück/n/-',
    'Zmorge/m/- = Frühstück/n/-',
    'Zmittag/m/- = Mittagessen/n/-',
    'Nachtessen/n/- = Abendessen/n/-',
    'Znacht/n/- = Abendessen/n/-',
    'Znüni/n/- = Vormittagssnack/m/Vormittagssnacks',
    'Zvieri/n/- = Nachmittagssnack/m/Nachmittagssnacks',
    'Kafi/m/- = Kaffee/m/-',
    'Beiz/f/Beizen = Kneipe/f/Kneipen',
    'Serviertochter/f/Serviertöchter = Kellnerin/f/Kellnerinnen',

    // Haushalt, Kleidung
    'Estrich/m/Estriche = Dachboden/m/Dachböden',
    'Lavabo/n/Lavabos = Waschbecken/n/Waschbecken',
    'Abwart/m/Abwarte = Hausmeister/m/Hausmeister',
    'Abwartin/f/Abwartinnen = Hausmeisterin/f/Hausmeisterinnen',
    'Kehricht/m/- = Müll/m/- | s',
    'Abfallkübel/m/Abfallkübel = Mülleimer/m/Mülleimer',
    'Kübel/m/Kübel = Eimer/m/Eimer',
    'Duvet/n/Duvets = Bettdecke/f/Bettdecken',
    'Store/m/Storen = Jalousie/f/Jalousien',
    'Cheminée/n/Cheminées = Kamin/m/Kamine',
    'Kleiderkasten/m/Kleiderkästen = Kleiderschrank/m/Kleiderschränke',
    'Pult/n/Pulte = Schreibtisch/m/Schreibtische',
    'Mietzins/m/Mietzinse = Miete/f/Mieten',
    'Inserat/n/Inserate = Anzeige/f/Anzeigen',
    'Couvert/n/Couverts = Umschlag/m/Umschläge',
    'Natel/n/Natels = Handy/n/Handys',
    'Sackmesser/n/Sackmesser = Taschenmesser/n/Taschenmesser',
    'Sackgeld/n/- = Taschengeld/n/-',
    'Nastuch/n/Nastücher = Taschentuch/n/Taschentücher',
    'Hosensack/m/Hosensäcke = Hosentasche/f/Hosentaschen',
    'Jupe/m/Jupes = Rock/m/Röcke',
    'Gilet/n/Gilets = Weste/f/Westen',
    'Coiffeur/m/Coiffeure = Friseur/m/Friseure',
    'Coiffeuse/f/Coiffeusen = Friseurin/f/Friseurinnen',
    'Päckli/n/Päckli = Päckchen/n/Päckchen',
    'Mass/n/- = Maß/n/-',

    // Leute
    'Bub/m/Buben = Junge/m/Jungen | sw gw',
    'Meitli/n/Meitli = Mädchen/n/Mädchen',
    'Grosi/n/Grosis = Oma/f/Omas',
    'Mami/n/Mamis = Mama/f/Mamas',
    'Papi/m/Papis = Papa/m/Papas',
    'Götti/m/Götti = Pate/m/Paten | gw',
    'Gotte/f/Gotten = Patin/f/Patinnen',

    // Amt, Schule, Arbeit
    'Spital/n/Spitäler = Krankenhaus/n/Krankenhäuser | s x=hospital',
    'Matura/f/- = Abitur/n/-',
    'Matur/f/- = Abitur/n/-',
    'Maturität/f/- = Abitur/n/-',
    'Maturand/m/Maturanden = Abiturient/m/Abiturienten | sw gw',
    'Maturandin/f/Maturandinnen = Abiturientin/f/Abiturientinnen',
    'Primarschule/f/Primarschulen = Grundschule/f/Grundschulen',
    'Detailhandel/m/- = Einzelhandel/m/-',
    'Traktandum/n/Traktanden = Tagesordnungspunkt/m/Tagesordnungspunkte',
    'Traktandenliste/f/Traktandenlisten = Tagesordnung/f/Tagesordnungen',
    'Vernehmlassung/f/Vernehmlassungen = Anhörung/f/Anhörungen',
    'Pendenz/f/Pendenzen = offen+ Aufgabe/f/Aufgaben',
    'Offerte/f/Offerten = Angebot/n/Angebote',
    'Salär/n/Saläre = Gehalt/n/Gehälter',
    'Unterbruch/m/Unterbrüche = Unterbrechung/f/Unterbrechungen',
    'Untersuch/m/Untersuche = Untersuchung/f/Untersuchungen',
    'Entscheid/m/Entscheide = Entscheidung/f/Entscheidungen',
    'Einvernahme/f/Einvernahmen = Vernehmung/f/Vernehmungen',
    'Rekurs/m/Rekurse = Beschwerde/f/Beschwerden',
    'Zivilstand/m/- = Familienstand/m/-',
    'Kassier/m/Kassiere = Kassierer/m/Kassierer',
    'Kassierin/f/Kassierinnen = Kassiererin/f/Kassiererinnen',
    'Sujet/n/Sujets = Motiv/n/Motive',
    'Communiqué/n/Communiqués = Pressemitteilung/f/Pressemitteilungen',
    'Beizug/m/- = Hinzuziehung/f/-',
    'Geldbusse/f/Geldbussen = Geldbuße/f/Geldbußen',
    'Ordnungsbusse/f/Ordnungsbussen = Bußgeld/n/Bußgelder',
    'Parkbusse/f/Parkbussen = Bußgeld/n/Bußgelder',
    'Verzeigung/f/Verzeigungen = Anzeige/f/Anzeigen',
    'Bancomat/m/Bancomaten = Geldautomat/m/Geldautomaten | sw gw',
  ],

  words: [
    'velofahren>Rad fahren',
    'allfällig*>etwaig*',
    'vorgängig>vorab',
    'vorgängige,vorgängigen,vorgängiger,vorgängiges,vorgängigem>vorherige,vorherigen,vorheriger,vorheriges,vorherigem',
    'speditiv*>zügig*', 'gäbig*>praktisch*', 'herzig*>süß*',
    'währschaft*>deftig*', 'gluschtig*>appetitlich*',
    'innert>innerhalb', 'heuer>dieses Jahr', 'ennet>jenseits',
    'allenfalls>gegebenenfalls', 'vorderhand>vorerst', 'handkehrum>andererseits',
    'zuhinterst,zuvorderst,zuoberst,zuunterst>ganz hinten,ganz vorne,ganz oben,ganz unten',
    'retour>zurück',
    'anläuten,angeläutet>anrufen,angerufen',
    'pressiert>eilt',
    'Grüezi>Moin', 'Salü,Sali,Hoi>Hallo', 'Merci>Danke', 'vielmal>vielmals',
    'Exgüsi>Entschuldigung',
    // ß in strong past tenses (whole words only)
    'sass,sassen,besass,besassen,vergass,vergassen,frass,frassen,assen>saß,saßen,besaß,besaßen,vergaß,vergaßen,fraß,fraßen,aßen',
    'Grüss>Grüße', 'mass>maß',
  ],

  phrases: [
    'Grüezi mitenand,Grüezi miteinand,Grüezi mitenander>Moin zusammen',
  ],

  verbs: [
    ['parkier', 'park', 'ge'],
    ['grillier', 'grill', 'ge'],
    ['campier', 'camp', 'ge'],
    ['verunfall', 'verunglück', ''],
  ],

  compounds: [
    ['velo', 'Fahrrad', '^velo(urs|ci|drom|ce)|^veloz'],
    ['poulet', 'Hähnchen'], ['glace', 'Eis'], ['natel', 'Handy'],
    ['billett', 'Fahrkarten'], ['pneu', 'Reifen', '^pneum'], ['coiffeur', 'Friseur'],
    ['trottoir', 'Bürgersteig'], ['camion', 'Lastwagen'], ['kehricht', 'Müll'],
    ['perron', 'Bahnsteig'], ['rüebli', 'Karotten'], ['crevetten', 'Garnelen'],
    ['lichtsignal', 'Ampel'], ['abwart', 'Hausmeister'], ['matura', 'Abitur'],
    ['maturitäts', 'Abitur'], ['primarschul', 'Grundschul'], ['schoggi', 'Schokoladen'],
    ['spital', 'Krankenhaus', '^spital(er|ern)$'],
  ],

  ambiguous: [
    'Finken>Hausschuhe',
    'Kasten>Schrank', 'Kästen>Schränke',
    'tönt>klingt', 'tönen>klingen', 'tönte>klang', 'tönten>klangen',
  ],

  // Words around an ambiguous word that settle which meaning it has, checked
  // against the text node and its block. A hit here beats the model, which only
  // judges how a sentence sounds and cannot know the topic of the page.
  cues: {
    'XXbusse,bussen': {
      pro: 'franken|chf|bezahl|zahlen|zahlt|geschwindigkeit|tempo|km/h|zu schnell|polizei|anzeige|strafe|verwarn|delikt|ordnungs|parkier|falschpark|führerausweis|fahrverbot|verkehrsregel|radar|blitz|übertret|widerhandl',
      contra: 'haltestelle|fahrplan|linie|chauffeur|verkehrsbetrieb|postauto|bahnhof|umsteig|reisebus|abfahrt|fahrgast|passagier|öv\\b',
    },
    finken: {
      pro: '\\bzieh|hausschuh|schuhe|socken|teppich|wohnung|barfuss|barfuß',
      contra: 'vogel|vögel|zwitscher|nest|gezwitscher|singvogel|futter',
    },
    'kasten,kästen': {
      pro: 'kleider|wäsche|schrank|möbel|schlafzimmer|einbau',
      contra: 'bier|harass|kiste|flaschen',
    },
    'tönt,tönen,tönte,tönten': {
      contra: 'haare|haar|farbe|blond|coiffeur|friseur|färben|strähn',
    },
  },

  // Text that talks *about* words must be left alone: rewriting the examples in
  // "Sowohl Mass (1) wie auch Masse (2) werden in der Mehrzahl zu Massen"
  // destroys the sentence, and no language model can tell, because both
  // spellings read perfectly naturally. One strong cue, or two weak ones,
  // switch the extension off for that page or block.
  meta: {
    strong: 'rechtschreibung|schreibweise|orthografi|orthographi|eszett|scharfes s|ss oder ß|ß oder ss|\\bduden\\b|grammatik|deutsch als fremdsprache|sprachblog|helvetism|sprachgebrauch|wortherkunft|etymologi',
    weak: 'das wort|die wörter|dem wort|der begriff|den begriff|ausdruck|mehrzahl|einzahl|\\bplural\\b|\\bsingular\\b|buchstabe|silbe|aussprache|schreibt man|sagt man|nennt man|heisst es|heißt es|gleich lautend|doppeldeutig|bedeutet|bedeutung|gesprochene sprache|übersetzt|wörtlich|dialekt|mundart|hochdeutsch|standarddeutsch',
  },

  // Swiss grammar, not vocabulary.
  syntax: {
    // Perfect with "sein" for verbs of position: süddt./CH "ich bin gesessen",
    // standard German "ich habe gesessen".
    sein2haben: {
      participles: ['gesessen', 'gestanden', 'gelegen'],
      forms: { bin: 'habe', bist: 'hast', ist: 'hat', sind: 'haben', seid: 'habt', war: 'hatte', warst: 'hattest', waren: 'hatten', wart: 'hattet', wäre: 'hätte', wären: 'hätten', sei: 'habe', seien: 'haben' },
    },
    // Existential "es hat" (like French "il y a") -> "es gibt". Not to be
    // confused with the perfect auxiliary ("es hat geregnet"), which keeps it.
    esHat: { hat: 'gibt', hatte: 'gab', habe: 'gebe', hätte: 'gäbe' },
    // "Es hat Tische frei" reads better as "Es gibt freie Tische".
    fronted: ['frei', 'offen', 'leer', 'belegt', 'übrig'],
    // Relative "wo" ("der Kollege, wo mir hilft") -> a relative pronoun. After a
    // place or a time it is ordinary German, so those are left alone.
    woKeep: 'stadt|ort|dorf|land|haus|zimmer|raum|platz|gegend|region|strasse|straße|stelle|punkt|moment|zeit|tag|woche|monat|jahr|augenblick|situation|fall|land|gebiet|ecke|winkel',
  },

  // "zügeln" = move house (separable "umziehen"), but also "rein in".
  zuegeln: {
    finite: { zügle: 'ziehe', zügelst: 'ziehst', zügelt: 'zieht', zügeln: 'ziehen', zügelte: 'zog', zügeltest: 'zogst', zügelten: 'zogen', zügeltet: 'zogt' },
    participle: { gezügelt: 'umgezogen' },
    aux: { habe: 'bin', hast: 'bist', hat: 'ist', haben: 'sind', habt: 'seid', hatte: 'war', hattest: 'warst', hatten: 'waren', hattet: 'wart' },
  },

  ss: [
    'strasse', 'strässch', 'gross', 'gröss', 'fuss!fussel', 'füss',
    'spass', 'späss', 'gruss', 'grüss', 'heiss', 'hiess',
    'weiss!(be|hin|aus|nach|ver|um|ab|an|er|rück|zurecht)weiss',
    'reiss![pkg]reiss|reiss[aouäöüc]',
    'beiss', 'scheiss', 'fleiss', 'schweiss', 'meissel',
    'schliess', 'fliess', 'giess', 'geniess', 'schiess', 'spriess', 'verdriess',
    'spiess', 'griess', 'liess', 'stiess',
    'aussen!hausse', 'ausser!hausse', 'äusser', 'draussen',
    'bloss', 'blöss', 'kloss', 'klöss', 'stoss', 'stöss', 'süss', 'gefäss',
    'mässig', 'gemäss', 'strauss', 'preuss', 'dreiss',
    'massnahm', 'massstab', 'massgeb', 'massgeschn', 'massvoll', 'massband',
    'masseinheit', 'masshalt', 'massanzug', 'massarbeit', 'ausmass', 'bussgeld',
  ],

  // Common words whose ss is correct in Germany too; skipped to save model calls.
  ssKeep: ('dass muss musst müsse müssen müsst müsste müssten lassen lässt lasst gelassen ' +
    'besser bessere besseren besserer wissen wisst gewiss wissenschaft wissenschaftlich ' +
    'wasser essen isst gegessen vergessen klasse klassen klassisch prozess prozesse ' +
    'interesse interessen interessant adresse adressen presse kasse kassen messe messen ' +
    'messer tasse tassen gasse gassen rasse schloss schlösser schlüssel schluss schlüsse ' +
    'fluss flüsse kuss küssen nuss nüsse genuss anschluss abschluss beschluss einfluss ' +
    'stress kongress boss pass pässe passen passt passiert fassen hassen kissen schüssel ' +
    'bisschen vermissen mission kommission session professor assistent russland ' +
    'fitness business express impressum password access fassade massiv massage ' +
    'ressourcen dossier possible class classic bass miss message cross').split(' '),

  // Cues for ss-words whose two spellings are both real words. "pro" picks the
  // ß spelling, "contra" keeps the Swiss one; without a hit the model decides.
  ssCues: {
    'busse,bussen': {
      pro: 'franken|chf|bezahl|zahlen|zahlt|verhängt|richter|polizei|strafe|verwarn|delikt|ordnungs|geschwindigkeit|tempo|zu schnell|parkier|falschpark|übertret|widerhandl|gericht',
      contra: 'fahren|fährt|haltestelle|fahrplan|linie|chauffeur|verkehrsbetrieb|postauto|bahnhof|umsteig|reisebus|abfahrt|fahrgast|passagier|streik|innenstadt|\\böv\\b',
    },
    'masse,massen': {
      pro: 'fenster|zimmer|raum|länge|breite|höhe|tiefe|messen|gemessen|zentimeter|millimeter|\\bmeter\\b|\\bcm\\b|\\bmm\\b|abmessung|zuschneiden|schrank|tisch|platte|koffer|gepäck|passt|passen|nahm|nehmen|schneider|möbel',
      contra: 'menschen|menge|leute|publikum|zuschauer|besucher|fans|konzert|stadion|demonstr|strömte|strömen|drängt|kilogramm|gewicht|teig|flüssig|molekül|atom|kritische|erdmasse|muskel|stand',
    },
  },

  // Words where capitalisation alone settles the spelling: the noun is
  // capitalised ("ein Ass im Ärmel", "auf dem Schoß"), the past tense is not
  // ("ich aß", "er schoss daneben").
  ssCase: {
    ass: { upper: 'Ass', lower: 'aß' },
    schoss: { upper: 'Schoß', lower: 'schoss' },
    floss: { upper: 'Floß', lower: 'floss' },
  },

  // ss-words where both spellings are real words, so the context decides.
  ssContext: ['masse', 'massen', 'floss', 'flosse', 'flossen', 'schoss', 'russe', 'russen'],

  hamburg: {
    nouns: [
      'Weggli/n/Weggli = Rundstück/n/Rundstücke',
      'Bürli/n/Bürli = Rundstück/n/Rundstücke',
      'Brötli/n/Brötli = Rundstück/n/Rundstücke',
      'Brötchen/n/Brötchen = Rundstück/n/Rundstücke',
      'Semmel/f/Semmeln = Rundstück/n/Rundstücke',
      'Rüebli/n/Rüebli = Wurzel/f/Wurzeln',
      'Nachtessen/n/- = Abendbrot/n/-',
      'Znacht/n/- = Abendbrot/n/-',
      'Abendessen/n/- = Abendbrot/n/-',
      'Guetzli/n/Guetzli = Keks/m/Kekse',
      'Guetsli/n/Guetsli = Keks/m/Kekse',
      'Bub/m/Buben = Jung/m/Jungs | sw gen=Jungs',
      'Meitli/n/Meitli = Deern/f/Deerns',
      'Mädchen/n/Mädchen = Deern/f/Deerns',
      'Metzger/m/Metzger = Schlachter/m/Schlachter',
      'Metzgerin/f/Metzgerinnen = Schlachterin/f/Schlachterinnen',
      'Metzgerei/f/Metzgereien = Schlachterei/f/Schlachtereien',
      'Schreiner/m/Schreiner = Tischler/m/Tischler',
      'Schreinerin/f/Schreinerinnen = Tischlerin/f/Tischlerinnen',
      'Schreinerei/f/Schreinereien = Tischlerei/f/Tischlereien',
      'Samstag/m/Samstage = Sonnabend/m/Sonnabende',
    ],
    words: [
      'samstags>sonnabends',
      'Salü,Sali,Hoi,Servus>Moin',
      'Tschau,Ciao,Adieu,Ade>Tschüss',
      'herzig*>putzig*', 'gluschtig*>lecker*',
      'Exgüsi>Tschuldigung',
      'geschwatzt,geschwätzt>geschnackt',
    ],
    phrases: [
      'Grüss Gott,Grüß Gott,Guten Tag,Guten Morgen>Moin',
      'Uf Wiederluege,Auf Wiedersehen>Tschüss',
    ],
    verbs: [
      ['schwatz', 'schnack', ''],
      ['schwätz', 'schnack', ''],
    ],
    compounds: [
      ['samstag', 'Sonnabend'], ['metzger', 'Schlachter'], ['schreiner', 'Tischler'],
      ['brötchen', 'Rundstück'], ['weggli', 'Rundstück'],
    ],
  },
};
