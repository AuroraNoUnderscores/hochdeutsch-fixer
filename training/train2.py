"""Train the eszett model on Wikipedia plus web text, for any base model.

Like train.py (a plain PyTorch loop, bf16, AMD-friendly), but the data is
memory-mapped (data_v2.py) so tens of millions of sentences fit, and it grades
on held-out Wikipedia and held-out websites separately while training, because
a model can get better at one register and worse at the other.

With --ner the same model also learns to mark names (names_data.py): output
columns 0-1 stay ss/ß, columns 2-6 say whether a token belongs to a person,
organisation, place or other name. A batch of names joins the ss/ß batch every
--ner-every steps, so both jobs share one encoder and one pass in the browser.
With --swap, batches of web sentences whose German noun was replaced by its Swiss
synonym (names_swap.py) join too, so Swiss words are not mistaken for names.
"""
import argparse, json, math, os, random, time
from pathlib import Path

os.environ.setdefault("TORCH_BLAS_PREFER_HIPBLASLT", "0")  # AMD: avoids resets when training on RX 9070
HERE = Path(__file__).parent
os.environ.setdefault("HF_HOME", str(HERE / "data" / "hf"))

import numpy as np
import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer, get_linear_schedule_with_warmup

import data_v2 as D
import names_data as N


@torch.no_grad()
def evaluate(model, sets, pad_id, device, batch=256):
    model.eval()
    out = {}
    for name, ds in sets.items():
        right = wrong = 0
        for a in range(0, len(ds), batch):
            ids, mask, labels = (torch.from_numpy(x).to(device) for x in
                                 D.collate([ds.row(i) for i in range(a, min(a + batch, len(ds)))], pad_id))
            with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
                logits = model(input_ids=ids, attention_mask=mask).logits[..., :2]
            sel = labels >= 0
            ok = logits.argmax(-1)[sel] == labels[sel]
            right += int(ok.sum()); wrong += int((~ok).sum())
        out[name] = 1000 * wrong / max(right + wrong, 1)
    model.train()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="distilbert/distilbert-base-german-cased")
    ap.add_argument("--web", type=int, default=0, help="web training sentences (0 = all)")
    ap.add_argument("--wiki", type=int, default=0, help="Wikipedia training sentences (0 = all)")
    ap.add_argument("--no-balance", action="store_true")
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--eval-every", type=int, default=20_000)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tokenize-only", action="store_true")
    ap.add_argument("--ner", action="store_true", help="also learn to mark names (GermEval 2014)")
    ap.add_argument("--ner-every", type=int, default=20)
    ap.add_argument("--ner-batch", type=int, default=32)
    ap.add_argument("--swap", action="store_true", help="also names batches of swapped Swiss words")
    ap.add_argument("--swap-name-repeat", type=int, default=10)
    ap.add_argument("--para", type=int, default=0, help="also this many multi-sentence web passages (para.py)")
    ap.add_argument("--init", help="continue from this checkpoint instead of the base model")
    args = ap.parse_args()

    torch.manual_seed(7); random.seed(7)
    out = HERE / args.out
    out.mkdir(parents=True, exist_ok=True)

    repeat = None
    if not args.no_balance:
        repeat, _ = D.repeat_factors([D.V2 / "train_web.txt", D.V2 / "train_wiki.txt"], [args.web, args.wiki])
        print(f"balance: {len(repeat)} ambiguous spellings get repeated", flush=True)
    train = [D.Tokenized(D.build(args.base, "train_web", args.web, repeat)),
             D.Tokenized(D.build(args.base, "train_wiki", args.wiki, repeat))]
    val = {n: D.Tokenized(D.build(args.base, n, 8000)) for n in ("val_wiki", "val_web")}
    if args.para:
        # passages of consecutive sentences, as the extension reads a page
        train.append(D.Tokenized(D.build(args.base, "train_webpara", args.para, None, max_len=384)))
        val["val_webpara"] = D.Tokenized(D.build(args.base, "val_webpara", 3000, None, max_len=384))
    if args.tokenize_only:
        return

    # one index over both sources: (source, row), repeated for balancing
    index = np.concatenate([np.stack([np.full(len(t), s, np.int64),
                                      np.arange(len(t), dtype=np.int64)], 1).repeat(t.repeats.astype(np.int64), 0)
                            for s, t in enumerate(train)])
    print(f"train: {', '.join(f'{len(t):,}' for t in train)} rows (web, wiki{', passages' if args.para else ''}); "
          f"{len(index):,} rows per epoch after balancing", flush=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("device:", torch.cuda.get_device_name(0) if device.type == "cuda" else "CPU", flush=True)
    tok = AutoTokenizer.from_pretrained(args.base)
    columns = N.LABELS if args.ner else {0: "ss", 1: "ß"}
    model = AutoModelForTokenClassification.from_pretrained(
        HERE / args.init if args.init else args.base,
        num_labels=len(columns), id2label=columns, label2id={v: k for k, v in columns.items()}).to(device)
    ce = torch.nn.CrossEntropyLoss(ignore_index=-100)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = int(args.epochs * len(index) / args.batch)
    sched = get_linear_schedule_with_warmup(opt, int(0.03 * steps), steps)
    if args.ner:
        ner_train, ner_val = N.encode("train", tok), N.encode("validation", tok)
        print(f"names: {len(ner_train):,} training sentences, one batch every {args.ner_every} steps "
              f"(~{steps // args.ner_every * args.ner_batch / len(ner_train):.1f} passes)", flush=True)
        swap_train = N.encode_swap(tok, name_repeat=args.swap_name_repeat) if args.swap else []
        if swap_train:
            print(f"swapped Swiss words: {len(swap_train):,} sentences, one batch every {args.ner_every} steps "
                  f"(~{steps // args.ner_every * args.ner_batch / len(swap_train):.1f} passes)", flush=True)

    rng = np.random.default_rng(7)
    ner_order, swap_order = [], []
    best, step, t0 = None, 0, time.time()
    log = []

    @torch.no_grad()
    def ner_scores():
        model.eval()
        rows = []
        for a in range(0, len(ner_val), 128):
            chunk = ner_val[a:a + 128]
            ids, mask, _ = (torch.from_numpy(x).to(device) for x in D.collate(chunk, tok.pad_token_id))
            with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
                logits = model(input_ids=ids, attention_mask=mask).logits.float().cpu().numpy()
            rows += [logits[k, :len(chunk[k][0])] for k in range(len(chunk))]
        model.train()
        return N.word_scores(rows, "validation", tok)

    def names_batch(rows, order):
        if len(order) < args.ner_batch:
            order[:] = list(rng.permutation(len(rows)))
        pick = order[:args.ner_batch]
        del order[:args.ner_batch]
        return D.collate([rows[i] for i in pick], tok.pad_token_id)

    def checkpoint():
        nonlocal best
        m = evaluate(model, val, tok.pad_token_id, device)
        m["mean"] = sum(v for k, v in m.items() if k.startswith("val_")) / sum(k.startswith("val_") for k in m)
        m["step"] = step
        if args.ner:
            m["names"] = ner_scores()
        log.append(m)
        mark = ""
        if best is None or m["mean"] < best["mean"]:
            best = m; mark = "  (best, saved)"
            model.save_pretrained(out / "best"); tok.save_pretrained(out / "best")
            (out / "best" / "val.json").write_text(json.dumps(m, indent=2))
        print(f"step {step}/{steps} VAL wiki {m['val_wiki']:.2f} web {m['val_web']:.2f} "
              + (f"passages {m['val_webpara']:.2f} " if "val_webpara" in m else "")
              + 
              f"mean {m['mean']:.2f} errors/1000"
              + (f" | names F1 {m['names']['f1']:.3f} (P {m['names']['precision']:.3f} R {m['names']['recall']:.3f})" if args.ner else "")
              + mark, flush=True)
        (out / "log.json").write_text(json.dumps(log, indent=2))

    while step < steps:
        order = index[rng.permutation(len(index))]
        for a in range(0, len(order) - args.batch + 1, args.batch):
            rows = [train[s].row(i) for s, i in order[a:a + args.batch]]
            ids, mask, labels = (torch.from_numpy(x).to(device, non_blocking=True)
                                 for x in D.collate(rows, tok.pad_token_id))
            with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
                logits = model(input_ids=ids, attention_mask=mask).logits
                loss = ce(logits[..., :2].float().flatten(0, 1), labels.flatten())
            if args.ner and step % args.ner_every == 0:
                batches = [names_batch(ner_train, ner_order)]
                if args.swap:
                    batches.append(names_batch(swap_train, swap_order))
                for batch in batches:
                    n_ids, n_mask, n_labels = (torch.from_numpy(x).to(device) for x in batch)
                    with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
                        n_logits = model(input_ids=n_ids, attention_mask=n_mask).logits[..., N.OFFSET:]
                        loss = loss + ce(n_logits.float().flatten(0, 1), n_labels.flatten())
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
            step += 1
            if step % 500 == 0:
                rate = step * args.batch / (time.time() - t0)
                eta = (steps - step) * args.batch / rate / 60
                print(f"step {step}/{steps} loss {loss.item():.4f} ({rate:.0f} sentences/s, {eta:.0f} min left)", flush=True)
            if step % args.eval_every == 0:
                checkpoint()
            if step >= steps:
                break
    checkpoint()
    print(f"done in {(time.time() - t0) / 60:.1f} min, best mean val {best['mean']:.2f} at step {best['step']}", flush=True)


if __name__ == "__main__":
    main()
