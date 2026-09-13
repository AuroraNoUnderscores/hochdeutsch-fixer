"""Export the fine-tuned model for the browser and check it survived.

ONNX export, int8 dynamic quantization (the same format the extension already
loads through transformers.js), then the quantized model is graded again on
held-out text with onnxruntime: quantization can cost accuracy, and what ships
is the quantized file, not the PyTorch checkpoint.
"""
import io, json, os, shutil, sys
from pathlib import Path

HERE = Path(__file__).parent
os.environ.setdefault("HF_HOME", str(HERE / "data" / "hf"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
from optimum.exporters.onnx import main_export
from transformers import AutoTokenizer
from prepare import swissify, decisions

SRC = HERE / (sys.argv[1] if len(sys.argv) > 1 else "runs/balanced/best")
OUT = HERE / "export" / "hdfx-eszett"


def grade(session, tok, limit=8000):
    right = wrong = 0
    with open(HERE / "data" / "test.jsonl", encoding="utf-8") as f:
        for n, line in enumerate(f):
            if n >= limit:
                break
            german = json.loads(line)["german"]
            swiss, origin = swissify(german)
            enc = tok(swiss, return_offsets_mapping=True, truncation=True, max_length=256, return_tensors="np")
            offsets = enc.pop("offset_mapping")[0]
            feed = {i.name: enc[i.name].astype(np.int64) for i in session.get_inputs()}
            logits = session.run(None, feed)[0][0]
            for start, gold in decisions(swiss, origin):
                for t, (a, b) in enumerate(offsets):
                    if a <= start < b:
                        ok = int(logits[t][:2].argmax()) == gold   # columns 0-1 are ss/ß
                        right += ok
                        wrong += not ok
                        break
    return 1000 * wrong / (right + wrong), right + wrong


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    raw = HERE / "export" / "_raw"
    main_export(str(SRC), output=str(raw), task="token-classification", opset=17)

    (OUT / "onnx").mkdir(parents=True)
    quantize_dynamic(str(raw / "model.onnx"), str(OUT / "onnx" / "model_quantized.onnx"), weight_type=QuantType.QInt8,
                     per_channel=True)   # half the decision flips of per-tensor (quantize.py)
    shutil.copy(raw / "model.onnx", OUT / "onnx" / "model.onnx")
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.txt"):
        if (raw / name).exists():
            shutil.copy(raw / name, OUT / name)
    shutil.rmtree(raw)

    tok = AutoTokenizer.from_pretrained(str(OUT))
    for name in ("model.onnx", "model_quantized.onnx"):
        path = OUT / "onnx" / name
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        err, n = grade(session, tok)
        print(f"{name:22} {path.stat().st_size / 2**20:6.1f} MB   {err:.2f} errors per 1000 on {n} held-out decisions")
    (OUT / "onnx" / "model.onnx").unlink()   # only the quantized model ships


if __name__ == "__main__":
    main()
