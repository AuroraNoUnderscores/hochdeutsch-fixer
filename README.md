# Hochdeutsch-Fixer

A Firefox extension that rewrites Swiss Standard German on web pages into German
Standard German — optionally with a Hamburg accent. Rules do the work; a small
German language model running on your own machine settles the calls rules can't make.

## Install

`about:debugging` → This Firefox → Load Temporary Add-on… → pick `manifest.json`.
Temporary add-ons disappear when Firefox restarts. To keep it, zip the folder
contents and upload the zip at addons.mozilla.org/developers as "On your own";
that signs it for free without listing it publicly.

## How it works

Two passes over every text node:

1. **Rules** (`dictionary.js`, `morph.js`, `engine.js`) run instantly: vocabulary,
   grammar, article agreement, and a first guess at every ss/ß. The page always
   reads sensibly before any model has spoken.
2. **Two small models** (`llm.js`, hosted by `background.js`), both German
   DistilBERT running locally on WASM, no GPU needed:
   - **eszett** — fine-tuned for this extension to decide, for every "ss", whether
     German spells it ß. Bundled in `models/hdfx-eszett` (64 MB). It reads each
     text once and settles every ss/ß in it. How it was trained is in
     [training/](training/README.md).
   - **general** — the untouched base model, downloaded once (~92 MB), which only
     ranks the few remaining candidates: article forms and grammar wording.

Neither model writes text: they choose among spellings and candidates the rules
produced.

### Why a trained model decides ss/ß, not rules

On sentences from articles nobody tuned anything on, hand-written ss/ß rules got
28.8 of every 1000 decisions wrong. The eszett model, trained on 1.17 million
Wikipedia sentences whose correct spelling came for free (turn every ß into ss,
and the original is the answer), gets 10.6 wrong end to end — including the
collisions a list cannot settle: *die Masse strömte* vs *die Maße meines Koffers*,
*ein Ass* vs *ich aß*, *keine Busse fahren* vs *eine Buße zahlen*.

The rules' answer only stands where the model is unsure (probability between 0.4
and 0.6), and a topic cue only outranks it for a spelling the model barely saw in
training (`coverage.js`: plural "Bußen" occurred 3 times). On unseen text the
cues are otherwise less reliable than the model.

### Text about words is left alone

A page explaining that "Mass (1) und Masse (2) werden in der Mehrzahl zu Massen"
must keep its examples, and so must "in der Schweiz sagt man Velo". No model can
catch this — both spellings read perfectly naturally — so it is detected instead,
at three levels, each reverting anything already changed:

- **Page**: a strong cue (Rechtschreibung, Eszett, Duden, Grammatik, Helvetismus …)
  or two weaker ones in the title and text switch the extension off for the page.
  The popup then says so.
- **Sentence**: one cue (das Wort, Mehrzahl, sagt man, Aussprache …) suppresses
  that sentence only, so a single explaining line in an ordinary article is safe.
- **Word**: a word in quotes («Velo»), or inside `em`/`i`/`q`/`cite`/`dfn` with
  at most three words, is being named rather than used. A word is also left alone
  when the other spelling appears nearby, since the text is comparing them.

### What the general model is for

It ranks candidates by how natural they sound, and may only overrule a rule when
clearly better, by a margin in nats that depends on what is at stake (`CONF` in
`engine.js`): word choice 2.0, forms 0.5, grammar wording 0. Below that the rule's
default stands. The popup lists recent decisions with their margins, and "Baby
LLM" off turns both models off (rules only).

### Swiss grammar, not just words

Some Helvetisms are constructions rather than vocabulary:

| Swiss | German | how |
| --- | --- | --- |
| Es hat noch Tische frei | Es gibt noch freie Tische | rules rewrite, model picks the wording |
| Der Kollege, wo mir hilft | Der Kollege, der mir hilft | gender from the article, model picks the case |
| Ich bin gesessen / Er ist gestanden | Ich habe gesessen / Er hat gestanden | rules: position verbs take haben |

"es hat" only becomes "es gibt" where *es* is the subject and the clause holds no
participle, so "Es hat geregnet", "Sie hat es eilig" and "Er hat es mir gegeben"
are left alone. Relative "wo" after a place or a time ("die Stadt, wo ich wohne")
is ordinary German and stays.

### What each side decides

