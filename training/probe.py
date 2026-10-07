"""Ask a trained eszett model about single texts: for every "ss", how likely it
is ß, and for every word, how likely it is part of a name.

    probe.py runs/full-names/best "Grosse Teile des Spitals wurden renoviert."
"""
import os, sys
from pathlib import Path

os.environ.setdefault("TORCH_BLAS_PREFER_HIPBLASLT", "0")
HERE = Path(__file__).parent
os.environ.setdefault("HF_HOME", str(HERE / "data" / "hf"))
import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer
from prepare import decisions


def load(path):
    tok = AutoTokenizer.from_pretrained(HERE / path)
    model = AutoModelForTokenClassification.from_pretrained(HERE / path).eval()
    return tok, model


@torch.no_grad()
def ss_probs(tok, model, text):
    enc = tok(text, return_offsets_mapping=True, truncation=True, max_length=256, return_tensors="pt")
    offs = enc.pop("offset_mapping")[0].tolist()
    p = model(**enc).logits[0].float().softmax(-1)
    out = []
    for start, _ in decisions(text, [False] * len(text)):
        t = next(t for t, (a, b) in enumerate(offs) if a <= start < b)
        w0 = text.rfind(" ", 0, start) + 1
        w1 = text.find(" ", start); w1 = len(text) if w1 < 0 else w1
        two = p[t, :2] / p[t, :2].sum()
        out.append((text[w0:w1], round(float(two[1]), 3)))
    return out


if __name__ == "__main__":
    tok, model = load(sys.argv[1])
    for text in sys.argv[2:]:
        print(ss_probs(tok, model, text), "|", text)
