"""How well a model with names (train2.py --ner) protects them.

1. GermEval 2014 test split, word by word: precision and recall of "part of a name".
2. The dictionary's Swiss words as found on .de and .ch pages (names_extract.py).
   On .de pages they are mostly names (Heilig-Geist-Spital, Lucie Poulet) and
   should be kept; on .ch pages mostly ordinary words and should still change.
   The share flagged as a name on each side, and examples of both kinds of miss.
   Only words that are really Swiss count: per page at least SWISS_RATIO times
   as common on .ch as on .de. Store, Match or "am Rande" are ordinary German too.

3. A fixed random sample of 200 of those occurrences, labelled by hand as name or
   not (data/names/hand_sample.json; never used for training): precision and
   recall of keeping a Swiss word because it is part of a name.

Usage: names_eval.py runs/x/best [more runs]
"""
import json, random, sys
from pathlib import Path

HERE = Path(__file__).parent
import data_v2 as D   # sets HF_HOME
import numpy as np
import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer
from evaluate import grade_notes   # noqa: F401  (switches stdout to UTF-8)
import names_data as N

MIN = 0.5
SWISS_RATIO = 5


@torch.no_grad()
def logits_for(model, tok, texts, batch=128):
    out = []
    for a in range(0, len(texts), batch):
        enc = tok(texts[a:a + batch], return_offsets_mapping=True, truncation=True, max_length=256,
                  padding=True, return_tensors="pt")
        offs = enc.pop("offset_mapping").tolist()
        with torch.autocast("cuda", dtype=torch.bfloat16):
            lg = model(**{k: v.to("cuda") for k, v in enc.items()}).logits.float().cpu().numpy()
        out += list(zip(lg, offs))
    return out


def span_name(lg, offs, a, b):
    best = (0.0, "O")
    for t, (x, y) in enumerate(offs):
        if y <= x or y <= a or x >= b:
            continue
        z = lg[t][N.OFFSET:N.OFFSET + len(N.CLASSES)]
        e = np.exp(z - z.max()); e /= e.sum()
        p = 1 - e[0]
        if p > best[0]:
            best = (float(p), N.CLASSES[1 + int(np.argmax(e[1:]))])
    return best


def main(paths):
    counts = json.loads((HERE / "data" / "names" / "counts.json").read_text(encoding="utf-8"))
    rate = lambda side, k: counts["words"][side].get(k, 0) / counts["pages"][side]
    swiss = {k for k in counts["words"]["ch"] if rate("ch", k) >= SWISS_RATIO * max(rate("de", k), 1e-9)}
    print(f"{len(swiss)} really Swiss words, e.g. {sorted(swiss)[:25]}")
    samples = {side: [r for r in map(json.loads, open(HERE / "data" / "names" / f"{side}.jsonl", encoding="utf-8"))
                      if r["key"] in swiss]
               for side in ("de", "ch")}
    rng = random.Random(1)
    for path in paths:
        tok = AutoTokenizer.from_pretrained(HERE / path)
        model = AutoModelForTokenClassification.from_pretrained(HERE / path).eval().to("cuda")
        print(f"== {path}")
        # GermEval test
        rows = N.encode("test", tok)
        lg = []
        for a in range(0, len(rows), 128):
            chunk = rows[a:a + 128]
            ids, mask, _ = (torch.from_numpy(x).to("cuda") for x in D.collate(chunk, tok.pad_token_id))
            with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
                out = model(input_ids=ids, attention_mask=mask).logits.float().cpu().numpy()
            lg += [out[k, :len(chunk[k][0])] for k in range(len(chunk))]
        s = N.word_scores(lg, "test", tok)
        print(f"GermEval test: F1 {s['f1']:.3f}  precision {s['precision']:.3f}  recall {s['recall']:.3f}  "
              f"kind right {s['type_right']:.3f}")
        # hand-labelled sample
        hand = [r for r in json.loads((HERE / "data" / "names" / "hand_sample.json").read_text(encoding="utf-8"))
                if r["name"] is not None]
        texts = [r["sentence"].replace("ß", "ss") for r in hand]
        tp = fp = fn = 0
        misses = []
        for r, (l, o), text in zip(hand, logits_for(model, tok, texts), texts):
            a = text.find(r["word"].replace("ß", "ss"))
            p, kind = span_name(l, o, a, a + len(r["word"]))
            said = p > MIN
            tp += said and r["name"]; fp += said and not r["name"]; fn += not said and r["name"]
            if said != r["name"]:
                misses.append(f"{'kept, is no name' if said else 'changed, is a name'}: {p:.2f} {r['word']} | "
                              f"{text[max(0, a - 50):a + 40]}")
        print(f"hand-labelled sample ({len(hand)}, {tp + fn} names): precision {tp / max(tp + fp, 1):.2f} "
              f"recall {tp / max(tp + fn, 1):.2f}  ({tp} kept rightly, {fp} kept wrongly, {fn} names changed)")
        for m in misses:
            print("     ", m)
        # Swiss words on .de / .ch pages
        for side, rows in samples.items():
            texts = [r["sentence"].replace("ß", "ss") for r in rows]
            res = logits_for(model, tok, texts)
            flagged, kinds, examples = 0, {}, {True: [], False: []}
            for r, (l, o), text in zip(rows, res, texts):
                a = text.find(r["word"].replace("ß", "ss"))
                p, kind = span_name(l, o, a, a + len(r["word"]))
                hit = p > MIN
                flagged += hit
                if hit:
                    kinds[kind] = kinds.get(kind, 0) + 1
                examples[hit].append(f"{p:.2f} {kind:3} {r['word']:14} | {text[max(0, a - 50):a + 50]}")
            print(f".{side}: {flagged}/{len(rows)} = {flagged / len(rows):.1%} of Swiss words marked as names {kinds}")
            for hit in (True, False):
                picks = rng.sample(examples[hit], min(10, len(examples[hit])))
                print(f"   {'marked' if hit else 'not marked'}:")
                for e in picks:
                    print("     ", e)
        del model; torch.cuda.empty_cache()


if __name__ == "__main__":
    main(sys.argv[1:])
