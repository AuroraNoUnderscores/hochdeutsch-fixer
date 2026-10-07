"""Swiss context for the eszett model.

The extension asks the model about Swiss text: a paragraph from a .ch page, its
Swiss words partly converted. The model learnt ss/ß from German web text,
cleaned of Swiss pages, yet some Swiss writing slipped through, and in it
"Grosse" and "Busse" stay ss. So the model learnt that a Swiss-sounding text
(Winterthur, Kantonsspital, 40 Franken) keeps its ss: given "Das Kantonsspital
Winterthur hat ... eröffnet. Grosse Teile des Spitals ..." it gave Große 0.24,
alone 0.997. For a Swiss-to-German converter that is exactly backwards.

This builds training rows of the kind the extension sends: one to three real
sentences from .ch pages around one German web sentence. Only the German
sentence's ss count (its true spelling is known); the Swiss sentences' ss carry
no label, so the model learns that Swiss context says nothing about how German
spells the next word. Split by website like everything else.

    swissctx.py extract <fineweb parquet>     # .ch sentences -> data/v2/ch_{train,val,test}.txt
    swissctx.py build <base model> <split> N  # N rows, cached like data_v2

Rows are cached as data_v2.Tokenized folders, so train2.py reads them as it
reads every other source.
"""
import hashlib, json, os, random, sys
from multiprocessing import Pool
from pathlib import Path
from urllib.parse import urlsplit

import numpy as np

HERE = Path(__file__).parent
V2 = HERE / "data" / "v2"
os.environ.setdefault("HF_HOME", str(HERE / "data" / "hf"))
from prepare import SENT_SPLIT, swissify, decisions
from prepare_web import split_of
import data_v2 as D

MAX_LEN = 256


def _ch_work(args):
    path, groups = args
    import pyarrow.parquet as pq
    f = pq.ParquetFile(path)
    out = {"train": [], "val": [], "test": []}
    for g in groups:
        t = f.read_row_group(g, columns=["url", "text"])
        for url, text in zip(t.column("url").to_pylist(), t.column("text").to_pylist()):
            host = urlsplit(url).hostname or ""
            if not host.endswith(".ch"):
                continue
            split = split_of(host)
            for line in text.split("\n"):
                for s in SENT_SPLIT.split(line):
                    s = s.strip()
                    if 30 <= len(s) <= 260 and len(s.split()) >= 5 and "ß" not in s:
                        out[split].append(s)
    return out


def extract(path):
    import pyarrow.parquet as pq
    groups = list(range(pq.ParquetFile(path).num_row_groups))
    tasks = [(path, groups[i:i + 20]) for i in range(0, len(groups), 20)]
    files = {k: open(V2 / f"ch_{k}.txt", "w", encoding="utf-8") for k in ("train", "val", "test")}
    n = {k: 0 for k in files}
    with Pool(14) as pool:
        for k, out in enumerate(pool.imap_unordered(_ch_work, tasks)):
            for split, rows in out.items():
                files[split].writelines(r + "\n" for r in rows)
                n[split] += len(rows)
            if k % 20 == 0:
                print(f"{k + 1}/{len(tasks)}", n, flush=True)
    for f in files.values():
        f.close()
    print(n)


def read_lines(path, limit=None, seed=0):
    """All lines, or `limit` of them at random, without holding a 3 GB file in memory."""
    if not limit:
        return path.read_text(encoding="utf-8").splitlines()
    with open(path, "rb") as f:
        total = sum(1 for _ in f)
    keep = set(random.Random(seed).sample(range(total), min(limit, total)))
    with open(path, encoding="utf-8") as f:
        return [line.rstrip("\n") for i, line in enumerate(f) if i in keep]


_tok = None


def _init(base):
    global _tok
    from transformers import AutoTokenizer
    _tok = AutoTokenizer.from_pretrained(base)


