"""Everyday German for the eszett model: web text alongside Wikipedia.

Wikipedia taught the model encyclopedia German, where "Masse" (mass) outnumbers
"Maße" (measurements) 5 to 1 and a carpenter taking the measurements of a
window essentially never occurs. FineWeb-2 (a cleaned web crawl: shops, forums,
how-tos, news) covers that register. Same self-supervised labels as before:
every ß becomes ss, the original is the answer.

Web text needs filtering Wikipedia did not, because a wrong spelling in the
source is a wrong label. German pages write "Online Fussball Wetten", "Schloß
Burgk" and "weiss" too, and a model trained on them learns to leave exactly the
spellings the extension is meant to fix. So:
- Swiss and Liechtenstein sites are dropped.
- Wikipedia decides which spellings are settled: a form written one way at least
  97% of the time in 30+ occurrences (Straße, Fußball, heißt; dass, muss,
  Russland). A page spelling any settled form the other way (Swiss spelling,
  spelling before 1996, or typos) is dropped whole. No word list is written by
  hand, and forms with two real spellings (Masse/Maße, Weiss the name) are never
  settled, so they stay and teach context.
The same check removes the few such sentences from the Wikipedia data.

Train/val/test are split by website, so no site appears in two of them.
Writes plain text, one German sentence per line; train.py tokenizes it for
whichever base model it trains.
"""
import hashlib, json, os, re, sys
from collections import Counter
from multiprocessing import Pool
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).parent
DATA = HERE / "data"
OUT = DATA / "v2"
os.environ.setdefault("HF_HOME", str(DATA / "hf"))

import pyarrow.parquet as pq
from prepare import SENT_SPLIT

FILE = "data/deu_Latn/train/000_00000.parquet"
GROUPS_PER_TASK = 20
MIN_LANGUAGE_SCORE = 0.85

MIN_SETTLED = 30      # occurrences before Wikipedia's spelling of a form counts
MAX_OTHER = 0.03      # share of the other spelling still considered noise
SS_WORD = re.compile(r"(?<!\w)\w*(?:ss|ß)\w*(?!\w)")
LETTER = re.compile(r"[^\W\d_]", re.U)


def host_of(url):
    try:
        return urlsplit(url).hostname or ""
    except ValueError:
        return ""


def split_of(host):
    bucket = int(hashlib.md5(host.encode()).hexdigest(), 16) % 100
    return "test" if bucket < 1 else "val" if bucket < 2 else "train"


def usable(sent):
    if not (25 <= len(sent) <= 300) or ("ß" not in sent and "ss" not in sent):
        return False
    if sent.isupper() or "ẞ" in sent or len(sent.split()) < 4:
        return False
    chars = len(sent.replace(" ", ""))
    return len(LETTER.findall(sent)) >= 0.7 * chars


_file = None
_settled = None


def settled_forms():
    """{form as written in Swiss text: True if German settles it on ß, False on ss}"""
    counts = Counter()
    with open(OUT / "train_wiki_raw.txt", encoding="utf-8") as f:
        for line in f:
            for w in SS_WORD.findall(line):
                counts[(w.replace("ß", "ss"), "ß" in w)] += 1
    settled = {}
    for form in {f for f, _ in counts}:
        ez, ss = counts[(form, True)], counts[(form, False)]
        if max(ez, ss) >= MIN_SETTLED and min(ez, ss) <= MAX_OTHER * (ez + ss):
            settled[form] = ez > ss
    return settled


def against_settled(text):
    """(word, True if ß was due) for the first settled form spelled the other way."""
    for w in SS_WORD.findall(text):
        due = _settled.get(w.replace("ß", "ss"))
        if due is not None and due != ("ß" in w):
            return w, due
    return None


def init(settled):
    global _settled
    _settled = settled


def work(groups):
    global _file
    if _file is None:
        _file = pq.ParquetFile(sys.argv[1])
    out, why = [], {"docs": 0, "swiss_site": 0, "language": 0, "against_settled": 0, "by_ss": 0, "by_eszett": 0}
    for g in groups:
        t = _file.read_row_group(g, columns=["url", "text", "language_score"])
        for url, text, score in zip(*(t.column(c).to_pylist() for c in ("url", "text", "language_score"))):
            why["docs"] += 1
            host = host_of(url)
            if host.endswith((".ch", ".li")) or "de-ch" in url.lower() or "de_ch" in url.lower():
                why["swiss_site"] += 1; continue
            if score < MIN_LANGUAGE_SCORE:
                why["language"] += 1; continue
            wrong = against_settled(text)
            if wrong:
                why["against_settled"] += 1
                why["by_ss" if wrong[1] else "by_eszett"] += 1
                continue
            split = split_of(host)
            for line in text.split("\n"):
                for sent in SENT_SPLIT.split(line):
                    sent = sent.strip()
                    if usable(sent):
                        out.append((split, sent))
    return out, why


def wikipedia():
    """The existing Wikipedia sentences, as text, without the balancing repeats."""
    for split in ("train", "val", "test"):
        seen = set()
        with open(DATA / f"{split}.jsonl", encoding="utf-8") as f, \
                open(OUT / f"{split}_wiki_raw.txt", "w", encoding="utf-8") as w:
            for line in f:
                g = json.loads(line)["german"]
                if g in seen or "\n" in g:
                    continue
                seen.add(g); w.write(g + "\n")
    settled = settled_forms()
    init(settled)
    for split in ("train", "val", "test"):
        n = dropped = 0
        with open(OUT / f"{split}_wiki_raw.txt", encoding="utf-8") as f, \
                open(OUT / f"{split}_wiki.txt", "w", encoding="utf-8") as w:
            for line in f:
                if against_settled(line):
                    dropped += 1; continue
                w.write(line); n += 1
        print(f"wiki {split:5} {n:10,} sentences ({dropped:,} against a settled spelling dropped)", flush=True)
    return settled


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    settled = wikipedia()
    print(f"{sum(settled.values()):,} forms settled on ß, {sum(not v for v in settled.values()):,} on ss", flush=True)
    (OUT / "settled.json").write_text(json.dumps(settled, ensure_ascii=False, indent=0), encoding="utf-8")
    groups = list(range(pq.ParquetFile(sys.argv[1]).num_row_groups))
    tasks = [groups[i:i + GROUPS_PER_TASK] for i in range(0, len(groups), GROUPS_PER_TASK)]
    files = {s: open(OUT / f"{s}_web.txt", "w", encoding="utf-8") for s in ("train", "val", "test")}
    counts = {s: 0 for s in files}
    total = {}
    seen = set()
    dupes = 0
    with Pool(14, initializer=init, initargs=(settled,)) as pool:
        for k, (rows, why) in enumerate(pool.imap_unordered(work, tasks)):
            for key, v in why.items():
                total[key] = total.get(key, 0) + v
            for split, sent in rows:
                h = hashlib.blake2b(sent.encode(), digest_size=8).digest()
                if h in seen:
                    dupes += 1; continue
                seen.add(h)
                files[split].write(sent + "\n"); counts[split] += 1
            if k % 10 == 0:
                print(f"{k + 1}/{len(tasks)} tasks  {total}  sentences {counts}  duplicates {dupes:,}", flush=True)
    for f in files.values():
        f.close()
    print(f"done  {total}\nsentences {counts}  duplicates skipped {dupes:,}")
    (OUT / "web_stats.json").write_text(json.dumps({"documents": total, "sentences": counts, "duplicates": dupes}, indent=2))


if __name__ == "__main__":
    main()