| Decision | Who | Why |
| --- | --- | --- |
| Vocabulary, compounds, numbers, known ß stems | rules | unambiguous |
| Articles, adjective endings, case and number after a gender change | rules, model picks when the case is ambiguous ("ein Keks" vs "einen Keks") | |
| every ss/ß | eszett model, rules where it is unsure | measured 3× fewer errors than rules on unseen text |
| Words that are also German with another meaning (Busse, Finken, tönen) | cue words in the surrounding block, else the model | the model only judges how a sentence sounds and cannot know a page is about speeding fines |
| "zügeln" → "umziehen", incl. moving the particle to the clause end | model | word order |
| parkiert → parkt / geparkt | rules | the model scores "Er geparkt das Auto" higher, so it is not asked |
| Pronouns after a gender change ("Er war knapp" → "Sie war knapp") | rules | German pronouns agree with their antecedent; the model has no idea |

## Settings (toolbar popup)

- **Enabled**, and a per-site switch. Turning it off restores the page without a reload.
- **Flavour**: *Hamburg* (default — Rundstück, Sonnabend, Schlachter, Tischler,
  Abendbrot, Deern, Jung, schnacken, Moin, Tschüss) or *Neutral* (plain German
  Standard German).
- **Baby LLM**: off = rules only, no download, no model.

## Adding words

Edit `dictionary.js`, then hit Reload in `about:debugging`.

- Nouns: `'Swiss/gender/plural = German/gender/plural | flags'`. Gender `m/f/n`,
  or `p` for plural-only; plural `-` means uncountable. Flags: `s` (also matches
  at the end of a compound), `sw`/`gw` (weak masculine), `gen=Form`, `x=regex`
  (compound exceptions). Genders matter: they drive the article rewriting.
- Everything else: `'swiss,forms>german,forms'` in `words`, `ambiguous` for
  words the model should judge, `phrases` for multi-word ones.
- `cues`: words that decide an ambiguous *vocabulary* case (Finken, Kasten,
  tönen) before the general model is asked. `pro` picks the German replacement,
  `contra` keeps the original — regexes matched against the sentence first, then
  the text node, then the block around it.
- `ssCues`: the same for ss-words with two real spellings (Busse/Buße,
  Masse/Maße). These are the rules' fallback: the eszett model decides, and a cue
  only outranks it for a spelling it barely saw in training, per `coverage.js`
  (regenerate with `training/coverage.py` after changing the cue words). That is
  how "die Bussen für zu schnelles Fahren" becomes Bußen.

## Tests

Served over HTTP (`py -m http.server 8765 --directory hochdeutsch-fixer`):

- `test.html` — rules only, no model, 95 cases.
- `dev/margins.html` — how confident the general model is on every decision.
- `dev/heldout.html?llm=1` — the whole engine on held-out Wikipedia sentences
  (`training/data`), with errors split by whether the model or the rules decided.
- `dev/offsets.html`, `dev/parity.html` — the browser feeds the eszett model
  exactly as Python did in training, and gets the same probabilities.
- `dev/key.html` — the 44 notes of the test artifact against its answer key
  (`dev/corpus.js`), rules plus model; `?mode=neutral` for the other flavour,
  `?llm=0` for rules only.
- `dev/e2e.html` — rules + model, 15 cases.
- `dev/page.html` — the real content script on a page, with the extension API stubbed.
- `dev/bg.html` — background page: model loading, ranking, caching.
- `dev/chch.html` — a real page (ch.ch speeding fines) run through the content
  script, printing a before/after diff.
- `dev/meta.html` — a real page about the words themselves (verstaendlich.ch on
  Mass/Masse/Massen), which must come out unchanged.
- `dev/frames.html` — a page of short notes inside a sandboxed `srcdoc`
  iframe, the shape artifacts and embedded readers use.
- `dev/debug.html` — prints raw scores for candidate sentences.

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
  stops at the next noun, and in a following sentence only a pronoun that opens
  that sentence counts, so "… auf dem Trottoir. Weil es so heiss war" keeps its
  weather-"es".
- Capitalisation settles some ss/ß pairs by itself, with no model call: a noun is
  capitalised and a past tense is not, so mid-sentence "Ass" stays an ace while
  "ass" becomes "aß", and "Schoss" becomes "Schoß" while "schoss" stays.

- The model is small. It is good at spelling, articles and word choice in a
  sentence, and knows nothing about the world beyond that.
- The language-page detection is deliberately eager: a page that discusses
  spelling in passing is left untouched entirely, which is the safer of the two
  mistakes. The popup tells you when that is why nothing changed.
- The eszett model is bundled (64 MB); the general model downloads ~92 MB on first
  use. Until they answer, the rules' spellings stand.
- "die Masse des Fensters" still comes out as Masse: an encyclopedia rarely talks
  about measuring a window, so that sense is under-represented in training.
