# Training the eszett model

The extension's ss/ß decisions come from German DistilBERT fine-tuned on one
task: for every "ss" in Swiss text, is it "ß" in German spelling? The result is
bundled as `models/hdfx-eszett` (int8 ONNX, 64 MB).

## The idea: labels for free

German text from Germany spells ß correctly. Turning every ß into ss produces
exactly the ambiguous Swiss input, and the original gives the answer. No
hand-labelling, and the model learns *Masse strömte* vs *Maße nehmen* from real
usage instead of from a word list.

## Pipeline

| step | script | what it does |
| --- | --- | --- |
| data | `prepare.py` | one shard of German Wikipedia (~280 MB, `wikimedia/wikipedia` 20231101.de, CC BY-SA); split by article; 1.17M training sentences; skips articles written in Swiss spelling (their labels are wrong); upsamples the rarer spelling of every ambiguous form towards parity |
| train | `train.py` | token classification, bf16, plain PyTorch loop; ~11 min per epoch on an RX 9070 XT |
| grade | `evaluate.py` | held-out articles, plus the 44 notes of the test artifact aligned word by word with its answer key |
| hard cases | `collisions.py` | accuracy on ambiguous forms only (Masse/Maße, Schoss/Schoß, ...) |
| quantize | `quantize.py` | compares int8 variants by how often they disagree with the full-precision model |
| export | `export.py` | ONNX, per-channel int8, re-graded after quantization |
| coverage | `coverage.py` | writes `../coverage.js`: how often each cue-covered spelling occurred in training |
| cues | `cues_vs_model.py` | when a topic cue fires, is the cue or the model right more often? |

## Results (held-out articles, 10,514 decisions)

| | errors per 1000 |
| --- | --- |
| rules alone (the extension before this model) | 28.8 |
| model, full precision | 9.9 |
| model, int8 per-channel (shipped) | 10.2 |
| extension end to end in the browser, rules + model | 10.6 |

On ambiguous forms only (4,161 decisions): 15.9 per 1000. On the 44 notes of the
test artifact: 43/44 end to end. The remaining miss is "die Masse des Fensters"
(Maße): an encyclopedia rarely talks about measuring a window, so that sense of
the word in everyday register is under-represented. More Wikipedia won't fix it;
everyday German text would.

## Things measured on the way, so they need not be rediscovered

- Balancing ambiguous forms and skipping Swiss-spelled articles do not move the
  held-out numbers beyond noise; balancing did help the everyday-register notes.
- A second epoch overfits slightly; one full learning-rate cycle is as good.
- Per-tensor int8 kept accuracy but flipped 13 of 3,965 decisions against full
  precision, including "die Masse meines Koffers" (0.78 → 0.38). Per-channel
  flips 6 at the same size, and that case stays at 0.92.
- The browser matches Python: 3,928 of 3,928 ss pairs land on the same token
  (`dev/offsets.html`), and no decision flips between onnxruntime and
  transformers.js on the same file (`dev/parity.html`).
- Hand-written topic cues are *less* reliable than the model on unseen text (2
  of 4 vs 4 of 4 where a cue fired). They only decide where the model had
  almost no data for a spelling: plural "Bußen" occurred 3 times.

## Reproducing

AMD's ROCm build of PyTorch for Windows needs Python 3.12 and Adrenalin 26.2.2
or newer. Everything lives in this folder; `python312/`, `.venv/`, `data/`,
`runs/` and `export/` are git-ignored (~5 GB) and can be deleted.

```bash
# portable Python 3.12 (nuget.org package "python", tools/ folder) into python312/
python312/python.exe -m venv .venv
B=https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1
.venv/Scripts/python.exe -m pip install "$B/rocm_sdk_core-7.2.1-py3-none-win_amd64.whl" \
  "$B/rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl" "$B/rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl" \
  "$B/rocm-7.2.1.tar.gz" "$B/torch-2.9.1%2Brocm7.2.1-cp312-cp312-win_amd64.whl"
.venv/Scripts/python.exe -m pip install numpy transformers datasets optimum-onnx onnx onnxruntime
.venv/Scripts/python.exe prepare.py
.venv/Scripts/python.exe train.py --epochs 1 --out runs/balanced
.venv/Scripts/python.exe evaluate.py runs/balanced/best
.venv/Scripts/python.exe export.py runs/balanced/best && cp -r export/hdfx-eszett ../models/
.venv/Scripts/python.exe coverage.py
```

Without an AMD GPU, install the regular `torch` wheel instead; the scripts fall
back to CPU (roughly 1–2 hours per epoch on a modern 8-core).

Hugging Face's `Trainer` is not used because AMD's Windows torch has no
`torch.distributed`, which it imports unconditionally.
