"""Where two eszett models disagree on a held-out set: the words one gets right
and the other wrong, counted by word, with a few contexts.

    diffmodels.py runs/a/best runs/b/best [test_wiki|test_web|test_buses]
"""
import collections, os, sys
from pathlib import Path

os.environ.setdefault("TORCH_BLAS_PREFER_HIPBLASLT", "0")
HERE = Path(__file__).parent
os.environ.setdefault("HF_HOME", str(HERE / "data" / "hf"))
import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer

import data_v2 as D
from prepare import swissify, decisions

BASE = "distilbert/distilbert-base-german-cased"


@torch.no_grad()
def predictions(path, texts, device):
    tok = AutoTokenizer.from_pretrained(HERE / path)
    model = AutoModelForTokenClassification.from_pretrained(HERE / path).to(device).eval()
    out = []
    for a in range(0, len(texts), 128):
        batch = texts[a:a + 128]
        enc = tok(batch, truncation=True, max_length=128, return_offsets_mapping=True, padding=True, return_tensors="pt")
        offs = enc.pop("offset_mapping")
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
            logits = model(**{k: v.to(device) for k, v in enc.items()}).logits[..., :2].float().cpu()
        for k, text in enumerate(batch):
            starts = {}
            for t, (x, y) in enumerate(offs[k].tolist()):
                for s in range(x, y): starts.setdefault(s, t)
            out.append({s: int(logits[k, starts[s]].argmax()) for s, _ in decisions(text, [False] * len(text)) if s in starts})
    return out


if __name__ == "__main__":
    a, b = sys.argv[1], sys.argv[2]
    name = sys.argv[3] if len(sys.argv) > 3 else "test_wiki"
    sys.stdout.reconfigure(encoding="utf-8")
    lines = (D.V2 / f"{name}.txt").read_text(encoding="utf-8").splitlines()[:20000]
    swiss, origins = zip(*(swissify(s) for s in lines))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    pa, pb = predictions(a, list(swiss), device), predictions(b, list(swiss), device)
    worse, better = collections.Counter(), collections.Counter()
    examples = collections.defaultdict(list)
    for text, origin, x, y in zip(swiss, origins, pa, pb):
        for s, gold in decisions(text, origin):
            if s not in x or s not in y or x[s] == y[s]: continue
            w0 = text.rfind(" ", 0, s) + 1
            w1 = text.find(" ", s); w1 = len(text) if w1 < 0 else w1
            word = text[w0:w1].strip(".,;:!?()\"'")
            if x[s] == gold: worse[word] += 1; examples[word].append(text[max(0, w0 - 60):w1 + 40])
            else: better[word] += 1
    print(f"{name}: {b} wrong where {a} was right: {sum(worse.values())}; the other way: {sum(better.values())}")
    print("worse:", worse.most_common(40))
    print("better:", better.most_common(25))
    for word, _ in worse.most_common(8):
        for e in examples[word][:2]: print(f"  {word}: ...{e}...")
