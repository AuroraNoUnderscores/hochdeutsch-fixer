# Training the eszett model

The extension's ss/ß decisions, and its sense of what is a name, come from one
German DistilBERT fine-tuned for two jobs on the same tokens:

- columns 0–1: for every "ss" in Swiss text, is it "ß" in German spelling?
- columns 2–6: is this token part of a person, organisation, place or other name
  (O, PER, ORG, LOC, OTH)? The extension leaves names as written.

It is bundled as `models/hdfx-eszett` (int8 ONNX, 64 MB) and reads each text once.

## Labels for free

German text from Germany spells ß correctly. Turning every ß into ss produces
exactly the ambiguous Swiss input, and the original gives the answer. No
hand-labelling: the model learns *die Masse strömte* vs *die Maße des Fensters*
from real usage instead of from a word list.

## Data

| source | what | size |
| --- | --- | --- |
| German Wikipedia, one of 20 shards (`wikimedia/wikipedia` 20231101.de, CC BY-SA) | encyclopedia register | 1.05M sentences with ss/ß |
| FineWeb-2 German, one file (`HuggingFaceFW/fineweb-2` deu_Latn 000_00000, ODC-By) | everyday register: shops, forums, how-tos, news | 3.3M pages → 22.3M sentences with ss/ß |
| GermEval 2014 (`GermanEval/germeval_14`, CC BY 4.0) | hand-labelled names in news and Wikipedia | 24k sentences |

Wikipedia alone was the problem behind "die Masse des Fensters": in it, "Masse
des/der …" outnumbers "Maße des/der …" 204 to 42, and a carpenter taking the
measurements of something occurs about once. In the web data it is 3,027 to
2,730, with hundreds of "Maß nehmen".

### Cleaning web text

A wrong spelling in the source is a wrong label, and German web pages write
"Online Fussball Wetten" and "Schloß" too. `prepare_web.py` drops:

- Swiss and Liechtenstein sites (168k pages);
- any page that spells a *settled* form the other way (247k pages). Wikipedia
  decides what is settled: a form written one way at least 97% of the time in 30+
  occurrences (Straße, Fußball, heißt; dass, muss). This catches Swiss spelling,
  spelling before 1996 and typos, without a hand-written list, and forms with two
  real spellings (Masse/Maße, Weiss the name) are never settled.

Train, validation and test are split by website, so no site is in two of them.

### Names without Swiss blind spots

A names model trained on GermEval alone takes unfamiliar capitalised words for
names, and Swiss words are exactly that to it: "auf dem Perron" came out a name
with 0.99, "Hoi Anna" a two-word name. `names_swap.py` fixes that with data:

1. web sentences with a German word the dictionary maps from Swiss (Fahrrad,
   Krankenhaus, Hallo …), plus a random 150k web sentences;
2. a first names model (the judge) labels every word it is sure about, reading
   the German spelling, where it is on familiar ground;
3. the Swiss word replaces the German one, the sentence goes into Swiss spelling,
   and the labels carry over: 351k sentences, 6.4M labelled words.

## Pipeline

| step | script |
| --- | --- |
| Wikipedia sentences | `prepare.py` |
| web sentences, cleaning, website split | `prepare_web.py` |
| tokenized, memory-mapped data (any base model with the same vocabulary) | `data_v2.py` |
| where the dictionary's Swiss words occur on .de and .ch pages | `names_extract.py` |
| swapped, judged sentences for names | `names_swap.py collect`, `names_swap.py label <judge>` |
| dictionary words that are also ordinary German → `../german_too.js` | `german_too.py` |
| multi-sentence passages (tried, not shipped) | `para.py` |
| training | `train2.py` |
| ss/ß grading | `evaluate2.py` |
| names grading | `names_eval.py` |
| ONNX export, per-channel int8, re-graded | `export.py` |
| training counts for topic cues → `../coverage.js` | `coverage.py` |

The first model (Wikipedia only) was built with `train.py`/`evaluate.py`; those
stay for reference.

## Results

Errors per 1000 ss/ß decisions on text no model trained on; "ambiguous" counts
only forms with two real spellings (both at least 10 times and 3% in training).

| model | Wikipedia | ambiguous | web | ambiguous | web passages | ss/ß in the 44 notes |
| --- | --- | --- | --- | --- | --- | --- |
| v3.0, Wikipedia only | 8.54 | 79.4 | 8.26 | 82.0 | 9.26 | 39/40 |
| + 4M web sentences | 6.43 | 74.8 | 4.24 | 60.9 | – | 39/40 |
| **all 22M web sentences + names (shipped)** | **5.66** | **58.4** | **3.98** | **57.4** | **3.98** | 38/40 |
| + passage training | 6.62 | 77.1 | 3.83 | 56.2 | 4.02 | 38/40 |

