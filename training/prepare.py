"""Build the ss/ß training data from German Wikipedia, with no hand-labelling.

German text from Germany spells ß correctly. Turning every ß into ss produces
exactly the ambiguous Swiss input the extension sees, and the original tells us
the answer. Each non-overlapping "ss" in the Swiss text becomes a decision:
label 1 if it came from ß, label 0 if it was ss all along.

Articles are split, not sentences, so no article appears in both train and test.
"""
import hashlib, json, os, random, re
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"
os.environ.setdefault("HF_HOME", str(DATA / "hf"))  # keep every download inside training/

import pyarrow.parquet as pq
from huggingface_hub import hf_hub_download
from transformers import AutoTokenizer

BASE_MODEL = "distilbert/distilbert-base-german-cased"
SHARD = "20231101.de/train-00005-of-00020.parquet"
MAX_LEN = 128
LIMITS = {"train": 1_300_000, "val": 8_000, "test": 8_000}
MAX_REPEAT = 8      # most a minority-spelling sentence is repeated
MIN_MINORITY = 10   # below this many real examples, repeating would only memorise

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ\"„])|\n+")


def swissify(text):
    """Swiss spelling of a German text, plus which characters came from ß."""
    out, from_eszett = [], []
    for ch in text:
        if ch == "ß":
            out += ["s", "s"]; from_eszett += [True, True]
        else:
            out.append(ch); from_eszett.append(False)
    return "".join(out), from_eszett


def decisions(swiss, from_eszett):
    """Non-overlapping "ss" pairs in the Swiss text, with their true spelling."""
    found, i = [], 0
    while i < len(swiss) - 1:
        if swiss[i] == "s" and swiss[i + 1] == "s":
            found.append((i, 1 if from_eszett[i] else 0)); i += 2
        else:
            i += 1
    return found


SS_WORD = re.compile(r"\w*(?:ss|ß)\w*")


def balance(rows):
    """Repeat sentences carrying the rarer spelling of an ambiguous word form.

    An encyclopedia says "Masse" (mass) far more often than "Maße"
    (measurements), so a model can score well by always guessing the common
    spelling. Every Swiss form that occurs with both spellings gets its minority
    spelling repeated towards parity, which leaves context as the only way to
    tell them apart. Computed from the data; no word is singled out by hand.
    """
    counts = {}
    for r in rows:
        for w in SS_WORD.findall(r["german"]):
            c = counts.setdefault(w.replace("ß", "ss").lower(), [0, 0])
            c[1 if "ß" in w else 0] += 1
    repeat = {}
    for form, (ss, ez) in counts.items():
        minority, majority = min(ss, ez), max(ss, ez)
        if minority >= MIN_MINORITY and majority > minority:
            factor = min(MAX_REPEAT, round(majority / minority))
            if factor > 1:
                repeat[(form, 1 if ez < ss else 0)] = factor
    out, extra = [], 0
    for r in rows:
        n = 1
        for w in SS_WORD.findall(r["german"]):
            n = max(n, repeat.get((w.replace("ß", "ss").lower(), 1 if "ß" in w else 0), 1))
        out.extend([r] * n)
        extra += n - 1
    print(f"balance: {len(repeat)} ambiguous forms upsampled, {extra:,} repeated sentences added")
    return out


# Words German always spells with ß. An article that writes several of them with
# ss and never uses ß is in Swiss spelling (German Wikipedia has many about
# Switzerland), and every label taken from it would teach the model that ss is
# right where German wants ß.
SWISS_SPELLED = re.compile(
    r"\b(?:Strasse|Strassen|gross|grosse|grossen|grosser|grosses|Grösse|heisst|heissen|hiess|"
    r"weiss|Fuss|ausser|ausserdem|draussen|bloss|Spass|Grüsse|schliesslich|gemäss|mässig|"
    r"regelmässig|Massnahme|Massnahmen|liess|fliesst)\b")


def swiss_spelled(text):
    return "ß" not in text and len(SWISS_SPELLED.findall(text)) >= 2


def split_of(article_id):
    bucket = int(hashlib.md5(article_id.encode()).hexdigest(), 16) % 100
    return "test" if bucket < 2 else "val" if bucket < 4 else "train"


def main():
    DATA.mkdir(exist_ok=True)
    path = hf_hub_download("wikimedia/wikipedia", SHARD, repo_type="dataset", cache_dir=DATA / "hf")
    tok = AutoTokenizer.from_pretrained(BASE_MODEL, cache_dir=DATA / "hf")

    rows = {k: [] for k in LIMITS}
    counts = {k: [0, 0] for k in LIMITS}          # [ss kept, came from ß]
    table = pq.read_table(path, columns=["id", "text"])
    rng = random.Random(7)
    skipped_swiss = 0

    for batch in table.to_batches(max_chunksize=2000):
        for aid, text in zip(batch.column("id").to_pylist(), batch.column("text").to_pylist()):
            split = split_of(aid)
            if len(rows[split]) >= LIMITS[split]:
                continue
            if swiss_spelled(text):
                skipped_swiss += 1
                continue
            for sent in SENT_SPLIT.split(text):
                sent = sent.strip()
                if not (25 <= len(sent) <= 300) or ("ß" not in sent and "ss" not in sent):
                    continue
                if sent.isupper() or "ẞ" in sent:
                    continue
                swiss, origin = swissify(sent)
                pairs = decisions(swiss, origin)
                if not pairs:
                    continue
                enc = tok(swiss, truncation=True, max_length=MAX_LEN, return_offsets_mapping=True)
                labels = [-100] * len(enc["input_ids"])
                for start, label in pairs:
                    for t, (a, b) in enumerate(enc["offset_mapping"]):
                        if a <= start < b:
                            # two decisions inside one token that disagree: skip it
                            labels[t] = label if labels[t] in (-100, label) else -2
                            break
                labels = [-100 if l == -2 else l for l in labels]
                if all(l == -100 for l in labels):
                    continue
                rows[split].append({"input_ids": enc["input_ids"], "labels": labels,
                                    "swiss": swiss, "german": sent})
                for l in labels:
                    if l >= 0: counts[split][l] += 1
                if len(rows[split]) >= LIMITS[split]:
                    break
        if all(len(rows[k]) >= LIMITS[k] for k in LIMITS):
            break

    print(f"skipped {skipped_swiss:,} articles written in Swiss spelling")
    rows["train"] = balance(rows["train"])

    for split, items in rows.items():
        rng.shuffle(items)
        with open(DATA / f"{split}.jsonl", "w", encoding="utf-8") as f:
            for r in items:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        kept, eszett = counts[split]
        print(f"{split:5} {len(items):7} sentences  {kept:7} ss-stays  {eszett:7} ss-was-ß")


if __name__ == "__main__":
    main()
