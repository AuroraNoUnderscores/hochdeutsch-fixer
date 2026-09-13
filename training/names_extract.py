"""Where do the dictionary's Swiss words occur on German (.de) pages?

German Standard German hardly uses Spital, Velo, Trottoir or Billett as plain
words, so on .de pages they are almost only names (Heilig-Geist-Spital,
Juliusspital, "Velo de Ville"), quotations, or text about Switzerland. That makes
them a free test set of what the extension must leave alone. The same words on
.ch pages are mostly ordinary uses, which it must still change.

Writes data/names/{de,ch}.jsonl: {"word", "sentence", "url"}.
"""
import json, random, re, sys
from multiprocessing import Pool
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).parent
OUT = HERE / "data" / "names"
PER_WORD = 400

import pyarrow.parquet as pq
from prepare import SENT_SPLIT


def swiss_words():
    src = (HERE.parent / "dictionary.js").read_text(encoding="utf-8")
    nouns = src[src.index("nouns: ["):src.index("words: [")]
    exact, suffix = set(), set()
    for m in re.finditer(r"'([^'/]+)/[mfnp]/([^ =]+) =[^|']*(\|[^']*)?'", nouns):
        forms = {m.group(1)} | {p for p in m.group(2).split(",") if p != "-"}
        (suffix if m.group(3) and re.search(r"\bs\b", m.group(3)) else exact).update(forms)
    heads = re.findall(r"\['([a-zäöü]+)', '", src[src.index("compounds: ["):src.index("ambiguous: [")])
    return exact, suffix, heads


EXACT, SUFFIX, HEADS = swiss_words()
WORD = re.compile(r"\b[A-ZÄÖÜ][\wäöüß]+\b")
EXCEPT = re.compile(r"velour|veloci|velodrom|veloce|veloz|hospital|pneum", re.I)


def swiss_word(w):
    if EXCEPT.search(w):
        return None
    if w in EXACT:
        return w
    for f in SUFFIX:
        if w.endswith(f.lower()) and len(w) - len(f) >= 3 or w == f:
            return f
    low = w.lower()
    for h in HEADS:
        if low.startswith(h) and len(w) - len(h) >= 3:
            return h
    return None


def work(groups):
    f = pq.ParquetFile(sys.argv[1])
    out = []
    for g in groups:
        t = f.read_row_group(g, columns=["url", "text"])
        for url, text in zip(t.column("url").to_pylist(), t.column("text").to_pylist()):
            host = urlsplit(url).hostname or ""
            side = "de" if host.endswith(".de") else "ch" if host.endswith(".ch") else None
            if not side:
                continue
            out.append((side, None, None))                 # one per page, for base rates
            for line in text.split("\n"):
                for sent in SENT_SPLIT.split(line):
                    if not (20 <= len(sent) <= 300):
                        continue
                    for m in WORD.finditer(sent):
                        key = swiss_word(m.group())
                        if key:
                            out.append((side, key, {"word": m.group(), "at": m.start(), "sentence": sent.strip(), "url": url}))
                            break
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    groups = list(range(pq.ParquetFile(sys.argv[1]).num_row_groups))
    tasks = [groups[i:i + 40] for i in range(0, len(groups), 40)]
    rng = random.Random(5)
    seen = {"de": {}, "ch": {}}
    pages = {"de": 0, "ch": 0}
    with Pool(14) as pool:
        for k, rows in enumerate(pool.imap_unordered(work, tasks)):
            for side, key, row in rows:
                if key is None:
                    pages[side] += 1
                    continue
                bucket = seen[side].setdefault(key, [0, []])
                bucket[0] += 1
                if len(bucket[1]) < PER_WORD:            # reservoir sample per word
                    bucket[1].append(row)
                else:
                    j = rng.randrange(bucket[0])
                    if j < PER_WORD:
                        bucket[1][j] = row
            if k % 20 == 0:
                print(f"{k + 1}/{len(tasks)}", flush=True)
    for side, words in seen.items():
        with open(OUT / f"{side}.jsonl", "w", encoding="utf-8") as f:
            for key, (n, rows) in sorted(words.items()):
                for r in rows:
                    f.write(json.dumps({**r, "key": key}, ensure_ascii=False) + "\n")
        print(side, pages[side], "pages", {k: n for k, (n, _) in sorted(words.items(), key=lambda kv: -kv[1][0])})
    (OUT / "counts.json").write_text(json.dumps({"pages": pages, "words": {side: {k: n for k, (n, _) in w.items()}
                                                                          for side, w in seen.items()}},
                                                ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
