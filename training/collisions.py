"""Accuracy on the hard part only: ambiguous word forms in held-out text.

A form is ambiguous when training data shows it with both spellings (masse:
Masse and Maße, schoss: Schoss and Schoß, ...). Those are the decisions no
spelling list can make and the ones users notice, and held-out text has far
more of them than any hand-made exam, so this is what models are chosen by.
"""
import io, json, re, sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent

from evaluate import Model   # also switches stdout to UTF-8
from prepare import swissify, decisions

WORD = re.compile(r"\w*(?:ss|ß)\w*")


def ambiguous_forms():
    counts = defaultdict(lambda: [0, 0])
    with open(HERE / "data" / "train.jsonl", encoding="utf-8") as f:
        for line in f:
            for w in WORD.findall(json.loads(line)["german"]):
                counts[w.replace("ß", "ss").lower()][1 if "ß" in w else 0] += 1
    return {form for form, (ss, ez) in counts.items() if ss >= 3 and ez >= 3}


def main(paths):
    forms = ambiguous_forms()
    rows = [json.loads(l)["german"] for l in open(HERE / "data" / "test.jsonl", encoding="utf-8")]
    print(f"{len(forms):,} ambiguous forms known from training data")
    for path in paths:
        m = Model(HERE / path)
        right = wrong = 0
        for german in rows:
            swiss, origin = swissify(german)
            p = m.predict(swiss)
            words = [(mt.start(), mt.end(), mt.group().lower()) for mt in re.finditer(r"\w+", swiss)]
            for start, gold in decisions(swiss, origin):
                form = next((w for a, b, w in words if a <= start < b), None)
                if form not in forms or start not in p:
                    continue
                ok = (p[start] >= 0.5) == bool(gold)
                right += ok
                wrong += not ok
        print(f"{path:22} ambiguous forms: {wrong} errors in {right + wrong} = {1000 * wrong / (right + wrong):.1f} per 1000")


if __name__ == "__main__":
    main(sys.argv[1:])
