"""Teach the names head Swiss text, without hand labels.

A names model trained only on GermEval has never seen Rüebli, Glace or Trottoir,
and an unfamiliar capitalised word looks like a name to it. But it knows their
German synonyms well. So:

1. collect: web sentences with a German word the dictionary maps from Swiss
   (Fahrrad, Krankenhaus, Kinderkrankenhaus, Hähnchen, and greetings: Hallo,
   Danke), plus a random sample of web sentences with no such word;
2. label: a names model (the judge) reads each sentence in German spelling, where
   it is on familiar ground, and labels every word it is confident about:
   "mit dem Fahrrad" is no name, "Krankenhaus Bethel" is part of one;
3. swap: the Swiss word replaces the German one, the sentence is put into Swiss
   spelling, and the judged words keep their labels.

The model then learns that Velo in an ordinary sentence is an ordinary word,
Spital in "Spital Bethel" still part of a name, and that "Hoi Anna" and
"Gruss, Max" are a greeting and a name, not a two-word name: to a model trained
on German, the Swiss spelling alone makes a word look foreign, and so name-like.

    names_swap.py collect
    names_swap.py label runs/<model with names>/best
"""
import json, random, re, sys
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "data" / "names"
PER_FORM = 3000
PLAIN = 150_000
MIN_LEN = 5
SURE = 0.9           # the swapped word: judged at least this sure, else the sentence is dropped
WORD_SURE = 0.95     # any other word: supervised only when judged at least this sure
# German forms whose other meanings would make the swapped sentence nonsense
# (im Westen -> im Gilets); the names label would still be right, but nothing is learnt.
SKIP = {"Westen", "Rock", "Röcke", "Gehalt", "Gehälter", "Mieten", "Miete", "Spiel", "Spiele", "Motiv", "Motive",
        "Anzeige", "Anzeigen", "Junge", "Jungen", "Eimer", "Reifen", "Angebot", "Angebote", "Untersuchung",
        "Untersuchungen", "Entscheidung", "Entscheidungen", "Beschwerde", "Beschwerden"}


def mapping():
    """German form -> Swiss forms, plus German compound heads (Fahrradweg -> Veloweg)."""
    src = (HERE.parent / "dictionary.js").read_text(encoding="utf-8")
    nouns = src[src.index("  nouns: ["):src.index("  words: [")]
    exact, suffix = {}, {}
    for m in re.finditer(r"'([^'/]+)/[mfnp]/([^ =]+) = ([^/']+)/[mfnp]/([^ |']+)(?: \|([^']*))?'", nouns):
        s_lemma, s_pl, g_lemma, g_pl, flags = m.groups()
        if " " in g_lemma or "+" in g_lemma:
            continue
        pairs = [(g_lemma, s_lemma)]
        sp, gp = [p for p in s_pl.split(",") if p != "-"], [p for p in g_pl.split(",") if p != "-"]
        if sp and gp:
            pairs.append((gp[0], sp[0]))
        for g, s in pairs:
            if len(g) < MIN_LEN or g in SKIP:
                continue
            exact.setdefault(g, [s])
            if flags and re.search(r"\bs\b", flags):
                suffix.setdefault(g, s)
    # capitalised single words, greetings and the like: 'Salü,Sali,Hoi>Hallo'
    words = src[src.index("  words: ["):src.index("  phrases: [")]
    for swiss, german in re.findall(r"'([A-ZÄÖÜ][^'>]*)>([A-ZÄÖÜ][a-zäöüß]+)'", words):
        exact.setdefault(german, []).extend(swiss.split(","))
    # Grüezi is a greeting like Hoi; its German counterpart in the dictionary (Moin)
    # is too rare in the crawl to teach that, "Hallo" is not
    if "Hallo" in exact and "Moin" in exact:
        exact["Hallo"] += exact["Moin"]
    heads = {}
    comp = src[src.index("  compounds: ["):src.index("  ambiguous: [")]
    for swiss, german in re.findall(r"\['([a-zäöü]+)', '([A-Za-zäöüÄÖÜß]+)'", comp):
        if len(german) >= MIN_LEN + 2:
            heads.setdefault(german, swiss.capitalize())
    return exact, suffix, heads


EXACT, SUFFIX, HEADS = mapping()
WORD = re.compile(r"(?<![\wäöüÄÖÜß-])[A-ZÄÖÜ][\wäöüÄÖÜß]+")
_rng = random.Random(9)


def swap_of(w):
    """(Swiss replacement, German key) for a German word, or None."""
    if w in EXACT:
        return _rng.choice(EXACT[w]), w
    for g, s in SUFFIX.items():
        if w.endswith(g.lower()) and len(w) - len(g) >= 3:
            return w[:len(w) - len(g)] + s.lower(), g
    for g, s in HEADS.items():
        if w.startswith(g) and len(w) - len(g) >= 3 and w[len(g)].islower():
            return s + w[len(g):], g
    return None


