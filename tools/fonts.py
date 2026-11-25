"""fonts/: the letters a PDF's own font may lack, from Latin Modern (the OpenType
Computer Modern of LaTeX documents), for pdfhooks.mjs. A Swiss document never
uses ß, so its embedded subset of Computer Modern has none, and hardly any
computer has Latin Modern installed: the ß came from whatever serif there was.

    py tools/fonts.py [path to Latin Modern's .otf files]

Needs fontTools and brotli (pip install fonttools brotli). Latin Modern is
under the GUST Font License; a subset is a modified font, so it is renamed
("HDFX ..."), as the license asks (fonts/README.md).
"""
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '/usr/share/texmf/fonts/opentype/public/lm')
OUT = Path(__file__).resolve().parent.parent / 'fonts'
FONTS = [  # file, family, weight, style
    ('lmroman10-regular', 'HDFX LM Roman', 'normal', 'normal'),
    ('lmroman10-bold', 'HDFX LM Roman', 'bold', 'normal'),
    ('lmroman10-italic', 'HDFX LM Roman', 'normal', 'italic'),
    ('lmroman10-bolditalic', 'HDFX LM Roman', 'bold', 'italic'),
    ('lmsans10-regular', 'HDFX LM Sans', 'normal', 'normal'),
    ('lmsans10-bold', 'HDFX LM Sans', 'bold', 'normal'),
    ('lmsans10-oblique', 'HDFX LM Sans', 'normal', 'italic'),
    ('lmmono10-regular', 'HDFX LM Mono', 'normal', 'normal'),
]
# letters, digits and punctuation of Latin-1, ẞ, and the quotes and dashes German uses
TEXT = ''.join(map(chr, range(0x20, 0x7f))) + ''.join(map(chr, range(0xa0, 0x100))) + 'ẞ–—‘’‚“”„…'

OUT.mkdir(exist_ok=True)
for name, family, weight, style in FONTS:
    font = TTFont(SRC / f'{name}.otf')
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern']
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    s = subset.Subsetter(opts)
    s.populate(text=TEXT)
    s.subset(font)
    sub = 'Bold Italic' if weight == 'bold' and style == 'italic' else 'Bold' if weight == 'bold' else 'Italic' if style == 'italic' else 'Regular'
    names = {1: family, 2: sub, 3: f'{family} {sub}; subset of Latin Modern', 4: f'{family} {sub}', 6: f'{family}-{sub}'.replace(' ', '')}
    for rec in font['name'].names:
        if rec.nameID in names: rec.string = names[rec.nameID]
    font.flavor = 'woff2'
    out = OUT / f'{name}.woff2'
    font.save(out)
    print(out.name, out.stat().st_size)
