"""Grade eszett models side by side on text none of them trained on.

- held-out Wikipedia articles
- held-out websites (never the same site as in training)
- held-out passages of three consecutive sentences from those sites (para.py),
  as the extension reads a page
- ambiguous forms only, in both: words that occur with both spellings in the
  training data (Masse/Maße, Schoss/Schoß, ...), where the model must read context
- the 44 notes of the test artifact against its answer key

Usage: evaluate2.py runs/balanced/best runs/web-distil/best ...
"""
import io, json, re, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
import data_v2 as D   # sets HF_HOME

import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer
from prepare import swissify, decisions
from evaluate import grade_notes   # also switches stdout to UTF-8

LIMIT = {"test_wiki": 8000, "test_web": 20000, "test_webpara": 6000}


class Model:
    def __init__(self, path):
        self.tok = AutoTokenizer.from_pretrained(path)
        self.model = AutoModelForTokenClassification.from_pretrained(path).eval().to("cuda")

    @torch.no_grad()
    def predict_many(self, texts, batch=128):
        out = []
        for a in range(0, len(texts), batch):
            chunk = texts[a:a + batch]
            enc = self.tok(chunk, return_offsets_mapping=True, truncation=True, max_length=512,
                           padding=True, return_tensors="pt")
            offsets = enc.pop("offset_mapping").tolist()
            with torch.autocast("cuda", dtype=torch.bfloat16):
                logits = self.model(**{k: v.to("cuda") for k, v in enc.items()}).logits
            probs = torch.softmax(logits[..., :2].float(), -1)[..., 1].tolist()   # columns 0-1 are ss/ß
            for text, offs, prob in zip(chunk, offsets, probs):
                p = {}
                for start, _ in decisions(text, [False] * len(text)):
                    for t, (x, y) in enumerate(offs):
                        if x <= start < y:
                            p[start] = prob[t]; break
                out.append(p)
        return out

    def predict(self, text):
        return self.predict_many([text])[0]


def ambiguous_forms():
    cache = D.V2 / "ambiguous_forms.json"
    if cache.exists():
        return set(json.loads(cache.read_text(encoding="utf-8")))
    _, counts = D.repeat_factors([D.V2 / "train_web.txt", D.V2 / "train_wiki.txt"], [0, 0])
    # both spellings really used: 10+ each, and the rarer one is not just noise (>= 3%)
    forms = sorted({f for f, _ in counts
                    if min(counts[(f, 0)], counts[(f, 1)]) >= max(10, 0.03 * (counts[(f, 0)] + counts[(f, 1)]))})
    cache.write_text(json.dumps(forms, ensure_ascii=False), encoding="utf-8")
    return set(forms)


def load(name):
    with open(D.V2 / f"{name}.txt", encoding="utf-8") as f:
        return [line.rstrip("\n") for _, line in zip(range(LIMIT[name]), f)]


def grade(m, sentences, forms):
    swiss = [swissify(s) for s in sentences]
    probs = m.predict_many([s for s, _ in swiss])
    tally = Counter()
    wrong_amb = Counter()
    for (text, origin), p in zip(swiss, probs):
        words = [(w.start(), w.end(), w.group().lower()) for w in re.finditer(r"\w+", text)]
        for start, gold in decisions(text, origin):
            if start not in p:
                continue
            ok = (p[start] >= 0.5) == bool(gold)
            form = next((w for a, b, w in words if a <= start < b), None)
            tally["all"] += 1; tally["all_wrong"] += not ok
            if form in forms:
                tally["amb"] += 1; tally["amb_wrong"] += not ok
                if not ok:
                    wrong_amb[form] += 1
    return tally, wrong_amb


def main(paths):
    forms = ambiguous_forms()
    sets = {n: load(n) for n in LIMIT}
    print(f"{len(forms):,} ambiguous forms; " + ", ".join(f"{n}: {len(s):,} sentences" for n, s in sets.items()))
    header = f"{'model':28} {'wiki':>7} {'wiki amb':>9} {'web':>7} {'web amb':>8} {'passages':>9} {'pass amb':>9} {'notes':>6}"
    rows = []
    for path in paths:
        m = Model(HERE / path)
        cells, worst = [], Counter()
        for name, sents in sets.items():
            t, w = grade(m, sents, forms)
            cells += [1000 * t["all_wrong"] / t["all"], 1000 * t["amb_wrong"] / t["amb"]]
            worst.update(w)
        r, w, notes = grade_notes(m)
        rows.append(f"{path:28} {cells[0]:7.2f} {cells[1]:9.2f} {cells[2]:7.2f} {cells[3]:8.2f} "
                    f"{cells[4]:9.2f} {cells[5]:9.2f} {r:>3}/{r + w}")
        print(rows[-1], flush=True)
        print("   most missed ambiguous forms:", ", ".join(f"{f} {n}" for f, n in worst.most_common(12)))
        for line in notes:
            if line.startswith("WRONG"):
                print("   notes:", line)
        del m; torch.cuda.empty_cache()
    print("\nerrors per 1000 decisions (amb = ambiguous forms only)\n" + header)
    print("\n".join(rows))


if __name__ == "__main__":
    main(sys.argv[1:])