int8 costs 0.2 per 1000 (8.18 → 8.37 on the original Wikipedia test).

Names: GermEval test F1 0.913. On a hand-labelled random sample of 197 Swiss
dictionary words found on .de and .ch pages (`data/names/hand_sample.json`, 30
of them part of a name, never trained on): the model never kept an ordinary word
as a name (precision 1.00) and kept 21 of 30 names. The ones it misses are brand
names built from Swiss words (VeloStrom, Velositey, "Velo Pro"), names with a
letter or number ("Natel A") and a gold corridor called Perron. Of the Swiss
words on .ch pages, 4.0% are kept as names.

## Things measured on the way, so they need not be rediscovered

- Training longer on the same data does not help: a second epoch over the
  Wikipedia data was slightly worse. More and more varied data did.
- gbert-base (twice the size) was worse than DistilBERT at the same step (9.14
  vs 8.25 mean validation errors at 20k steps) and costs twice as much to run.
- Balancing by repeating rare spellings amplifies label noise: it most likely repeated the
  few "Heuß" typos until the model spelled Theodor Heuss with ß.
- Learning names alongside ss/ß does not hurt ss/ß (8.25 vs 8.43 at 20k steps).
- Repeating name examples 10× in the swapped data did not change the name
  sample's numbers beyond noise.
- The model was trained on single sentences and the extension reads paragraphs.
  On real web passages that helps (3.08 vs 3.63 per 1000 read sentence by
  sentence), but a paragraph opening with "Die Masse der Zuschauer" pulled a later
  "die Masse meines Koffers" to the crowd sense (0.29; 0.99 alone). Continued
  training on 2.5M passages fixed that note and broke another, and was not better
  on held-out passages, so it is not shipped.
- "Gruss" stays noisy: even Wikipedia spells that word family with ss 9% of the
  time, too close to real double spellings for any cut-off, so 548 web sentences
  with "Gruss" kept their ss labels. The model gives "Herzlichen Gruss aus Zürich"
  0.25.
- Per-tensor int8 flipped borderline decisions; per-channel keeps them.
- The browser matches Python token for token (`../dev/offsets.html`,
  `../dev/parity.html`).

## Reproducing

AMD's ROCm build of PyTorch for Windows needs Python 3.12 and Adrenalin 26.2.2
or newer. Everything lives in this folder; `python312/`, `.venv/`, `data/`,
`runs/` and `export/` are git-ignored (about 27 GB with the web data) and can be
deleted.

```bash
# portable Python 3.12 (nuget.org package "python") into python312/
python312/python.exe -m venv .venv
B=https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1
.venv/Scripts/python.exe -m pip install "$B/rocm_sdk_core-7.2.1-py3-none-win_amd64.whl" \
  "$B/rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl" "$B/rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl" \
  "$B/rocm-7.2.1.tar.gz" "$B/torch-2.9.1%2Brocm7.2.1-cp312-cp312-win_amd64.whl"
.venv/Scripts/python.exe -m pip install numpy transformers datasets optimum-onnx onnx onnxruntime
P=.venv/Scripts/python.exe
$P prepare.py                                   # Wikipedia
$P -c "from huggingface_hub import hf_hub_download as d; print(d('HuggingFaceFW/fineweb-2', \
  'data/deu_Latn/train/000_00000.parquet', repo_type='dataset', cache_dir='data/hf'))"
$P prepare_web.py <that parquet path>
# GermEval 2014: the three parquet files of refs/convert/parquet into data/germeval/
$P names_extract.py <that parquet path>         # also used by german_too.py and names_eval.py
$P train2.py --web 20000 --wiki 5000 --no-balance --ner --ner-every 1 --epochs 5.8 --out runs/names-judge
$P names_swap.py collect && $P names_swap.py label runs/names-judge/best
$P train2.py --no-balance --ner --swap --swap-name-repeat 1 --ner-every 80 --eval-every 50000 --out runs/full-names
$P evaluate2.py runs/full-names/best && $P names_eval.py runs/full-names/best
$P export.py runs/full-names/best && cp -r export/hdfx-eszett ../models/
$P coverage.py && $P german_too.py
```

The full run takes about 3.5 hours on an RX 9070 XT. Hugging Face's `Trainer`
is not used because AMD's Windows torch has no `torch.distributed`, which it
imports unconditionally.
