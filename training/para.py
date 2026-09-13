"""Multi-sentence passages from the web data, as the extension reads a page.

The model was trained on single sentences, but the extension hands it whole
paragraphs. Mostly that helps (more context), but a paragraph that opens with
"Die Masse der Zuschauer" (a crowd) pulled a later "die Masse meines Koffers"
(measurements) the same way, a sentence the model gets right on its own.

prepare_web.py wrote each page's sentences one after another, so three
consecutive lines are, nearly always, three sentences of one page. Joined, they
are a passage; the split by website carries over.

Writes data/v2/{train,val,test}_webpara.txt.
"""
from pathlib import Path

V2 = Path(__file__).parent / "data" / "v2"
LINES = 3
MAX_CHARS = 1000


def main():
    for split in ("train", "val", "test"):
        n = 0
        with open(V2 / f"{split}_web.txt", encoding="utf-8") as f, \
                open(V2 / f"{split}_webpara.txt", "w", encoding="utf-8") as out:
            buf = []
            for line in f:
                buf.append(line.rstrip("\n"))
                if len(buf) == LINES:
                    text = " ".join(buf)
                    if len(text) <= MAX_CHARS:
                        out.write(text + "\n"); n += 1
                    buf = []
        print(f"{split}: {n:,} passages")


if __name__ == "__main__":
    main()
