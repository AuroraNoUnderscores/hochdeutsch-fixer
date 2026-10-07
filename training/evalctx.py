"""Errors per 1000 ss/ß decisions of trained models, on held-out web sentences
alone and on the same kind of sentences inside Swiss context (swissctx.py),
on Buße as a fine and on Busse as buses (test_buses.txt: the held-out web
sentences with Busse or Bussen).

    evalctx.py runs/full-names/best [runs/other/best ...]
"""
import os, sys
from pathlib import Path

os.environ.setdefault("TORCH_BLAS_PREFER_HIPBLASLT", "0")
HERE = Path(__file__).parent
os.environ.setdefault("HF_HOME", str(HERE / "data" / "hf"))
import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer

import data_v2 as D
import swissctx as C
import senses as S
from train2 import evaluate

BASE = "distilbert/distilbert-base-german-cased"

if __name__ == "__main__":
    sets = {
        "test_web": D.Tokenized(D.build(BASE, "test_web", 20000)),
        "test_wiki": D.Tokenized(D.build(BASE, "test_wiki", 20000)),
        "test_swissctx": D.Tokenized(C.build(BASE, "test", 20000)),
        # Buße as a fine (senses.py), and the buses that must stay Busse
        "test_fines": D.Tokenized(S.build(BASE, "test", 2000, source="senses")),
        "test_buses": D.Tokenized(D.build(BASE, "test_buses")),
    }
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    for path in sys.argv[1:]:
        tok = AutoTokenizer.from_pretrained(HERE / path)
        model = AutoModelForTokenClassification.from_pretrained(HERE / path).to(device)
        m = evaluate(model, sets, tok.pad_token_id, device)
        print(path, {k: round(v, 2) for k, v in m.items()}, flush=True)
