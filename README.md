# Hochdeutsch-Fixer

A Firefox extension that rewrites Swiss Standard German on web pages into German
Standard German — optionally with a Hamburg accent. Rules do the work; a small
German language model running on your own machine settles the calls rules can't make.

## Install

Open the `.xpi` of the newest [release](https://github.com/AuroraNoUnderscores/hochdeutsch-fixer/releases)
in Firefox. Later versions arrive by themselves: Firefox checks `updates.json`
(the `update_url` in `manifest.json`) about once a day.

Every push to `main` with a new version in `manifest.json` releases it
(`.github/workflows/release.yml`): Mozilla signs it as unlisted, so it is not
in the store, with the API keys in the repository secrets `AMO_JWT_ISSUER` and
`AMO_JWT_SECRET`; the signed `.xpi` becomes a GitHub Release, and `updates.json`
is pointed at it.

For working on it: `about:debugging` → This Firefox → Load Temporary Add-on… →
pick `manifest.json`. Temporary add-ons disappear when Firefox restarts.

## How it works

Two passes over every text node:

1. **Rules** (`dictionary.js`, `morph.js`, `engine.js`) run instantly: vocabulary,
   grammar, article agreement, and a first guess at every ss/ß. The page always
   reads sensibly before any model has spoken.
2. **Two small models** (`llm.js`, hosted by `background.js`), both German
   DistilBERT running locally on WASM, no GPU needed:
   - **eszett** — fine-tuned for this extension to decide, for every "ss", whether
     German spells it ß, and which words are part of a name. Bundled in
     `models/hdfx-eszett` (64 MB). It reads each text once and answers both for
     all of it. How it was trained is in [training/](training/README.md).
   - **general** — the untouched base model, downloaded once (~92 MB), which only
     ranks the few remaining candidates: article forms and grammar wording.

Neither model writes text: they choose among spellings and candidates the rules
produced.

### Why a trained model decides ss/ß, not rules

On sentences from articles nobody tuned anything on, hand-written ss/ß rules got
28.8 of every 1000 decisions wrong. The eszett model is trained on 23 million
sentences whose correct spelling came for free (turn every ß into ss, and the
original is the answer): German Wikipedia plus everyday German from the web,
cleaned of Swiss and misspelt pages. On held-out web text it gets 3.67 of 1000
wrong, including the collisions a list cannot settle: *die Masse strömte* vs *die
Maße des Fensters*, *ein Ass* vs *ich aß*, *keine Busse fahren* vs *eine Buße
zahlen*. Wikipedia alone was not enough: an encyclopedia hardly ever takes the
measurements of a window.

It is also trained on German sentences inside real Swiss paragraphs, so a
Swiss-sounding page ("Das Kantonsspital Winterthur ...") does not make it keep
"Grosse Teile", and on fines as Swiss text writes them ("muss eine Busse von 40
Franken bezahlen"), which German text hardly ever does.

The rules' answer only stands where the model is unsure (probability between 0.4
and 0.6), and a topic cue only outranks it for a spelling the model barely saw in
training (`coverage.js`: plural "Bußen" occurred 3 times). On unseen text the
cues are otherwise less reliable than the model.

### Names are left alone

"Herr Weiss" is not "Herr Weiß", the "Heiligen-Geist-Spital" is no
"Heiligen-Geist-Krankenhaus", and "Lucie Poulet" keeps her surname. The eszett
model also marks names (people, organisations, places, titles), trained on
GermEval 2014 and on web sentences with Swiss words swapped in, so that "im Spital"
still becomes "im Krankenhaus" while "Kinderspital Zürich" stays. Any word the
rules changed goes back when the model says it is part of a name, and so does a
pronoun that only changed because of it. For ss/ß only people keep their
spelling: places, organisations and titles take ß like any word ("Bahnhofstraße",
"in Straßburg"). Keeping organisations and titles too measured 6.45 instead of
4.72 errors per 1000 on held-out web text, since German writes "Universitätsklinik
Gießen" and "Stiftung Preußischer Kulturbesitz". The price: a company named after
someone ("Weiss AG") becomes "Weiß AG".

### Words that are German too

Some Swiss words are also ordinary German with another meaning: "am Rande" is not
beetroot, a "Store" is often a shop, "Entscheide dich" is a verb. Which dictionary
words those are was measured on a web crawl (`german_too.js`: about as common on
.de pages as on .ch pages). For them, and for a bare noun opening a sentence where
German puts verbs, the original stays a candidate and the general model keeps it
when it reads clearly better.

That works where the two readings *sound* different ("am Rande der Stadt"), but
not where only the meaning differs: on 124 hand-labelled sentences
(`training/data/german_too_labels.json`) the model's margins did not separate
Estrich the attic from Estrich the screed, a Pult as desk from one as mixing
desk, or Peperoni the bell pepper from Peperoni the chili. For those words topic
cues decide (`cues` in `dictionary.js`: "Risse", "Beton" → screed; "Keller",
"Stauraum" → attic), which took them from 44 to 49 of 61 right on .ch sentences.
"Store" is a shop on .ch pages 6 times in 7 (App Store, Music Store), so it only
becomes a blind when its sentence says so; "Parking" was never the Swiss
"Parkhaus" in the sample (brands and English), so it is no longer in the dictionary.

### Text already in German spelling is German

Swiss spelling has no ß. A page whose text uses ß where the rules would expect it
(at least three, and more than three times as many as Swiss ss spellings), or a
block with two or more, was written in Germany or Austria: its ss are the
writer's own choice, so the eszett model is not asked, and a word German also
uses ("Estrich", "Kübel", "Peperoni") keeps its German meaning. Everything else,
including the Hamburg flavour, still applies. The check reads the page as the site
wrote it, never the ß this extension wrote into it.

### Text about words is left alone

A page explaining that "Mass (1) und Masse (2) werden in der Mehrzahl zu Massen"
must keep its examples, and so must "in der Schweiz sagt man Velo". No model can
catch this — both spellings read perfectly naturally — so it is detected instead,
at three levels, each reverting anything already changed:

- **Page**: a strong cue (Rechtschreibung, Eszett, Duden, Grammatik, Helvetismus …)
  with any other cue beside it, or three clear cues (das Wort, Mehrzahl, sagt man …),
  in the title and text switch the extension off for the page. The popup then
  says so. Common words like "bedeutet" and "Bedeutung" count only beside a clear
  cue: on their own they switched off 1.7% of ordinary .ch pages (news, shops,
  blogs); now 0.17%, mostly grammar tests and language schools.
- **Block**: a strong cue, two clear cues, or one with a weak cue beside it.
- **Sentence**: one cue (das Wort, Mehrzahl, sagt man, Aussprache …) suppresses
  that sentence only, so a single explaining line in an ordinary article is safe.
- **Word**: a word in quotes («Velo»), or inside `em`/`i`/`q`/`cite`/`dfn` with
  at most three words, is being named rather than used. A word is also left alone
  when the other spelling appears nearby, since the text is comparing them.

### What the general model is for

It ranks candidates by how natural they sound, and may only overrule a rule when
clearly better, by a margin in nats that depends on what is at stake (`CONF` in
`engine.js`): word choice 2.0, forms 0.5, grammar wording 0. Below that the rule's
default stands. Two grammar choices have measured margins of their own:
existential "es hat" → "es gibt" needs 5 (true existentials scored 5.7 and more,
"Das Kind ist müde. Es hat Hunger." mostly under 5 once the sentence before is in
view), and "ist … gelegen" → "hat … gelegen" needs 1 ("Das Hotel ist ruhig
gelegen" is German and scored up to 0.9). The popup lists recent decisions with
their margins, and "Baby LLM" off turns both models off (rules only). If the
general model cannot download, the bundled eszett model still decides ss/ß and
names.

### Swiss grammar, not just words

Some Helvetisms are constructions rather than vocabulary:

| Swiss | German | how |
| --- | --- | --- |
| Es hat noch Tische frei | Es gibt noch freie Tische | rules rewrite, model picks the wording |
| Der Kollege, wo mir hilft | Der Kollege, der mir hilft | gender from the article, model picks the case |
| Ich bin gesessen / Er ist gestanden | Ich habe gesessen / Er hat gestanden | rules: position verbs take haben |

"es hat" only becomes "es gibt" where *es* is the subject ("es hat", "hat es …?",
"Im Kühlschrank hat es …") and the clause holds no participle, so "Es hat
geregnet", "Sie hat es eilig" and "Er hat es mir gegeben" are left alone; the
model then decides, with the sentence before in view, whether *es* is a thing
("Das Haus ist alt. Es hat einen Garten."). "gelegen" is also an adjective, so
"Das Hotel ist ruhig gelegen" and "Mir ist viel daran gelegen" stay. Relative
"wo" after a place or a time ("die Stadt, wo ich wohne") is ordinary German and
stays; the last part of a compound decides ("Wohnort" is a place, "Tagesmutter"
is not).

Also rewritten: prices with a decimal point ("CHF 12.50" → "CHF 12,50"), and a
preposition before a changed article where German contracts it ("in der Offerte"
→ "im Angebot"), unless the writer chose not to ("zu der Beiz" stays apart).

### What each side decides

| Decision | Who | Why |
| --- | --- | --- |
| Vocabulary, compounds, numbers, known ß stems | rules | unambiguous |
| Articles, adjective endings, case and number after a gender change | rules, model picks when the case is ambiguous ("ein Keks" vs "einen Keks") | |
| every ss/ß | eszett model, rules where it is unsure | measured 5× fewer errors than rules on unseen text |
| Is a changed word part of a name? | eszett model | a name is a fact about the text, not the word |
| Dictionary words that are also German (Rande, Store, Estrich) | topic cues, else the general model may keep the original; kept outright in text written in German spelling | measured on a crawl which words these are, and that the model cannot tell their senses apart |
| Words that are also German with another meaning (Busse, Finken, tönen) | cue words in the surrounding block, else the model | the model only judges how a sentence sounds and cannot know a page is about speeding fines |
| "zügeln" → "umziehen", incl. moving the particle to the clause end | model | word order |
| parkiert → parkt / geparkt | rules | the model scores "Er geparkt das Auto" higher, so it is not asked |
| Pronouns after a gender change ("Er war knapp" → "Sie war knapp") | rules | German pronouns agree with their antecedent; the model has no idea. Never in the noun's own clause ("Wegen dem Entscheid ärgert er sich" is a person), never the polite "Sie" |

## PDFs

PDFs are converted too, in the browser's own PDF viewer, and that viewer looks
and behaves exactly as before: same address, same toolbar, same zoom, find,
print, save and thumbnails. With nothing to convert (an English PDF), a
screenshot of the extension's viewer is identical to the built-in one, pixel for
pixel, and so is every computed style of its toolbar (`tools/pdf_check.py`).

How, since no extension can reach the built-in viewer:

1. **The same viewer, served by the extension.** `tools/sync_pdfjs.py` copies the
   browser's own viewer (pdf.js, its styles, its strings in every language) out
   of the installed browser into `pdfjs/`, so it is the same version, and settles
   what only the browser's own pages may use (`-moz-pref()` conditions, platform
   styles) from the browser's default settings. Rerun it after a browser update,
   or the viewer lags behind the browser's until then.
2. **At the PDF's own address.** `pdfnet.js` answers a PDF response (tabs,
   frames, `<embed>`, `<object>`) with that viewer as a page instead, keeps the
   PDF's bytes and streams them to it as they arrive, the way the browser does,
   so the first page appears before a large file has finished downloading.
