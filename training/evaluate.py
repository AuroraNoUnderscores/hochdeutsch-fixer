"""Grade the fine-tuned model on text it never saw.

1. Held-out Wikipedia articles (data/test.jsonl).
2. The 44 notes of the test artifact against its answer key, aligned word by
   word so that vocabulary swaps elsewhere in a sentence do not confuse the
   scoring. Only ss/ß decisions are graded; that is all this model decides.
"""
import difflib, io, json, os, re, sys
from pathlib import Path

HERE = Path(__file__).parent
os.environ.setdefault("HF_HOME", str(HERE / "data" / "hf"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer
from prepare import swissify, decisions

WORD = re.compile(r"\w+", re.U)


def load_corpus():
    """dev/corpus.js -> [(swiss, expected)] without running JavaScript."""
    src = (HERE.parent / "dev" / "corpus.js").read_text(encoding="utf-8")
    body = src[src.index("= [") + 2:src.rindex("]") + 1]
    body = re.sub(r"//[^\n]*", "", body)                        # comments
    body = body.replace("\\'", "@@APOS@@").replace('"', '\\"')  # protect quotes
    body = body.replace("'", '"').replace("@@APOS@@", "'")
    body = re.sub(r",(\s*\])", r"\1", body)                     # trailing commas
    return [(row[0], row[1]) for row in json.loads(body)]


class Model:
    def __init__(self, path):
        self.tok = AutoTokenizer.from_pretrained(path)
        self.model = AutoModelForTokenClassification.from_pretrained(path).eval()
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)

    @torch.no_grad()
    def predict(self, swiss):
        """{char offset of each ss pair: probability that it is ß}"""
        enc = self.tok(swiss, return_offsets_mapping=True, truncation=True, max_length=256, return_tensors="pt")
        offsets = enc.pop("offset_mapping")[0].tolist()
        logits = self.model(**{k: v.to(self.device) for k, v in enc.items()}).logits[0]
        prob = torch.softmax(logits.float(), -1)[:, 1].tolist()
        out = {}
        for start, _ in decisions(swiss, [False] * len(swiss)):
            for t, (a, b) in enumerate(offsets):
                if a <= start < b:
                    out[start] = prob[t]
                    break
        return out


def grade_wikipedia(m, limit=8000):
    right = wrong = 0
    errors = []
    with open(HERE / "data" / "test.jsonl", encoding="utf-8") as f:
        for n, line in enumerate(f):
            if n >= limit:
                break
            r = json.loads(line)
            swiss, origin = swissify(r["german"])
            p = m.predict(swiss)
            for start, gold in decisions(swiss, origin):
                if start not in p:
                    continue
                ok = (p[start] >= 0.5) == bool(gold)
                right += ok
                wrong += not ok
                if not ok and len(errors) < 12:
                    ctx = swiss[max(0, start - 30):start + 30].replace("\n", " ")
                    errors.append(f"{'ß' if gold else 'ss'} expected, p(ß)={p[start]:.2f}: ...{ctx}...")
    return right, wrong, errors


def grade_notes(m):
    rows, right, wrong = [], 0, 0
    for swiss, expected in load_corpus():
        sw = [(mt.group(), mt.start()) for mt in WORD.finditer(swiss)]
        ex = WORD.findall(expected)
        matcher = difflib.SequenceMatcher(a=[w for w, _ in sw], b=[swissify(w)[0] for w in ex], autojunk=False)
        p = m.predict(swiss)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag != "equal":
                continue
            for k in range(i2 - i1):
                word, at = sw[i1 + k]
                s_word, origin = swissify(ex[j1 + k])
                for rel, gold in decisions(s_word, origin):
                    prob = p.get(at + rel)
                    if prob is None:
                        continue
                    ok = (prob >= 0.5) == bool(gold)
                    right += ok
                    wrong += not ok
                    rows.append(f"{'ok   ' if ok else 'WRONG'} {word:14} -> {'ß' if prob >= 0.5 else 'ss'}"
                                f"  (p(ß)={prob:.2f}, key says {'ß' if gold else 'ss'})")
    return right, wrong, rows


if __name__ == "__main__":
    path = HERE / (sys.argv[1] if len(sys.argv) > 1 else "runs/full/best")
    m = Model(path)
    r, w, errs = grade_wikipedia(m)
    print(f"held-out Wikipedia: {w} errors in {r + w} decisions = {1000 * w / (r + w):.2f} per 1000")
    for e in errs:
        print("   ", e)
    r, w, rows = grade_notes(m)
    print(f"\nyour 44 notes: {r}/{r + w} ss/ß decisions right")
    for row in rows:
        print("   ", row)
