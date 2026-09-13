"""Names for the eszett model: GermEval 2014, hand-labelled German news and
Wikipedia sentences with people, places, organisations and other names marked.

The extension must not rewrite names: "Herr Weiss" stays Weiss, the
"Heiligen-Geist-Spital" stays a Spital. So the model gets a second job next to
ss/ß, on the same tokens in the same pass: is this word part of a name, and of
which kind. Columns 0-1 of its output stay ss/ß, so the browser code that reads
them is unchanged; columns 2-6 are the name classes.

Sentences are shown to the model in Swiss spelling (ß as ss), as the extension
sees them. "deriv" (deutsche) and "part" (Schweiz-Reise) tags count as not a
name: an adjective from a place name is an ordinary word.
"""
import re
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

HERE = Path(__file__).parent
GERMEVAL = HERE / "data" / "germeval"

# GermEval tag ids (as in the Hugging Face loader) -> O, PER, ORG, LOC, OTH
TAGS = ["O", "B-LOC", "I-LOC", "B-LOCderiv", "I-LOCderiv", "B-LOCpart", "I-LOCpart", "B-ORG", "I-ORG",
        "B-ORGderiv", "I-ORGderiv", "B-ORGpart", "I-ORGpart", "B-OTH", "I-OTH", "B-OTHderiv", "I-OTHderiv",
        "B-OTHpart", "I-OTHpart", "B-PER", "I-PER", "B-PERderiv", "I-PERderiv", "B-PERpart", "I-PERpart"]
CLASSES = ["O", "PER", "ORG", "LOC", "OTH"]
OFFSET = 2                                   # output columns 0-1 are ss/ß
LABELS = {0: "ss", 1: "ß", **{OFFSET + i: "name:" + c for i, c in enumerate(CLASSES)}}


def name_class(tag_id):
    tag = TAGS[tag_id]
    if tag == "O" or tag.endswith(("deriv", "part")):
        return 0
    return CLASSES.index(tag[2:])


NO_SPACE_BEFORE = re.compile(r"^[.,;:!?)\]%]$")
NO_SPACE_AFTER = re.compile(r"^[(\[]$")


def detokenize(tokens):
    """Natural text from GermEval tokens, with each token's character span."""
    text, spans = "", []
    for k, tok in enumerate(tokens):
        if k and not NO_SPACE_BEFORE.match(tok) and not NO_SPACE_AFTER.match(tokens[k - 1]):
            text += " "
        spans.append((len(text), len(text) + len(tok)))
        text += tok
    return text, spans


def encode(split, tok, max_len=128):
    """[(input_ids, labels)] with labels -100 except the name columns' class per token."""
    t = pq.read_table(GERMEVAL / f"{split}.parquet", columns=["tokens", "ner_tags"])
    rows = []
    for tokens, tags in zip(t.column("tokens").to_pylist(), t.column("ner_tags").to_pylist()):
        tokens = [w.replace("ß", "ss") for w in tokens]              # Swiss spelling
        text, spans = detokenize(tokens)
        enc = tok(text, truncation=True, max_length=max_len, return_offsets_mapping=True)
        labels = []
        w = 0
        for a, b in enc["offset_mapping"]:
            if b <= a:
                labels.append(-100); continue                          # [CLS], [SEP]
            while w < len(spans) - 1 and a >= spans[w][1]:
                w += 1
            labels.append(name_class(tags[w]))
        rows.append((np.array(enc["input_ids"], np.int64), np.array(labels, np.int64)))
    return rows


def word_scores(logits_rows, split, tok):
    """Word-level name detection on GermEval: precision/recall of "part of a name"."""
    t = pq.read_table(GERMEVAL / f"{split}.parquet", columns=["tokens", "ner_tags"])
    tp = fp = fn = typed = 0
    for (tokens, tags), logits in zip(zip(t.column("tokens").to_pylist(), t.column("ner_tags").to_pylist()), logits_rows):
        tokens = [w.replace("ß", "ss") for w in tokens]
        text, spans = detokenize(tokens)
        enc = tok(text, truncation=True, max_length=128, return_offsets_mapping=True)
        guess = [0] * len(tokens)
        w = 0
        for k, (a, b) in enumerate(enc["offset_mapping"]):
            if b <= a:
                continue
            while w < len(spans) - 1 and a >= spans[w][1]:
                w += 1
            c = int(np.argmax(logits[k][OFFSET:OFFSET + len(CLASSES)]))
            if c and not guess[w]:
                guess[w] = c
        for g, tag in zip(guess, tags):
            gold = name_class(tag)
            tp += bool(g) and bool(gold); fp += bool(g) and not gold; fn += not g and bool(gold)
            typed += bool(g) and g == gold
    p, r = tp / max(tp + fp, 1), tp / max(tp + fn, 1)
    return {"precision": p, "recall": r, "f1": 2 * p * r / max(p + r, 1e-9), "type_right": typed / max(tp, 1)}


def encode_swap(tok, max_len=128, name_repeat=1):
    """names_swap.py sentences: each word the judge was sure about is supervised.

    Most sentences hold no name at all, so those that do are repeated
    name_repeat times; otherwise the model learns that Swiss text has no names.
    """
    import json
    rows = []
    with open(HERE / "data" / "names" / "swap.jsonl", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            enc = tok(r["text"], truncation=True, max_length=max_len, return_offsets_mapping=True)
            labels = [-100] * len(enc["input_ids"])
            has_name = False
            for a, b, cls in r["labels"]:
                c = CLASSES.index(cls)
                has_name |= c > 0
                for t, (x, y) in enumerate(enc["offset_mapping"]):
                    if y > x and x < b and y > a:
                        labels[t] = c
            if all(l == -100 for l in labels):
                continue
            row = (np.array(enc["input_ids"], np.int64), np.array(labels, np.int64))
            rows.extend([row] * (name_repeat if has_name else 1))
    return rows