3. **What the browser does for its viewer** (preferences, the PDF's bytes,
   saving, its strings) is done by `pdfview.js`, answering the viewer's requests
   the way the browser would, with the browser's default `pdfjs.*` settings.
4. **The text.** `pdfview.js` joins each page's lines into paragraphs (a word
   hyphenated at a line end is one word), converts them like any page, model
   included, and maps the changes back onto the fragments pdf.js draws. Three
   small hooks in pdf.js (`pdfpage.mjs`) then draw the new words with the
   document's own glyphs, give them to the text layer for selecting, copying and
   finding, and do the same when printing.

A changed word is drawn in the document's own font. A letter the document's
font does not contain (a Swiss document never contains ß) comes from the
installed font of the same family and weight (Arial Bold for "Arial-BoldMT"),
otherwise from the generic family pdf.js names for that font.

Words of other lengths would leave lines squeezed or gappy, so a changed
paragraph is typeset again: its words are broken into its lines anew, each as
wide as before, justified lines stay justified, ragged ones may run to the
column's edge, and a paragraph that grew takes another line below it when the
space there is free. Paragraphs mixing fonts (a bold word inside) or with
centred or indented lines keep their lines: a longer word there may use the free
space at the end of its line, then narrows the word gaps, and only then is
squeezed. A line set anew reaches the text layer (selecting, copying, finding,
the highlights) word by word, each word where the line's setting put it, so
what is selected is what is shown, gaps of a justified line included.

