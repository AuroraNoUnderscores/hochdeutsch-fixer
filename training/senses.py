"""Rare senses for the eszett model: "Buße" as a fine.

Swiss text says "Busse" for a fine all the time ("eine Busse von 40 Franken");
German text says Bußgeld, Strafe or Verwarnungsgeld, and keeps Buße mostly for
the church. In 22 million German web sentences there are about 17 fines spelt
"Buße von ...", against 11,000 "Busse" that are buses. And Wikipedia writes
"Bussen" (buses) so much more often than "Bußen" that prepare_web.py counts it
as settled on ss, which drops every page that fines in the plural. So next to
traffic words (Velo, Bahnhof, parkieren) the model read a Swiss fine as buses:
"Wer falsch parkiert, muss eine Busse von 40 Franken bezahlen." stayed ss.

German writes the same sentences with "Strafe" or "Bußgeld": "Wer falsch parkt,
muss eine Strafe von 30 Euro zahlen", "droht ein Bußgeld von 55 Euro". Taking
those from German web pages (not Swiss ones; a Strafe only where money or paying
is in the sentence, a Bußgeld only where its article shows the case) and putting
Buße in their place gives true ß labels in exactly the contexts the extension
meets, while the many real buses keep teaching ss.

    senses.py extract <fineweb parquet>   # -> data/v2/senses_{train,val,test}.txt
    senses.py build <base model> <split> N

Rows are the sentence alone or inside Swiss sentences, as swissctx.py builds them.
The web's own sentences with buses go in beside them, so "Busse" stays both.
"""
import json, re, sys
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).parent
V2 = HERE / "data" / "v2"
from prepare import SENT_SPLIT
import prepare_web as W
import swissctx as C

WORD = re.compile(r"(?<!\w)(Geld)?(Strafe|Strafen)(?!\w)")
SWAP = {"Strafe": "Buße", "Strafen": "Bußen"}
MONEY = re.compile(r"\d[\d.,' ]*\s*(Euro|EUR|€|Franken|CHF|Dollar|US-Dollar|\$|Pfund)\b|"
                   r"\b(zahlen|bezahlen|zahlt|bezahlt|zahlte|bezahlte|gezahlt|bezahlt|kassier\w*|Strafzettel|Knöllchen|"
                   r"Bußgeld\w*|Verwarnungsgeld\w*|in Höhe von)\b")
# punishment that is not money: those Strafen stay Strafen
NOT_FINE = re.compile(r"Freiheits|Haft|Todes|Gefängnis|Jugendstrafe|Bewährung|Jahre[n]? (Haft|Gefängnis)|Peitsch")


# Bußgeld and Verwarnungsgeld are neuter: only where the article says the case
# (and no adjective stands between) can they become the feminine Buße
ARTICLE = {"ein": "eine", "kein": "keine", "das": "die", "dem": "der", "einem": "einer",
           "keinem": "keiner", "des": "der", "eines": "einer", "Ein": "Eine", "Das": "Die", "Kein": "Keine"}
GELD = re.compile(r"(?<!\w)(?:(ein|kein|das|dem|einem|keinem|des|eines|Ein|Das|Kein) )?"
                  r"(Bußgeld|Verwarnungsgeld)(es|s|er|ern)?(?!\w)")


def _geld(m):
    art, _, end = m.groups()
    if end in ("er", "ern"):                # Bußgelder(n): plural, any article fits
        return (m.group(1) + " " if art else "") + "Bußen"
    if not art:                             # case unknown: leave it
        return m.group(0)
    if end and art not in ("des", "eines"):
        return m.group(0)
    return ARTICLE[art] + " Buße"


def fine_sentence(s):
    """The sentence with each money Strafe, and each Bußgeld whose case is
    clear, as Buße; None if there is none."""
    if not (30 <= len(s) <= 260) or len(s.split()) < 5 or "ẞ" in s:
        return None
    out = s
    if WORD.search(s) and MONEY.search(s) and not NOT_FINE.search(s):
        out = WORD.sub(lambda m: (m.group(1) or "") + SWAP[m.group(2)], out)
    if "geld" in out:
        out = GELD.sub(_geld, out)
    return out if out != s else None


def _work(args):
    path, groups = args
    import pyarrow.parquet as pq
    W.init(json.loads((V2 / "settled.json").read_text(encoding="utf-8")))
    f = pq.ParquetFile(path)
    out = {"train": [], "val": [], "test": []}
    for g in groups:
        t = f.read_row_group(g, columns=["url", "text", "language_score"])
        for url, text, score in zip(*(t.column(c).to_pylist() for c in ("url", "text", "language_score"))):
            host = W.host_of(url)
            if host.endswith((".ch", ".li")) or "de-ch" in url.lower() or "de_ch" in url.lower():
                continue
            if score < W.MIN_LANGUAGE_SCORE or ("trafe" not in text and "geld" not in text) or W.against_settled(text):
                continue
            split = W.split_of(host)
            for line in text.split("\n"):
                for s in SENT_SPLIT.split(line):
                    s = fine_sentence(s.strip())
                    if s:
                        out[split].append(s)
    return out


def extract(path):
    import pyarrow.parquet as pq
    groups = list(range(pq.ParquetFile(path).num_row_groups))
    tasks = [(path, groups[i:i + 20]) for i in range(0, len(groups), 20)]
    seen, n = set(), {"train": 0, "val": 0, "test": 0}
    files = {k: open(V2 / f"senses_{k}.txt", "w", encoding="utf-8") for k in n}
    with Pool(14) as pool:
        for k, out in enumerate(pool.imap_unordered(_work, tasks)):
            for split, rows in out.items():
                for r in rows:
                    if r not in seen:
                        seen.add(r); files[split].write(r + "\n"); n[split] += 1
            if k % 20 == 0:
                print(f"{k + 1}/{len(tasks)}", n, flush=True)
    for f in files.values():
        f.close()
    print(n)


BUS = re.compile(r"(?<!\w)Buss(e|en)(?!\w)")


def mix(split):
    """The fines with the web's own buses beside them (Busse, Bussen: ss): with
    fines alone the model began to fine the buses."""
    out = V2 / f"sensesmix_{split}.txt"
    if not out.exists():
        fines = (V2 / f"senses_{split}.txt").read_text(encoding="utf-8").splitlines()
        with open(V2 / f"{split}_web.txt", encoding="utf-8") as f:
            buses = [line.rstrip("\n") for line in f if "Buss" in line and BUS.search(line)]
        out.write_text("".join(s + "\n" for s in fines + buses), encoding="utf-8")
        print(f"  {split}: {len(fines):,} fines, {len(buses):,} bus sentences", flush=True)
    return out



def build(base, split, n, seed=13, source="sensesmix"):
    """n rows (the sentences repeated as needed), alone or in Swiss context:
    fines and buses for training, fines alone to test them."""
    if source == "sensesmix":
        mix(split)
    return C.build(base, split, n, seed, source=source, alone=0.4)


if __name__ == "__main__":
    if sys.argv[1] == "extract":
        extract(sys.argv[2])
    elif sys.argv[1] == "build":
        print(build(sys.argv[2], sys.argv[3], int(sys.argv[4])))
