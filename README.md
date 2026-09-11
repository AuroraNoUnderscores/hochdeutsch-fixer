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

1. **Rules** (`dictionary.js`, `morph.js`, `engine.js`) — run instantly. Where
   they can't decide, they emit a *choice*: a list of candidate strings with a
   safe default, so the page always reads correctly.
2. **The baby LLM** (`llm.js`, hosted by `background.js`) — a German DistilBERT
   (66M parameters, int8, ~92 MB), downloaded once from Hugging Face on first
   use and cached. It scores each candidate sentence by pseudo-log-likelihood
   (mask a token, ask how likely it is) and the best one replaces the default.

The model never writes text. It only ranks candidates the rules produced, so the
worst it can do is pick the wrong one of them. It runs on WASM, no GPU needed.

### What each side decides

| Decision | Who | Why |
| --- | --- | --- |
| Vocabulary, compounds, numbers, known ß stems | rules | unambiguous |
| Articles, adjective endings, case and number after a gender change | rules, model picks when the case is ambiguous ("ein Keks" vs "einen Keks") | |
| ß for any other word (Masse/Maße, Floss/Floß) | model | needs the context |
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
- `cues`: words that decide an ambiguous case before the model is asked.
  `pro` picks the German replacement, `contra` keeps the original — both are
  regexes matched against the text node and the block around it. This is how
  "die Bussen für zu schnelles Fahren" becomes Geldstrafen while "die Bussen ab
  dem Bahnhof" stays buses.

## Tests

Served over HTTP (`py -m http.server 8765 --directory hochdeutsch-fixer`):

- `test.html` — rules only, no model, 67 cases.
- `dev/e2e.html` — rules + model, 15 cases.
- `dev/page.html` — the real content script on a page, with the extension API stubbed.
- `dev/bg.html` — background page: model loading, ranking, caching.
- `dev/chch.html` — a real page (ch.ch speeding fines) run through the content
  script, printing a before/after diff.
- `dev/debug.html` — prints raw scores for candidate sentences.

`test.js` also runs under `node test.js` if Node is available.

## Known limits

- Only the text you can see is changed; inputs and code blocks are left alone.
- Language: text under `lang="de"` is always processed. Elsewhere — including a
  German email inside an English webmail interface, where `lang` describes the
  interface and not the message — a block is processed when its own text reads
  as German (common German words, umlauts). Short fragments on pages with no
  German around them are left alone.
- Pronoun agreement is only fixed when nothing else could be the antecedent; it
  stops at the next noun, so a distant reference stays as it was.
- The model is small. It is good at spelling, articles and word choice in a
  sentence, and knows nothing about the world beyond that.
- First use downloads ~92 MB. Until it finishes, choices keep their defaults.
