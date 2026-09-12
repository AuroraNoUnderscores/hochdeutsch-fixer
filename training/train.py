"""Fine-tune German DistilBERT to decide, for every "ss" in Swiss text, ss or ß.

A token-classification head on the existing model: one pass per sentence
instead of scoring every candidate spelling separately. A plain PyTorch loop:
AMD's Windows build of torch has no torch.distributed, which Hugging Face's
Trainer (through accelerate) imports unconditionally.
"""
import argparse, json, math, os, random, time
from pathlib import Path

os.environ.setdefault("TORCH_BLAS_PREFER_HIPBLASLT", "0")  # AMD: avoids resets when training on RX 9070
HERE = Path(__file__).parent
os.environ.setdefault("HF_HOME", str(HERE / "data" / "hf"))

import torch
from torch.utils.data import DataLoader
from transformers import (AutoModelForTokenClassification, AutoTokenizer,
                          DataCollatorForTokenClassification, get_linear_schedule_with_warmup)

BASE_MODEL = "distilbert/distilbert-base-german-cased"


def load(split, limit=0):
    rows = []
    with open(HERE / "data" / f"{split}.jsonl", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            rows.append({"input_ids": r["input_ids"], "labels": r["labels"]})
            if limit and len(rows) >= limit:
                break
    return rows


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    right = wrong = 0
    per = {0: [0, 0], 1: [0, 0]}                       # label -> [right, total]
    for batch in loader:
        batch = {k: v.to(device) for k, v in batch.items()}
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
            logits = model(input_ids=batch["input_ids"], attention_mask=batch["attention_mask"]).logits
        mask = batch["labels"] >= 0
        guess, gold = logits.argmax(-1)[mask], batch["labels"][mask]
        right += int((guess == gold).sum()); wrong += int((guess != gold).sum())
        for c in (0, 1):
            sel = gold == c
            per[c][0] += int((guess[sel] == c).sum()); per[c][1] += int(sel.sum())
    model.train()
    total = right + wrong
    return {
        "decisions": total,
        "errors_per_1000": 1000 * wrong / total,
        "recall_eszett": per[1][0] / max(per[1][1], 1),     # ß correctly restored
        "recall_keep_ss": per[0][0] / max(per[0][1], 1),    # ss correctly kept
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="train on the first N sentences (0 = all)")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--out", default="runs/full")
    args = ap.parse_args()

    torch.manual_seed(7); random.seed(7)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("device:", torch.cuda.get_device_name(0) if device.type == "cuda" else "CPU", flush=True)

    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    collate = DataCollatorForTokenClassification(tok)
    train = load("train", args.limit)
    val = load("val")
    train_loader = DataLoader(train, batch_size=args.batch, shuffle=True, collate_fn=collate)
    val_loader = DataLoader(val, batch_size=256, collate_fn=collate)

    model = AutoModelForTokenClassification.from_pretrained(
        BASE_MODEL, num_labels=2, id2label={0: "ss", 1: "ß"}, label2id={"ss": 0, "ß": 1}).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = args.epochs * math.ceil(len(train) / args.batch)
    sched = get_linear_schedule_with_warmup(opt, int(0.05 * steps), steps)

    before = evaluate(model, val_loader, device)
    print(f"untrained: {before['errors_per_1000']:.1f} errors per 1000", flush=True)

    out = HERE / args.out
    best = None
    step, t0 = 0, time.time()
    for epoch in range(args.epochs):
        for batch in train_loader:
            batch = {k: v.to(device) for k, v in batch.items()}
            with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
                loss = model(**batch).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
            step += 1
            if step % 200 == 0:
                rate = step * args.batch / (time.time() - t0)
                print(f"epoch {epoch + 1} step {step}/{steps} loss {loss.item():.4f} ({rate:.0f} sentences/s)", flush=True)
        m = evaluate(model, val_loader, device)
        print(f"epoch {epoch + 1} VAL: {m['errors_per_1000']:.2f} errors/1000 | "
              f"ß restored {m['recall_eszett']:.4f} | ss kept {m['recall_keep_ss']:.4f}", flush=True)
        if best is None or m["errors_per_1000"] < best["errors_per_1000"]:
            best = m
            model.save_pretrained(out / "best"); tok.save_pretrained(out / "best")
            (out / "best" / "val.json").write_text(json.dumps(m, indent=2))
    print(f"done in {(time.time() - t0) / 60:.1f} min, best val {best['errors_per_1000']:.2f} errors/1000", flush=True)


if __name__ == "__main__":
    main()
