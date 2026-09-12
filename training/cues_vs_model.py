"""When a topic cue fires, who is right more often: the cue or the model?

The cues in dictionary.js (ssCues) were written by hand for the collision words
without ever seeing this data, so held-out sentences are a fair test for both.
"""
import io, json, re, sys
from pathlib import Path

HERE = Path(__file__).parent
from evaluate import Model   # also switches stdout to UTF-8
from prepare import swissify, decisions


def load_cues():
    src = (HERE.parent / "dictionary.js").read_text(encoding="utf-8")
    block = src[src.index("ssCues: {"):src.index("\n  },", src.index("ssCues: {"))]
    cues = {}
    for keys, pro, contra in re.findall(r"'([^']+)': \{\s*pro: '([^']*)',\s*contra: '([^']*)'", block):
        unescape = lambda s: s.replace("\\\\", "\\")
        for k in keys.split(","):
            cues[k] = (re.compile(unescape(pro), re.I), re.compile(unescape(contra), re.I))
    return cues


def main():
    cues = load_cues()
    model = Model(HERE / "runs" / "balanced" / "best")
    rows = []
    for split in ("test", "val"):
        rows += [json.loads(l)["german"] for l in open(HERE / "data" / f"{split}.jsonl", encoding="utf-8")]
    stats = {"fired": 0, "cue_right": 0, "model_right": 0, "silent": 0, "silent_model_right": 0}
    examples = []
    for german in rows:
        swiss, origin = swissify(german)
        words = [(m.start(), m.end(), m.group().lower()) for m in re.finditer(r"\w+", swiss)]
        todo = [(s, g, next((w for a, b, w in words if a <= s < b), None)) for s, g in decisions(swiss, origin)]
        todo = [(s, g, w) for s, g, w in todo if w in cues]
        if not todo:
            continue
        p = model.predict(swiss)
        for start, gold, form in todo:
            pro, contra = cues[form]
            verdict = 1 if pro.search(swiss) else 0 if contra.search(swiss) else None
            model_says = int(p.get(start, 0) >= 0.5)
            if verdict is None:
                stats["silent"] += 1
                stats["silent_model_right"] += model_says == gold
                continue
            stats["fired"] += 1
            stats["cue_right"] += verdict == gold
            stats["model_right"] += model_says == gold
            if verdict != model_says and len(examples) < 12:
                examples.append(f"truth {'ß' if gold else 'ss'} | cue {'ß' if verdict else 'ss'} | model {'ß' if model_says else 'ss'} ({p.get(start, 0):.2f}): {swiss[max(0, start - 40):start + 40]}")
    f = stats["fired"]
    print(f"collision words in {len(rows):,} held-out sentences: cue fired {f}, silent {stats['silent']}")
    if f:
        print(f"  when a cue fires:  cue right {stats['cue_right']}/{f}   model right {stats['model_right']}/{f}")
    if stats["silent"]:
        print(f"  when no cue fires: model right {stats['silent_model_right']}/{stats['silent']}")
    print("disagreements:")
    for e in examples:
        print("  ", e)


if __name__ == "__main__":
    main()