def _encode(rows):
    ids, labels, lengths = [], [], []
    for parts, target in rows:
        # parts: the row's sentences in order; target: which one is German (labelled)
        texts, spans, at = [], [], 0
        for k, p in enumerate(parts):
            swiss, origin = swissify(p) if k == target else (p, [False] * len(p))
            texts.append(swiss)
            spans.append((at, at + len(swiss), origin if k == target else None))
            at += len(swiss) + 1
        text = " ".join(texts)
        enc = _tok(text, truncation=True, max_length=MAX_LEN, return_offsets_mapping=True)
        tid, offs = enc["input_ids"], enc["offset_mapping"]
        lab = [-1] * len(tid)
        a, b, origin = spans[target]
        found = 0
        for start, gold in decisions(text[a:b], origin):
            start += a
            for t, (x, y) in enumerate(offs):
                if x <= start < y:
                    lab[t] = gold if lab[t] in (-1, gold) else -2
                    found += 1
                    break
        if not found or offs[-2][1] < b:        # the German sentence was cut off: drop the row
            continue
        lab = [-1 if l == -2 else l for l in lab]
        ids.extend(tid); labels.extend(lab); lengths.append(len(tid))
    return np.array(ids, np.uint16), np.array(labels, np.int8), np.array(lengths, np.int32)


def rows_for(split, n, seed, source="web", alone=0.0):
    """n rows around German sentences: web ones (a random n of them), or another
    source's (all of them, in turn until there are n); `alone` of them without
    Swiss context."""
    swiss = read_lines(V2 / f"ch_{split}.txt", None, seed)
    rng = random.Random(seed + 1)
    if source == "web":
        german = read_lines(V2 / f"{'test' if split == 'test' else split}_web.txt", n, seed)
    else:
        pool = read_lines(V2 / f"{source}_{split}.txt")
        german = []
        while len(german) < n:
            rng.shuffle(pool); german += pool[:n - len(german)]
    rows = []
    for g in german:
        before = rng.choice([1, 1, 2, 2, 3])
        shape = rng.random()
        if alone and rng.random() < alone:
            parts = [g]; target = 0
        elif shape < 0.7:      # Swiss sentences, then the German one: the usual paragraph
            parts = [rng.choice(swiss) for _ in range(before)] + [g]; target = len(parts) - 1
        elif shape < 0.85:   # the German sentence first
            parts = [g] + [rng.choice(swiss) for _ in range(rng.choice([1, 2]))]; target = 0
        else:                # in the middle
            parts = [rng.choice(swiss) for _ in range(before)] + [g] + [rng.choice(swiss)]; target = before
        rows.append((parts, target))
    return rows


def build(base, split, n, seed=11, source="web", alone=0.0):
    """Like data_v2.build: a cached Tokenized folder (ids, labels, lengths, lines, repeats)."""
    name = "swissctx" if source == "web" else f"{source}ctx"
    out = V2 / "tok" / D.vocab_key(base) / f"{name}_{split}_{n}"
    if not (out / "lines.npy").exists():
        out.mkdir(parents=True, exist_ok=True)
        rows = rows_for(split, n, seed, source, alone)
        chunks = [rows[i:i + 20000] for i in range(0, len(rows), 20000)]
        parts = {"ids": [], "labels": [], "lengths": []}
        with Pool(14, initializer=_init, initargs=(base,)) as pool:
            for k, arrays in enumerate(pool.imap(_encode, chunks)):
                for key, a in zip(parts, arrays):
                    parts[key].append(a)
                if k % 20 == 0:
                    print(f"  {name} {split}: {(k + 1) * 20000:,} rows", flush=True)
        for key, a in parts.items():
            np.save(out / f"{key}.npy", np.concatenate(a))
        lines = np.arange(sum(len(a) for a in parts["lengths"]), dtype=np.int64)
        np.save(out / "lines.npy", lines)
        np.save(out / "repeats-none.npy", np.ones(len(lines), np.uint8))
        # the rows as text, to read them
        (out / "sample.json").write_text(json.dumps(rows[:50], ensure_ascii=False, indent=1), encoding="utf-8")
    return out, out / "repeats-none.npy"


if __name__ == "__main__":
    if sys.argv[1] == "extract":
        extract(sys.argv[2])
    elif sys.argv[1] == "build":
        print(build(sys.argv[2], sys.argv[3], int(sys.argv[4])))
