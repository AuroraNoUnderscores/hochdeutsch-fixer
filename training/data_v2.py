"""Tokenized, memory-mapped training data for any base model.

prepare_web.py writes plain German sentences. This turns them into the model's
input: the Swiss spelling (every ß as ss) as token ids, and for each token that
holds an "ss", whether it was ß. Cached per vocabulary: German DistilBERT and
gbert share one, so both train from the same files.

A sentence of 20 million is a slice of three flat arrays, so nothing big lives
in Python objects.
"""
import collections, hashlib, os, re
from multiprocessing import Pool
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
V2 = HERE / "data" / "v2"
os.environ.setdefault("HF_HOME", str(HERE / "data" / "hf"))

from prepare import swissify, decisions

MAX_LEN = 128
CHUNK = 50_000
MAX_REPEAT = 8
MIN_MINORITY = 10
SS_WORD = re.compile(r"\w*(?:ss|ß)\w*")

_tok = None
_repeat = None


def _init_tok(base, max_len=None):
    global _tok, MAX_LEN
    if max_len:
        MAX_LEN = max_len
    from transformers import AutoTokenizer
    _tok = AutoTokenizer.from_pretrained(base)


def _init_repeat(repeat):
    global _repeat
    _repeat = repeat


def _encode(job):
    first, lines = job
    swiss, origins = zip(*(swissify(s) for s in lines))
    enc = _tok(list(swiss), truncation=True, max_length=MAX_LEN, return_offsets_mapping=True)
    ids, labels, lengths, kept = [], [], [], []
    for k, (tid, offs) in enumerate(zip(enc["input_ids"], enc["offset_mapping"])):
        lab = [-1] * len(tid)
        for start, gold in decisions(swiss[k], origins[k]):
            for t, (a, b) in enumerate(offs):
                if a <= start < b:
                    lab[t] = gold if lab[t] in (-1, gold) else -2   # one token, two disagreeing pairs
                    break
        lab = [-1 if l == -2 else l for l in lab]
        if all(l < 0 for l in lab):
            continue
        ids.extend(tid); labels.extend(lab); lengths.append(len(tid)); kept.append(first + k)
    return (np.array(ids, np.uint16), np.array(labels, np.int8),
            np.array(lengths, np.int32), np.array(kept, np.int64))


def _factors(job):
    _, lines = job
    out = np.ones(len(lines), np.uint8)
    for k, s in enumerate(lines):
        for w in SS_WORD.findall(s):
            out[k] = max(out[k], _repeat.get((w.replace("ß", "ss").lower(), 1 if "ß" in w else 0), 1))
    return out


def _count(job):
    c = collections.Counter()
    for s in job[1]:
        for w in SS_WORD.findall(s):
            c[(w.replace("ß", "ss").lower(), 1 if "ß" in w else 0)] += 1
    return c


def _chunks(path, limit):
    buf, n = [], 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            buf.append(line.rstrip("\n"))
            n += 1
            if len(buf) == CHUNK:
                yield n - len(buf), buf; buf = []
            if limit and n >= limit:
                break
    if buf:
        yield n - len(buf), buf


def repeat_factors(paths, limits):
    """Which (form, spelling) gets repeated how often; the rarer spelling of an
    ambiguous form is repeated towards parity, as in prepare.py."""
    counts = collections.Counter()
    with Pool(14) as pool:
        for p, lim in zip(paths, limits):
            for c in pool.imap_unordered(_count, _chunks(p, lim)):
                counts.update(c)
    repeat = {}
    for form in {f for f, _ in counts}:
        ss, ez = counts[(form, 0)], counts[(form, 1)]
        minority, majority = min(ss, ez), max(ss, ez)
        if minority >= MIN_MINORITY and majority > minority:
            factor = min(MAX_REPEAT, round(majority / minority))
            if factor > 1:
                repeat[(form, 1 if ez < ss else 0)] = factor
    return repeat, counts


def repeat_tag(repeat):
    if not repeat:
        return "none"
    return hashlib.md5(repr(sorted(repeat.items())).encode()).hexdigest()[:10]


def vocab_key(base):
    """Models sharing a vocabulary (German DistilBERT and gbert do) share one cache."""
    from transformers import AutoTokenizer
    vocab = sorted(AutoTokenizer.from_pretrained(base).get_vocab().items())
    return "vocab-" + hashlib.md5(repr(vocab).encode()).hexdigest()[:10]


def build(base, name, limit=0, repeat=None, max_len=MAX_LEN):
    """Tokenize data/v2/<name>.txt for a base model (once per vocabulary), and
    write how often each sentence is repeated under this balancing."""
    out = V2 / "tok" / vocab_key(base) / (f"{name}{'_' + str(limit) if limit else ''}"
                                          f"{'_len' + str(max_len) if max_len != 128 else ''}")
    if not (out / "lines.npy").exists():
        out.mkdir(parents=True, exist_ok=True)
        parts = {"ids": [], "labels": [], "lengths": [], "lines": []}
        with Pool(14, initializer=_init_tok, initargs=(base, max_len)) as pool:
            for k, arrays in enumerate(pool.imap(_encode, _chunks(V2 / f"{name}.txt", limit))):
                for key, a in zip(parts, arrays):
                    parts[key].append(a)
                if k % 20 == 0:
                    print(f"  tokenizing {name}: {(k + 1) * CHUNK:,} lines", flush=True)
        for key, a in parts.items():
            np.save(out / f"{key}.npy", np.concatenate(a))
    target = out / f"repeats-{repeat_tag(repeat)}.npy"
    if not target.exists():
        lines = np.load(out / "lines.npy")
        if repeat:
            with Pool(14, initializer=_init_repeat, initargs=(repeat,)) as pool:
                every = np.concatenate(list(pool.imap(_factors, _chunks(V2 / f"{name}.txt", limit))))
            np.save(target, every[lines])
        else:
            np.save(target, np.ones(len(lines), np.uint8))
    return out, target


class Tokenized:
    def __init__(self, built):
        folder, repeats = built
        self.ids = np.load(folder / "ids.npy", mmap_mode="r")
        self.labels = np.load(folder / "labels.npy", mmap_mode="r")
        self.lengths = np.load(folder / "lengths.npy")
        self.repeats = np.load(repeats)
        self.starts = np.concatenate([[0], np.cumsum(self.lengths, dtype=np.int64)])

    def __len__(self):
        return len(self.lengths)

    def row(self, i):
        a, b = self.starts[i], self.starts[i + 1]
        return self.ids[a:b], self.labels[a:b]


def collate(rows, pad_id):
    width = max(len(ids) for ids, _ in rows)
    ids = np.full((len(rows), width), pad_id, np.int64)
    labels = np.full((len(rows), width), -100, np.int64)
    mask = np.zeros((len(rows), width), np.int64)
    for k, (i, l) in enumerate(rows):
        ids[k, :len(i)] = i
        lab = l.astype(np.int64); lab[lab < 0] = -100
        labels[k, :len(l)] = lab
        mask[k, :len(i)] = 1
    return ids, mask, labels