def _scan(lines):
    out = []
    for line in lines:
        for m in WORD.finditer(line):
            sw = swap_of(m.group())
            if sw:
                out.append((sw[1], {"text": line, "at": m.start(), "german": m.group(), "swiss": sw[0]}))
                break
    return out


def _chunks(path, size=50_000):
    buf = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            buf.append(line.rstrip("\n"))
            if len(buf) == size:
                yield buf; buf = []
    if buf:
        yield buf


def collect():
    rng = random.Random(3)
    seen, kept = defaultdict(int), defaultdict(list)
    web = HERE / "data" / "v2" / "train_web.txt"
    total = 0
    with Pool(14) as pool:
        for k, rows in enumerate(pool.imap_unordered(_scan, _chunks(web))):
            for key, row in rows:
                seen[key] += 1
                if len(kept[key]) < PER_FORM:
                    kept[key].append(row)
                else:
                    j = rng.randrange(seen[key])
                    if j < PER_FORM:
                        kept[key][j] = row
    with open(web, encoding="utf-8") as f:
        total = sum(1 for _ in f)
    plain = set(rng.sample(range(total), PLAIN))
    with open(OUT / "swap_candidates.jsonl", "w", encoding="utf-8") as out:
        for rows in kept.values():
            for r in rows:
                out.write(json.dumps(r, ensure_ascii=False) + "\n")
        with open(web, encoding="utf-8") as f:
            for k, line in enumerate(f):
                if k in plain:
                    out.write(json.dumps({"text": line.rstrip("\n"), "at": None}, ensure_ascii=False) + "\n")
    print({k: seen[k] for k in sorted(seen, key=lambda k: -seen[k])})


def swissify_with_map(text):
    """Swiss spelling of text, and for each character offset in text its offset in the result."""
    out, where = [], []
    for ch in text:
        where.append(len(out))
        out.extend("ss" if ch == "ß" else ch)
    where.append(len(out))
    return "".join(out), where


def label(model_path):
    """Judge German sentences; write each swapped, Swiss-spelled sentence with every
    confidently judged word as a labelled character span."""
    import numpy as np
    import data_v2  # noqa: F401  (HF_HOME)
    from transformers import AutoModelForTokenClassification, AutoTokenizer
    from names_eval import logits_for, span_name
    tok = AutoTokenizer.from_pretrained(HERE / model_path)
    model = AutoModelForTokenClassification.from_pretrained(HERE / model_path).eval().to("cuda")
    rows = [json.loads(l) for l in open(OUT / "swap_candidates.jsonl", encoding="utf-8")]
    res = logits_for(model, tok, [r["text"] for r in rows])          # German spelling
    stats = defaultdict(lambda: [0, 0, 0])      # swapped form -> [not a name, name, unsure]
    words_kept = words_seen = 0
    with open(OUT / "swap.jsonl", "w", encoding="utf-8") as f:
        for r, (lg, offs) in zip(rows, res):
            text = r["text"]
            spans = []                          # (start, end, class, replacement) in the German text
            if r["at"] is not None:
                a, b = r["at"], r["at"] + len(r["german"])
                p, kind = span_name(lg, offs, a, b)
                if SURE > p > 1 - SURE:
                    stats[r["swiss"]][2] += 1
                    continue
                stats[r["swiss"]][int(p >= SURE)] += 1
                spans.append((a, b, kind if p >= SURE else "O", r["swiss"]))
            for m in re.finditer(r"[\wäöüÄÖÜß]+", text):
                if r["at"] is not None and m.start() == r["at"]:
                    continue
                words_seen += 1
                p, kind = span_name(lg, offs, m.start(), m.end())
                if WORD_SURE > p > 1 - WORD_SURE:
                    continue
                words_kept += 1
                spans.append((m.start(), m.end(), kind if p >= WORD_SURE else "O", None))
            spans.sort()
            new, labels, pos = "", [], 0
            for a, b, cls, swap in spans:
                new += text[pos:a]
                start = len(new)
                new += swap if swap else text[a:b]
                labels.append((start, len(new), cls))
                pos = b
            new += text[pos:]
            swiss, where = swissify_with_map(new)
            labels = [(where[a], where[b], cls) for a, b, cls in labels]
            f.write(json.dumps({"text": swiss, "labels": labels}, ensure_ascii=False) + "\n")
    total = np.array(list(stats.values())).sum(0)
    print(f"swapped words: not a name {total[0]:,}, name {total[1]:,}, unsure (dropped) {total[2]:,}")
    print(f"other words: {words_kept:,} of {words_seen:,} judged confidently and supervised")
    for w, (o, n, u) in sorted(stats.items(), key=lambda kv: -sum(kv[1]))[:15]:
        print(f"   {w:22} ordinary {o:5}  name {n:4}  unsure {u:4}")


if __name__ == "__main__":
    if sys.argv[1] == "collect":
        collect()
    else:
        label(sys.argv[2])
