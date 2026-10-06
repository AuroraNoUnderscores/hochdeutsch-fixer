// Swiss Standard German -> German Standard German (with an optional Hamburg layer).
//
// nouns: "Swiss/gender/plural = German/gender/plural | flags"
//   gender m/f/n, or p for plural-only words. Plural "-" = uncountable,
//   commas separate alternative plurals. In the German part "Rot+ Bete" means
//   "Rot" declines like an adjective. Flags: s = also matches as the end of a
//   compound ("Elektrovelo"), sw/gw = weak masculine (den Buben / den Jungen),
//   gen=Form = irregular genitive, x=regex = compound exceptions, auf = German
//   says "auf" where Swiss says "in" ("im Estrich" -> "auf dem Dachboden"),
//   inv = the German plural takes no dative -n ("auf 20 Hektar").
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
    'Bouillon/f/Bouillons = Brühe/f/Brühen | s',
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
    'Estrich/m/Estriche = Dachboden/m/Dachböden | auf',
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
    'Mietzins/m/Mietzinse,Mietzinsen = Miete/f/Mieten | s',
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

    // Found by measurement (dev notes in README): words on many .ch pages and few
    // .de pages of the FineWeb-2 crawl, e.g. Medienmitteilung on 1135 of 164k .ch
    // pages and 89 of 1.96M .de pages, with a clear German Standard counterpart.
    // Behörden, Politik, Medien
    'Medienmitteilung/f/Medienmitteilungen = Pressemitteilung/f/Pressemitteilungen',
    'Medienkonferenz/f/Medienkonferenzen = Pressekonferenz/f/Pressekonferenzen',
    'Mediensprecher/m/Mediensprecher = Pressesprecher/m/Pressesprecher',
    'Mediensprecherin/f/Mediensprecherinnen = Pressesprecherin/f/Pressesprecherinnen',
    'Redaktor/m/Redaktoren = Redakteur/m/Redakteure | s',
    'Redaktorin/f/Redaktorinnen = Redakteurin/f/Redakteurinnen | s',
    'Gemeindepräsident/m/Gemeindepräsidenten = Bürgermeister/m/Bürgermeister | sw',
    'Gemeindepräsidentin/f/Gemeindepräsidentinnen = Bürgermeisterin/f/Bürgermeisterinnen',
    'Stadtpräsident/m/Stadtpräsidenten = Bürgermeister/m/Bürgermeister | sw',
    'Stadtpräsidentin/f/Stadtpräsidentinnen = Bürgermeisterin/f/Bürgermeisterinnen',
    'Gemeindeammann/m/Gemeindeammänner = Bürgermeister/m/Bürgermeister',
    'Initiant/m/Initianten = Initiator/m/Initiatoren | sw',
    'Initiantin/f/Initiantinnen = Initiatorin/f/Initiatorinnen',
    'Bewilligung/f/Bewilligungen = Genehmigung/f/Genehmigungen | s',
    'Einsprache/f/Einsprachen = Einspruch/m/Einsprüche | s',
    'Baugesuch/n/Baugesuche = Bauantrag/m/Bauanträge',
    'Gesuchsteller/m/Gesuchsteller = Antragsteller/m/Antragsteller',
    'Gesuchstellerin/f/Gesuchstellerinnen = Antragstellerin/f/Antragstellerinnen',
    'Stimmbeteiligung/f/- = Wahlbeteiligung/f/-',
    'Aktuar/m/Aktuare = Schriftführer/m/Schriftführer',
    'Aktuarin/f/Aktuarinnen = Schriftführerin/f/Schriftführerinnen',
    'Einwohnerkontrolle/f/Einwohnerkontrollen = Einwohnermeldeamt/n/Einwohnermeldeämter',
    'Steueramt/n/Steuerämter = Finanzamt/n/Finanzämter',
    'Identitätskarte/f/Identitätskarten = Personalausweis/m/Personalausweise',
    'Doppelbürger/m/Doppelbürger = Doppelstaatler/m/Doppelstaatler',
    'Doppelbürgerin/f/Doppelbürgerinnen = Doppelstaatlerin/f/Doppelstaatlerinnen',
    'Wegleitung/f/Wegleitungen = Leitfaden/m/Leitfäden',
    'Beschrieb/m/Beschriebe = Beschreibung/f/Beschreibungen | s',
    'Instandstellung/f/Instandstellungen = Instandsetzung/f/Instandsetzungen',
    'Bestandesaufnahme/f/Bestandesaufnahmen = Bestandsaufnahme/f/Bestandsaufnahmen',
    'Geldwäscherei/f/- = Geldwäsche/f/-',
    'Wertschrift/f/Wertschriften = Wertpapier/n/Wertpapiere',
    'Bruttoinlandprodukt/n/- = Bruttoinlandsprodukt/n/-',
    // Arbeit, Schule
    'Lehrperson/f/Lehrpersonen = Lehrkraft/f/Lehrkräfte | s',
    'Fachperson/f/Fachpersonen = Fachkraft/f/Fachkräfte | s',
    'Primarlehrer/m/Primarlehrer = Grundschullehrer/m/Grundschullehrer',
    'Primarlehrerin/f/Primarlehrerinnen = Grundschullehrerin/f/Grundschullehrerinnen',
    'Primarschüler/m/Primarschüler = Grundschüler/m/Grundschüler',
    'Primarschülerin/f/Primarschülerinnen = Grundschülerin/f/Grundschülerinnen',
    'Berufsbildner/m/Berufsbildner = Ausbilder/m/Ausbilder',
    'Berufsbildnerin/f/Berufsbildnerinnen = Ausbilderin/f/Ausbilderinnen',
    'Ausbildner/m/Ausbildner = Ausbilder/m/Ausbilder',
    'Ausbildnerin/f/Ausbildnerinnen = Ausbilderin/f/Ausbilderinnen',
    'Gesamtarbeitsvertrag/m/Gesamtarbeitsverträge = Tarifvertrag/m/Tarifverträge',
    'Pensionsalter/n/- = Rentenalter/n/-',
    'Schnupperlehre/f/Schnupperlehren = Schnupperpraktikum/n/Schnupperpraktika',
    'Schulzimmer/n/Schulzimmer = Klassenzimmer/n/Klassenzimmer',
    'Pausenplatz/m/Pausenplätze = Schulhof/m/Schulhöfe',
    'Schulreise/f/Schulreisen = Klassenfahrt/f/Klassenfahrten',
    'Wandtafel/f/Wandtafeln = Tafel/f/Tafeln',
    'Hellraumprojektor/m/Hellraumprojektoren = Overheadprojektor/m/Overheadprojektoren',
    'Doktorat/n/Doktorate = Promotion/f/Promotionen',
    'Absenz/f/Absenzen = Abwesenheit/f/Abwesenheiten',
    'Entlöhnung/f/Entlöhnungen = Entlohnung/f/Entlohnungen',
    'Stundenansatz/m/Stundenansätze = Stundensatz/m/Stundensätze',
    'Zustupf/m/Zustüpfe = Zuschuss/m/Zuschüsse',
    'Bauführer/m/Bauführer = Bauleiter/m/Bauleiter',
    'Werkhof/m/Werkhöfe = Bauhof/m/Bauhöfe',
    'Hauswart/m/Hauswarte = Hausmeister/m/Hausmeister',
    'Hauswartin/f/Hauswartinnen = Hausmeisterin/f/Hausmeisterinnen',
    'Pöstler/m/Pöstler = Briefträger/m/Briefträger',
    'Pöstlerin/f/Pöstlerinnen = Briefträgerin/f/Briefträgerinnen',
    'Detailhändler/m/Detailhändler = Einzelhändler/m/Einzelhändler',
    'Einzelfirma/f/Einzelfirmen = Einzelunternehmen/n/Einzelunternehmen',
    'Produktepalette/f/Produktepaletten = Produktpalette/f/Produktpaletten',
    'Reservation/f/Reservationen = Reservierung/f/Reservierungen',
    'Degustation/f/Degustationen = Verkostung/f/Verkostungen | s',
    'Konsumation/f/Konsumationen = Verzehr/m/-',
    'Renovation/f/Renovationen = Renovierung/f/Renovierungen | s',
    'Nomination/f/Nominationen = Nominierung/f/Nominierungen',
    'Limite/f/Limiten = Limit/n/Limits',
    // Verkehr, Wohnen
    'Autolenker/m/Autolenker = Autofahrer/m/Autofahrer',
    'Autolenkerin/f/Autolenkerinnen = Autofahrerin/f/Autofahrerinnen',
    'Lenkerin/f/Lenkerinnen = Fahrerin/f/Fahrerinnen',
    'Automobilist/m/Automobilisten = Autofahrer/m/Autofahrer | sw',
    'Automobilistin/f/Automobilistinnen = Autofahrerin/f/Autofahrerinnen',
    'Chauffeur/m/Chauffeure = Fahrer/m/Fahrer',
    'Chauffeuse/f/Chauffeusen = Fahrerin/f/Fahrerinnen',
    'Autocar/m/Autocars = Reisebus/m/Reisebusse | gen=Reisebusses',
    'Selbstunfall/m/Selbstunfälle = Alleinunfall/m/Alleinunfälle',
    'Motorfahrzeug/n/Motorfahrzeuge = Kraftfahrzeug/n/Kraftfahrzeuge',
    'Fussgängerstreifen/m/Fussgängerstreifen = Zebrastreifen/m/Zebrastreifen',
    'Parkfeld/n/Parkfelder = Parkplatz/m/Parkplätze',
    'Signalisation/f/Signalisationen = Beschilderung/f/Beschilderungen',
    'Geleise/n/Geleise = Gleis/n/Gleise',
    'Einstellhalle/f/Einstellhallen = Tiefgarage/f/Tiefgaragen',
    'Stockwerkeigentum/n/- = Wohnungseigentum/n/-',
    'Dachstock/m/Dachstöcke = Dachgeschoss/n/Dachgeschosse',
    'Bodenheizung/f/Bodenheizungen = Fußbodenheizung/f/Fußbodenheizungen',
    'Tumbler/m/Tumbler = Wäschetrockner/m/Wäschetrockner',
    'Chromstahl/m/- = Edelstahl/m/-',
    'Türfalle/f/Türfallen = Türklinke/f/Türklinken',
    'Tablar/n/Tablare = Regalbrett/n/Regalbretter',
    'Plättli/n/Plättli = Fliese/f/Fliesen',
    'Abfallsack/m/Abfallsäcke = Müllbeutel/m/Müllbeutel',
    'Güsel/m/- = Müll/m/-',
    'Zapfenzieher/m/Zapfenzieher = Korkenzieher/m/Korkenzieher',
    'Harass/m/Harasse = Getränkekiste/f/Getränkekisten',
    'Notfallstation/f/Notfallstationen = Notaufnahme/f/Notaufnahmen',
    'Sanität/f/- = Rettungsdienst/m/-',
    'Badi/f/Badis = Freibad/n/Freibäder',
    'Jugi/f/Jugis = Jugendherberge/f/Jugendherbergen',
    'Rebberg/m/Rebberge = Weinberg/m/Weinberge',
    'Hektare/f/Hektaren = Hektar/m/Hektar | inv',
    'Chilbi/f/Chilbis = Kirmes/f/Kirmessen',
    'Samichlaus/m/Samichläuse = Nikolaus/m/Nikoläuse',
    'Rangverkündigung/f/Rangverkündigungen = Siegerehrung/f/Siegerehrungen',
    'Final/m/Finals = Finale/n/Finale | s',
    'Cupfinal/m/Cupfinals = Pokalfinale/n/Pokalfinale',
    'Topskorer/m/Topskorer = Topscorer/m/Topscorer',
    'Barrage/f/Barragen = Relegation/f/Relegationen',
    'Büsi/n/Büsi = Katze/f/Katzen',
    // Essen
    'Anken/m/- = Butter/f/-',
    'Konfi/f/Konfis = Marmelade/f/Marmeladen',
    'Wähe/f/Wähen = Blechkuchen/m/Blechkuchen',
    'Plätzli/n/Plätzli = Schnitzel/n/Schnitzel',
    'Kabis/m/- = Weißkohl/m/-',
    'Spargel/m/Spargeln = Spargel/m/Spargel',
    'Zwischenverpflegung/f/Zwischenverpflegungen = Zwischenmahlzeit/f/Zwischenmahlzeiten',
    'Menu/n/Menus = Menü/n/Menüs',
    'Bratbutter/f/- = Butterschmalz/n/-',
    'Schwingbesen/m/Schwingbesen = Schneebesen/m/Schneebesen',
    'Grillade/f/Grilladen = Grillgericht/n/Grillgerichte',
    // Found on a web crawl like the words above: on .ch pages at least 25 times
    // as often, per page, as on .de pages (2026-10).
    'Neulenker/m/Neulenker = Fahranfänger/m/Fahranfänger',
    'Neulenkerin/f/Neulenkerinnen = Fahranfängerin/f/Fahranfängerinnen',
    'Fahrzeuglenker/m/Fahrzeuglenker = Fahrzeugführer/m/Fahrzeugführer',
    'Fahrzeuglenkerin/f/Fahrzeuglenkerinnen = Fahrzeugführerin/f/Fahrzeugführerinnen',
    'Töff/m/Töffs = Motorrad/n/Motorräder',
    'Personenwagen/m/Personenwagen = Pkw/m/Pkw',
    'Fahrzeugausweis/m/Fahrzeugausweise = Fahrzeugschein/m/Fahrzeugscheine',
    'Führerprüfung/f/Führerprüfungen = Führerscheinprüfung/f/Führerscheinprüfungen',
    'Auffahrkollision/f/Auffahrkollisionen = Auffahrunfall/m/Auffahrunfälle',
    'Rennvelo/n/Rennvelos = Rennrad/n/Rennräder',
    'Überbauung/f/Überbauungen = Bebauung/f/Bebauungen',
    'Wohnüberbauung/f/Wohnüberbauungen = Wohnanlage/f/Wohnanlagen',
    'Attikawohnung/f/Attikawohnungen = Penthousewohnung/f/Penthousewohnungen',
    'Autoeinstellhalle/f/Autoeinstellhallen = Tiefgarage/f/Tiefgaragen',
    'Plattenboden/m/Plattenböden = Fliesenboden/m/Fliesenböden',
    'Plattenleger/m/Plattenleger = Fliesenleger/m/Fliesenleger',
    'Dampfabzug/m/Dampfabzüge = Dunstabzug/m/Dunstabzüge',
    'Warenlift/m/Warenlifte = Lastenaufzug/m/Lastenaufzüge',
    'Personenlift/m/Personenlifte = Personenaufzug/m/Personenaufzüge',
    'Lamellenstore/m/Lamellenstoren = Lamellenjalousie/f/Lamellenjalousien',
    'Sonnenstore/m/Sonnenstoren = Markise/f/Markisen',
    'Blache/f/Blachen = Plane/f/Planen',
    'Kartonschachtel/f/Kartonschachteln = Pappkarton/m/Pappkartons',
    'Hauswartung/f/Hauswartungen = Hausmeisterdienst/m/Hausmeisterdienste',
    'Schulanlage/f/Schulanlagen = Schulgelände/n/Schulgelände',
    'Schulhaus/n/Schulhäuser = Schulgebäude/n/Schulgebäude | gen=Schulgebäudes',
    'Schulpflege/f/Schulpflegen = Schulbehörde/f/Schulbehörden',
    'Kanti/f/Kantis = Gymnasium/n/Gymnasien',
    'Berufsmatura/f/Berufsmaturen = Fachabitur/n/Fachabiture',
    'Berufsmaturität/f/Berufsmaturitäten = Fachhochschulreife/f/Fachhochschulreifen',
    'Frühlingsferien/p/Frühlingsferien = Frühjahrsferien/p/Frühjahrsferien',
    'Kursgeld/n/Kursgelder = Kursgebühr/f/Kursgebühren',
    'Altersjahr/n/Altersjahre = Lebensjahr/n/Lebensjahre',
    'Berufsleute/p/Berufsleute = Fachkräfte/p/Fachkräfte',
    'Ansprechsperson/f/Ansprechspersonen = Ansprechperson/f/Ansprechpersonen',
    'Stelleninserat/n/Stelleninserate = Stellenanzeige/f/Stellenanzeigen',
    'Spontanbewerbung/f/Spontanbewerbungen = Initiativbewerbung/f/Initiativbewerbungen',
    'Arztzeugnis/n/Arztzeugnisse = Attest/n/Atteste',
    'Strafregisterauszug/m/Strafregisterauszüge = Führungszeugnis/n/Führungszeugnisse | gen=Führungszeugnisses',
    'Lohnausweis/m/Lohnausweise = Lohnsteuerbescheinigung/f/Lohnsteuerbescheinigungen',
    'Bezüger/m/Bezüger = Bezieher/m/Bezieher | s',
    'Bezügerin/f/Bezügerinnen = Bezieherin/f/Bezieherinnen | s',
    'Detaillist/m/Detaillisten = Einzelhändler/m/Einzelhändler | sw',
    'Taggeld/n/Taggelder = Tagegeld/n/Tagegelder | s',
    'Mitgliederbeitrag/m/Mitgliederbeiträge = Mitgliedsbeitrag/m/Mitgliedsbeiträge',
    'Kostengutsprache/f/Kostengutsprachen = Kostenzusage/f/Kostenzusagen',
    'Kostendach/n/Kostendächer = Kostenobergrenze/f/Kostenobergrenzen',
    'Auslegeordnung/f/Auslegeordnungen = Bestandsaufnahme/f/Bestandsaufnahmen',
    'Datenbearbeitung/f/Datenbearbeitungen = Datenverarbeitung/f/Datenverarbeitungen',
    'Suchresultat/n/Suchresultate = Suchergebnis/n/Suchergebnisse | gen=Suchergebnisses',
    'Gemeindekanzlei/f/Gemeindekanzleien = Gemeindeverwaltung/f/Gemeindeverwaltungen',
    'Doppelspurigkeit/f/Doppelspurigkeiten = Überschneidung/f/Überschneidungen',
    'Logiernacht/f/Logiernächte = Übernachtung/f/Übernachtungen',
    'Sistierung/f/Sistierungen = Aussetzung/f/Aussetzungen',
    'Ausschaffung/f/Ausschaffungen = Abschiebung/f/Abschiebungen | s',
    'Lancierung/f/Lancierungen = Start/m/Starts',
    'Kontaktnahme/f/Kontaktnahmen = Kontaktaufnahme/f/Kontaktaufnahmen',
    'Einbezug/m/- = Einbeziehung/f/-',
    'Miteinbezug/m/- = Einbeziehung/f/-',
    'Entscheidfindung/f/Entscheidfindungen = Entscheidungsfindung/f/Entscheidungsfindungen',
    'Vorkehr/f/Vorkehren = Vorkehrung/f/Vorkehrungen',
    'Vorweisung/f/Vorweisungen = Vorlage/f/Vorlagen',
    'Besammlung/f/Besammlungen = Treffpunkt/m/Treffpunkte',
    'Rangierung/f/Rangierungen = Platzierung/f/Platzierungen',
    'Annullation/f/Annullationen = Stornierung/f/Stornierungen',
    'Talon/m/Talons = Abschnitt/m/Abschnitte | s',
    'Equipe/f/Equipen = Mannschaft/f/Mannschaften',
    'Übername/m/Übernamen = Spitzname/m/Spitznamen | sw gw gen=Spitznamens',
    'Festwirtschaft/f/Festwirtschaften = Festbewirtung/f/Festbewirtungen',
    'Gehdistanz/f/Gehdistanzen = Laufweite/f/Laufweiten',
    'Trouvaille/f/Trouvaillen = Fundstück/n/Fundstücke',
    'Bijouterie/f/Bijouterien = Juweliergeschäft/n/Juweliergeschäfte',
    'Handorgel/f/Handorgeln = Akkordeon/n/Akkordeons',
    'Fünfliber/m/Fünfliber = Fünffrankenstück/n/Fünffrankenstücke',
    'Nuggi/m/Nuggis = Schnuller/m/Schnuller',
    'Pedicure/f/- = Pediküre/f/-',
    'Manicure/f/- = Maniküre/f/-',
    'Eindunkeln/n/- = Dunkelwerden/n/-',
    'Fahrspesen/p/Fahrspesen = Fahrtkosten/p/Fahrtkosten',
    'Auslandaufenthalt/m/Auslandaufenthalte = Auslandsaufenthalt/m/Auslandsaufenthalte',
    'Reglement/n/Reglemente = Reglement/n/Reglements',
    'Abonnement/n/Abonnemente = Abonnement/n/Abonnements',
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
    'Grüezi>Guten Tag', 'Salü,Sali,Hoi>Hallo', 'Merci>Danke', 'vielmal>vielmals',
    'Exgüsi>Entschuldigung', 'Grüessech>Guten Tag',
    // the imperative ("Grüss deine Familie"); the greetings are phrases
    'Grüss>Grüße',
    // found by measurement, like the nouns marked so above
    'resp>bzw', 'respektive>beziehungsweise',
    'eindrücklich*>beeindruckend*', 'unlimitiert*>unbegrenzt*', 'hochstehend*>hochwertig*',
    'hängig*>anhängig*', 'rollstuhlgängig*>rollstuhlgerecht*', 'urchig*>urig*',
    'gesamthaft>insgesamt', 'abwechslungsweise>abwechselnd', 'inskünftig>künftig',
    'weitherum>weithin', 'gleichentags>am selben Tag', 'Saudiarabien>Saudi-Arabien',
    'benützen,benützt,benützte,benützten,benütze,benützend,benützbar,benützbare,benützbaren>benutzen,benutzt,benutzte,benutzten,benutze,benutzend,benutzbar,benutzbare,benutzbaren',
    'Benützung,Benützer,Benützerin,Benützern>Benutzung,Benutzer,Benutzerin,Benutzern',
    'verunmöglichen,verunmöglicht,verunmöglichte,verunmöglichten>verhindern,verhindert,verhinderte,verhinderten',
    'aufschalten,aufgeschaltet,aufzuschalten>freischalten,freigeschaltet,freizuschalten',
    'beiziehen,beigezogen,beizuziehen>hinzuziehen,hinzugezogen,hinzuzuziehen',
    'amtet,amten,amtete,amteten,geamtet>amtiert,amtieren,amtierte,amtierten,amtiert',
    'degustieren,degustiert,degustierte,degustierten>verkosten,verkostet,verkostete,verkosteten',
    'schlitteln,schlittelt,geschlittelt>rodeln,rodelt,gerodelt',
    'lismen,lismet,gelismet>stricken,strickt,gestrickt',
    'andämpfen,angedämpft>andünsten,angedünstet',
    'aufgegleist>auf den Weg gebracht',
    'kotiert*>notiert*', 'börsenkotiert*>börsennotiert*',
    'zweitletzt*>vorletzt*', 'bezugsbereit*>bezugsfertig*', 'pendent*>offen*', 'fixfertig*>fertig*',
    'zuhanden>zu Händen', 'vorbehältlich>vorbehaltlich', 'raschmöglichst>schnellstmöglich',
    'dannzumal>dann', 'portionenweise>portionsweise', 'Konti>Konten',
    'Velofahrende,Velofahrenden>Radfahrende,Radfahrenden',
    'präsidiert,präsidieren,präsidierte,präsidierten,präsidiere>leitet,leiten,leitete,leiteten,leite',
    'entlöhnt,entlöhnen,entlöhnte,entlöhnten>entlohnt,entlohnen,entlohnte,entlohnten',
    'gespiesen>gespeist', 'angetönt>angedeutet',
    'ausgeschafft,auszuschaffen>abgeschoben,abzuschieben',
    'aufgleisen,aufzugleisen>auf den Weg bringen,auf den Weg zu bringen',
  ],

  // Words that mean something else after a form of "sein": "Es pressiert" is
  // "Es eilt", but "Ich bin pressiert" is "Ich bin in Eile".
  predicative: { pressiert: 'in Eile' },

  phrases: [
    'Grüezi mitenand,Grüezi miteinand,Grüezi mitenander>Hallo zusammen',
    'Grüss Gott>Grüß Gott', 'Grüss dich>Grüß dich', 'Grüss euch>Grüß euch', 'Grüss Sie>Grüß Sie',
    'Uf Wiederluege>Auf Wiedersehen', 'En Guete,en Guete>Guten Appetit',
    'per sofort>ab sofort', 'bis anhin>bisher',
    'per Ende Jahr,auf Ende Jahr>zum Jahresende', 'per Ende Monat,auf Ende Monat>zum Monatsende',
    'Ende Jahr>Ende des Jahres', 'Anfang Jahr>Anfang des Jahres', 'Mitte Jahr>Mitte des Jahres',
    'Ende Monat>Ende des Monats', 'Anfang Monat>Anfang des Monats', 'Mitte Monat>Mitte des Monats',
    'Ende Woche>Ende der Woche', 'Anfang Woche>Anfang der Woche', 'Mitte Woche>Mitte der Woche',
  ],

  verbs: [
    ['parkier', 'park', 'ge'],
    ['grillier', 'grill', 'ge'],
    ['campier', 'camp', 'ge'],
    ['verunfall', 'verunglück', ''],
  ],

  compounds: [
    ['velo', 'Fahrrad', '^velo(urs|ci|drom|ce|mobil)|^veloz'],
    ['poulet', 'Hähnchen'], ['glace', 'Eis'], ['natel', 'Handy'],
    ['billett', 'Fahrkarten'], ['pneu', 'Reifen', '^pneum'], ['coiffeur', 'Friseur'],
    ['trottoir', 'Bürgersteig'], ['camion', 'Lastwagen'], ['kehricht', 'Müll'],
    ['perron', 'Bahnsteig'], ['rüebli', 'Karotten'], ['crevetten', 'Garnelen'],
    ['lichtsignal', 'Ampel'], ['abwart', 'Hausmeister'], ['matura', 'Abitur', '^maturand'],
    ['maturitäts', 'Abitur'], ['primarschul', 'Grundschul'], ['schoggi', 'Schokoladen'],
    ['spital', 'Krankenhaus', '^spital(er|ern)$'],
    ['tram', 'Straßenbahn', '^tram(p|ad|in|on|ez|bahn)'], ['zügel', 'Umzugs', '^zügel(los|ung)|^zügel(test|tet|ten|st|te)$'],
    ['rahm', 'Sahne', '^rahm(en|ung)'], ['einstellhallen', 'Tiefgaragen'], ['renovations', 'Renovierungs'],
    ['reservations', 'Reservierungs'], ['bewilligungs', 'Genehmigungs'], ['pikett', 'Bereitschafts'],
    ['primarlehr', 'Grundschullehr'], ['medienmitteilungs', 'Pressemitteilungs'],
    ['offert', 'Angebots', '^offerte'], ['annullations', 'Stornierungs'], ['töff', 'Motorrad'],
    ['rinds', 'Rinder', '^rindsleder'],
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
    // Nouns German also uses with another sense (german_too.js). Here "pro"
    // settles the Swiss sense, "contra" the German one; without a hit, the
    // general model may keep the original where it reads clearly better.
    'estrich,estriche,estrichs': {
      pro: 'keller|dachboden|dachstock|dachschräg|estrichabteil|estrichtreppe|estrichleiter|stauraum|abstellraum|verstau|kisten|kartons|flohmarkt|brocki|entrümpel|mansarde|schopf',
      contra: 'estrichleger|zementestrich|anhydrit|fliessestrich|fließestrich|trockenestrich|fussbodenheizung|fußbodenheizung|trittschall|dämmung|fliesen|parkett|bodenbelag|beton|schleif|giess|gieß|gegossen|risse|trockn|verleg|untergrund|belegreif|restfeuchte|nivellier|mörtel|kleber|baustoff',
    },
    kübel: {
      pro: 'abfall|kehricht|putzkübel|putzmittel|müll|grünabfuhr|kompost|notdurft|güsel',
      contra: 'pflanz|topf|töpfe|garten|balkon|terrasse|erde|substrat|blumen|kräuter|gewächs|hochbeet|blüh|wurzel',
    },
    // On .ch pages "Store" was a shop 6 times in 7 (App Store, Music Store):
    // it only becomes a blind when its sentence says so.
    store: {
      pro: 'storen|lamellen|sonnenschutz|rollladen|rolladen|rollo|markise|fenster|kurbel|beschattung|herunterlassen|runterlassen|jalousie',
      contra: '.',
    },
    'pult,pulte,pults,pultes': {
      pro: 'büro|schreibtisch|höhenverstellbar|arbeitsplatz|computer|bildschirm|monitor|laptop|hausaufgabe|schüler|schulzimmer|ikea|bürostuhl',
      contra: '\\bdj\\b|dj-|misch|orchester|dirig|redner|noten|moderator|konsole|kanäle|regie|tontechnik|lautsprecher|kanzel|infopult|informationspult',
    },
    peperoni: {
      contra: 'scharf|chili|peperoncini|pfefferschote|pizza|eingelegt|jalape|habanero',
    },
  },

  // Text that talks *about* words must be left alone: rewriting the examples in
  // "Sowohl Mass (1) wie auch Masse (2) werden in der Mehrzahl zu Massen"
  // destroys the sentence, and no language model can tell, because both
  // spellings read perfectly naturally. One strong cue, or two weak ones,
  // switch the extension off for that page or block.
  meta: {
    // Matched from the start of a word, so "Etymologie" and "etymologisch" count.
    // ("scharfes s" must end there, or "scharfes Sehen" on an optician's page counts.)
    strong: 'rechtschreibung|schreibweise|orthografi|orthographi|eszett|scharfes s(?!\\p{L})|ss oder ß|ß oder ss|duden|grammatik|deutsch als fremdsprache|sprachblog|helvetism|sprachgebrauch|wortherkunft|etymologi',
    // Whole words only, and unmistakably about language: one flags its sentence.
    // (As plain substrings "Silbe" fired on "Silbernes".)
    sentence: 'das wort|die wörter|dem wort|der begriff|den begriff|dem begriff|mehrzahl|mehrzahlform|einzahl|plural|pluralform|singular|buchstaben?|silben?|aussprache|schreibt man|sagt man|nennt man|gleich lautende?n?|doppeldeutig(?:e|en|er|keit)?|gesprochenen? sprache',
    // Whole words, but common in ordinary prose ("die lokale Bedeutung", "im
    // Bericht heißt es"): they only count towards flagging a whole page or block.
    weak: 'bedeutet|bedeutung|bedeutungen|ausdruck|übersetzt|wörtlich|heisst es|heißt es|dialekt|dialekte|mundart|hochdeutsch|hochdeutschen|standarddeutsch',
  },

  // Swiss grammar, not vocabulary.
  syntax: {
    // Perfect with "sein" for verbs of position: süddt./CH "ich bin gesessen",
    // standard German "ich habe gesessen".
    sein2haben: {
      participles: ['gesessen', 'gestanden', 'gelegen'],
      // "Das Hotel ist ruhig gelegen" is German too: the model decides these.
      alsoAdjective: ['gelegen'],
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
  // The rules' answer for ß words the stem list misses. Only a fallback: with the
  // model on, it decides these too ("Mass Effect" is a game, "Assen" a name).
  ssWords: {
    sass: 'saß', sassen: 'saßen', besass: 'besaß', besassen: 'besaßen', vergass: 'vergaß',
    vergassen: 'vergaßen', frass: 'fraß', frassen: 'fraßen', assen: 'aßen', mass: 'maß', Mass: 'Maß',
  },

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
      'Grüezi,Salü,Sali,Hoi,Servus>Moin',
      'Tschau,Ciao,Adieu,Ade>Tschüss',
      'herzig*>putzig*', 'gluschtig*>lecker*',
      'Exgüsi>Tschuldigung',
      'geschwatzt,geschwätzt>geschnackt',
    ],
    phrases: [
      'Grüss Gott,Grüß Gott,Grüss dich,Grüß dich,Grüss euch,Grüß euch,Guten Tag,Guten Morgen>Moin',
      'Grüezi mitenand,Grüezi miteinand,Grüezi mitenander>Moin zusammen',
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
