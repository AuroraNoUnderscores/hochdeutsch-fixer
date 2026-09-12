"""Pick the int8 quantization that stays closest to the full-precision model.

Overall accuracy barely moves under quantization, but single borderline
decisions can flip ("die Masse meines Koffers": 0.78 at full precision, 0.38 in
int8). So variants are compared by how often they disagree with the
full-precision model, and by how far their probabilities drift.
"""
import io, json, os, shutil, sys
from pathlib import Path

HERE = Path(__file__).parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
from optimum.exporters.onnx import main_export
from transformers import AutoTokenizer
from prepare import swissify, decisions

SRC = HERE / (sys.argv[1] if len(sys.argv) > 1 else "runs/balanced/best")
WORK = HERE / "export" / "_quant"
N = 3000


def probs(session, tok, rows):
    out = []
    for german in rows:
        swiss, origin = swissify(german)
        enc = tok(swiss, return_offsets_mapping=True, truncation=True, max_length=512, return_tensors="np")
        offs = enc.pop("offset_mapping")[0]
        logits = session.run(None, {i.name: enc[i.name].astype(np.int64) for i in session.get_inputs()})[0][0]
        for start, gold in decisions(swiss, origin):
            t = next((i for i, (a, b) in enumerate(offs) if a <= start < b), None)
            if t is None:
                continue
            e = np.exp(logits[t] - logits[t].max())
            out.append((float(e[1] / e.sum()), gold))
    return np.array(out)


def main():
    if WORK.exists():
        shutil.rmtree(WORK)
    main_export(str(SRC), output=str(WORK / "fp32"), task="token-classification", opset=17)
    fp32 = WORK / "fp32" / "model.onnx"
    tok = AutoTokenizer.from_pretrained(str(WORK / "fp32"))
    rows = [json.loads(l)["german"] for _, l in zip(range(N), open(HERE / "data" / "test.jsonl", encoding="utf-8"))]

    # nodes feeding the classification head and the last transformer block
    names = [n.name for n in onnx.load(str(fp32)).graph.node if n.op_type in ("MatMul", "Gemm")]
    last_block = [n for n in names if "layer.5" in n or "classifier" in n]

    variants = {
        "per-tensor (current)": dict(),
        "per-channel": dict(per_channel=True),
        "per-channel, last block + head fp32": dict(per_channel=True, nodes_to_exclude=last_block),
    }
    sess = lambda p: ort.InferenceSession(str(p), providers=["CPUExecutionProvider"])
    ref = probs(sess(fp32), tok, rows)
    print(f"fp32 reference: {fp32.stat().st_size / 2**20:.0f} MB, "
          f"{1000 * np.mean((ref[:, 0] >= 0.5) != ref[:, 1]):.2f} errors per 1000 on {len(ref)} decisions")

    for label, kw in variants.items():
        path = WORK / f"{label.split()[0].strip(',')}-{len(kw)}.onnx"
        quantize_dynamic(str(fp32), str(path), weight_type=QuantType.QInt8, **kw)
        q = probs(sess(path), tok, rows)
        flips = int(np.sum((q[:, 0] >= 0.5) != (ref[:, 0] >= 0.5)))
        drift = float(np.mean(np.abs(q[:, 0] - ref[:, 0])))
        errs = 1000 * np.mean((q[:, 0] >= 0.5) != q[:, 1])
        print(f"{label:38} {path.stat().st_size / 2**20:5.0f} MB  flips vs fp32: {flips:3}  "
              f"mean |Δp| {drift:.4f}  errors {errs:.2f}/1000")


if __name__ == "__main__":
    main()