The browser's find bar searches the converted text, also on pages pdf.js has not
drawn yet (each gets its text in an invisible layer, which hands a match over to
pdf.js's own when the page is drawn). A page that only pretends to be the viewer
gets nothing: the viewer page carries a token, and the background answers only
pages it actually served for a PDF at that address.

Measured on real documents (federal guidelines, cantonal forms, an ETH safety
manual of 132 pages): first page on screen after 0.45 s instead of 0.30 s, the
difference being the conversion.

### PDFs on this computer

Firefox shows a `file://` PDF in its own viewer, which no extension may enter,
and it lets no extension read a file by itself (not even with "Access local
files on your computer" switched on: that lets content scripts into `file://`
pages, and Firefox's PDF viewer is not one of them). So a tab
opening a PDF from your computer goes to the extension's page for it
(`pdflocal.html`), which names the file: one click on **Open …pdf** and
choosing it, or dropping the file on the page, and it opens in the same viewer
as any PDF, converted. Its `#page=` is
kept. *Show it unconverted* (or Back) shows the PDF in Firefox's viewer as
before; switching **PDFs too** off leaves local PDFs to Firefox altogether.
Reloading the page or changing a setting reopens the same file without asking
again.

**Without the asking:** a small helper on your computer can read the file for
the extension, and then a PDF from disk opens converted at once, like any
other. Click *Open PDFs from this computer without this step* on that page
(Firefox asks to let the extension "exchange messages with programs other than
Firefox"), then run the installer from [`native/`](native/) once:
**install.bat** on Windows, **install.sh** on Linux and macOS. It installs for
your user only, no admin or root needed, and **uninstall** takes it away again.

- **What it is:** a script of a few dozen lines (`hdfx_file.sh`; on Windows
  `hdfx_file.cs`, which the installer builds into a small `.exe` with the C#
  compiler every Windows has, or `hdfx_file.ps1` where that fails, or where
  Windows refuses an `.exe` it does not know: Smart App Control, or an
  organisation's Application Control policy; that one takes about half a
  second per PDF). The installer tries each as Firefox will start it, keeps
  the first that reads a test PDF, and says so.
- **What it costs:** nothing while you are not opening a local PDF. Firefox
  starts it for that one file; it reads it, hands it over and exits. Nothing
  keeps running, and it takes a few kilobytes on disk.
- **What it may do:** only this extension can start it, and it reads only a
  file whose name ends in `.pdf` and that starts like a PDF, the one the tab
  was opening. Without it, or without the permission, the page asks as before.
- **Sandboxed Firefox** (Flatpak, and some Snap builds) may not be allowed to
  start programs outside the sandbox; there the page keeps asking.

### Formulas, list labels and missing letters

A changed word is found among the glyphs pdf.js draws by the page's text with
its spaces removed. Letters from formulas (𝑆, 𝛼, 𝐺 in LaTeX documents) are
two UTF-16 units each and are compared after normalising them to S, α, G; a
short piece drawn on its own ("(b)", "|", a subscript) is only matched just
ahead of the last one, never far down the page, where the same characters
recur. A reflowed line that pdf.js reports as one piece but the PDF draws in
several (a list label "(a)" and its text) keeps the pieces that read as before
and sets the rest of the line in the piece after them.

Letters a subset font does not contain come from the installed font closest to
it; LaTeX's TeX Gyre and URW fonts are matched to their originals (Pagella to
Palatino, Termes to Times, Heros to Helvetica/Arial, Latin Modern).

## Settings (toolbar popup)

- **Enabled**, and a per-site switch. Turning it off restores the page without a reload.
- **Flavour**: *Hamburg* (default — Rundstück, Sonnabend, Schlachter, Tischler,
  Abendbrot, Deern, Jung, schnacken, Moin, Tschüss) or *Neutral* (plain German
  Standard German: "Grüezi" is "Guten Tag", "Grüezi mitenand" "Hallo zusammen").
- **Baby LLM**: off = rules only, no download, no model.
- **Highlight changes on page**: every changed word is tinted, and words the model
  kept because they are part of a name get a dotted blue underline. Uses CSS
  highlights, so the page's markup is not touched. Point at a highlighted word
  to see what the site wrote and why it changed: a Swiss word, Swiss ss/ß
  spelling, the Hamburg flavour (with what Neutral would say), or the model's
  pick and what it picked over; a kept name says what kind of name the model
  took it for. The card sits in a closed shadow root and takes no pointer
  events; Escape or scrolling hides it, a tap shows it on touch screens.
  In a PDF the changed words are tinted too (in the text layer pdf.js lays over
  the drawn page, so it shows on screen, not in print), and pointing at one
  shows the same card: what the PDF says there and why it changed. The name
  underline is for web pages only.
- **Show changed words**: the list of every change in the tab, all frames
  included ("Velo → Fahrrad ×4"), and the words kept as names.
- **PDFs too**: off leaves PDFs to the browser's viewer, unconverted.

## Adding words

Edit `dictionary.js`, then hit Reload in `about:debugging`.

- Nouns: `'Swiss/gender/plural = German/gender/plural | flags'`. Gender `m/f/n`,
  or `p` for plural-only; plural `-` means uncountable. Flags: `s` (also matches
  at the end of a compound), `sw`/`gw` (weak masculine), `gen=Form`, `x=regex`
  (compound exceptions), `auf` (German says "auf" where Swiss says "in": "im
  Estrich" → "auf dem Dachboden"), `inv` (no dative -n: "auf 20 Hektar").
  Genders matter: they drive the article rewriting.
- Finding words worth adding: count on which pages of a web crawl a word occurs,
  .ch against .de. About 130 words were added that way (Medienmitteilung on 1135
  of 164k .ch pages and 89 of 1.96M .de pages, Lehrperson, Reservation,
  Bewilligung, Gemeindepräsident, "resp.", "Ende Jahr" …), and about 100 more in
  October 2026 (Neulenker, Altersjahr, Überbauung, Kostengutsprache, "zuhanden" …:
  .ch-heavy words not yet in the dictionary, read through by hand, since most of
  them are place and family names). After adding words,
  rerun `training/names_extract.py` and `training/german_too.py`: the crawl
  decides which new words are German too (it caught "Konfi", which on .de pages
  is confirmation class, and "Aktuar", an actuary).
- Everything else: `'swiss,forms>german,forms'` in `words`, `ambiguous` for
  words the model should judge, `phrases` for multi-word ones.
- `cues`: words that decide an ambiguous *vocabulary* case (Finken, Kasten,
  tönen, and nouns German also uses: Estrich, Pult, Store, Kübel, Peperoni)
  before the general model is asked. Keys are word forms. `pro` picks the German
  replacement, `contra` keeps the original — regexes matched against the sentence
  first, then the text node, then the block around it.
- `ssCues`: the same for ss-words with two real spellings (Busse/Buße,
  Masse/Maße). These are the rules' fallback: the eszett model decides, and a cue
  only outranks it for a spelling it barely saw in training, per `coverage.js`
  (regenerate with `training/coverage.py` after changing the cue words). That is
  how "die Bussen für zu schnelles Fahren" becomes Bußen.

## Tests

Served over HTTP (`py -m http.server 8765 --directory hochdeutsch-fixer`; the
browser may cache scripts between edits, so reload hard):

- `test.html` — rules only, no model, 160 cases.
- `dev/real.html` — for the *installed* extension, nothing stubbed: the 44 notes
  of the answer key as a plain page, graded after 20 s (`?wait=`). The Firefox
  build, installed into a fresh Firefox-engine profile, scores 43/44 there, the
  same as `dev/key.html`.
- `dev/swiss.html` — the engine on real sentences from .ch pages
  (`training/data/names/ch.jsonl`), before and after, for reading; `?base=old`
  runs another copy of the engine from `dev/old/` on the same sample, to compare
  versions.
- `dev/margins.html` — how confident the general model is on every decision.
- `dev/heldout.html?llm=1` — the whole engine on held-out Wikipedia sentences
  (`training/data`), with errors split by whether the model or the rules decided.
- `dev/offsets.html`, `dev/parity.html` — the browser feeds the eszett model
  exactly as Python did in training, and gets the same probabilities.
- `dev/key.html` — the 44 notes of the test artifact against its answer key
  (`dev/corpus.js`), rules plus model; `?mode=neutral` for the other flavour,
  `?llm=0` for rules only.
- `dev/heldout.html?llm=1&set=web` (or `set=wiki`) — the engine on held-out web
  sentences from sites the model never saw, errors split by path.
- `dev/e2e.html` — rules + model, 21 cases.
- `dev/names.html` — names kept, ordinary words still changed, end to end.
- `dev/page.html` — the real content script on a page, with the extension API stubbed.
- `dev/changes.html` — the changed-words list, the highlights and the card shown on hover, end to end.
- `dev/popup.html` — the popup with made-up data, to look at it without the extension.
- `dev/bg.html` — background page: model loading, ranking, caching.
- `dev/chch.html` — a real page (ch.ch speeding fines) run through the content
  script, printing a before/after diff.
- `dev/meta.html` — a real page about the words themselves (verstaendlich.ch on
  Mass/Masse/Massen), which must come out unchanged.
- `dev/frames.html` — a page of short notes inside a sandboxed `srcdoc`
  iframe, the shape artifacts and embedded readers use.
- `dev/debug.html` — prints raw scores for candidate sentences.

- `tools/pdf_check.py` — PDFs end to end in a headless browser with the extension
  installed (`tools/zen.py`): pixel and style parity with the built-in viewer,
  converted text on screen and in the text layer, find on every page, PDFs in
  iframes, `<embed>` and `<object>`, saving, and a page posing as the viewer.
  Test PDFs in `dev/pdf/` (`dev/pdf/make.py`, PyMuPDF).

`test.js` also runs under `node test.js` if Node is available.

## Known limits

- Frames: the extension runs in iframes too, including the `srcdoc` and `blob`
  documents that artifacts and embedded readers use — those need an explicit
  opt-in (`match_about_blank`, and `match_origin_as_fallback` on Chromium),
  without which a browser injects nothing there. The popup adds up every frame
  in the tab and says how many frames changed something.
- Only the text you can see is changed; inputs and code blocks are left alone.
- Language: text under `lang="de"` is always processed. Elsewhere — including a
  German email inside an English webmail interface, where `lang` describes the
  interface and not the message — a block is processed when its own text reads
  as German (common German words, umlauts). Short fragments on pages with no
  German around them are left alone.
- Pronoun agreement is only fixed when nothing else could be the antecedent: it
  stops at the next noun, a pronoun in the noun's own clause is left alone, and
  in a following sentence only a pronoun that opens that sentence counts, so
  "… auf dem Trottoir. Weil es so heiss war" keeps its weather-"es".
- Articles follow a changed noun across adverbs ("der eidgenössisch anerkannten
  Maturität"), hyphenated compounds ("das Sasara-Tram") and phrases with a
  preposition inside ("eine auf Sie zugeschnittene Offerte", "das daraus folgende
  Limit"), but not across anything longer. Without an article, adjectives that
  agree with the noun are re-inflected ("verbindliche Offerte" → "verbindliches
  Angebot"), and the model may keep them as they were; a noun whose own form shows
  the genitive keeps it ("Umschreibung Führerausweises" → "Führerscheins").
- Split text: an article and its noun in different text nodes ("die
  <a>Offerte</a>") are converted separately, so the article stays.
- Vocabulary is a list. On 300 random .ch sentences containing a dictionary word,
  the remaining misses were mostly names the model did not recognise (a café
  called "Kafi Franz", "STAR Coiffeur") and Swiss words not in the list.
- Capitalisation settles some ss/ß pairs by itself, with no model call: a noun is
  capitalised and a past tense is not, so mid-sentence "Ass" stays an ace while
  "ass" becomes "aß", and "Schoss" becomes "Schoß" while "schoss" stays.

- PDFs the browser opens from disk (`file://`), or that a page builds itself
  (`blob:`, `data:`), never pass the network, so the extension never sees them:
  they open in the browser's viewer, unconverted.
- In a PDF, the find bar highlights a match the way it does on any page, not with
  the viewer's own highlight, which the browser draws only for its own viewer.
- The viewer is the browser's version when `tools/sync_pdfjs.py` last ran.
- A model decision that comes after a page was drawn (the first page, while the
  model is still loading) redraws that page once.

- The model is small. It is good at spelling, articles and word choice in a
  sentence, and knows nothing about the world beyond that.
- The language-page detection is deliberately eager: a page that discusses
  spelling in passing is left untouched entirely, which is the safer of the two
  mistakes. The popup tells you when that is why nothing changed.
- The eszett model is bundled (64 MB); the general model downloads ~92 MB on first
  use. Until they answer, the rules' spellings stand.
- Names are only protected with Baby LLM on, and the rules' change shows for a
  moment before the model puts a name back.
- Name misses: brand names built from Swiss words (VeloStrom, "Velo Pro") and
  names with a letter or number ("Natel A") can still be rewritten. On a
  hand-labelled sample the model kept 20 of 30 such names and never kept an
  ordinary word.
- "Herzlichen Gruss aus Zürich" stays Gruss, because web pages write "Gruss"
  often enough to muddle the labels. 43 of the 44 test notes match their answer
  key. Buses in a sentence about fines ("25 Euro für Busse") can become fines.
