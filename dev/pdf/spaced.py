"""spaced.pdf: small print set wide, as footers and fine print often are. pdf.js
reads letter-spaced text with a space between every letter ("V e l o"), its
word gaps looking the same. Needs PyMuPDF; base-14 Helvetica, nothing embedded."""
import pymupdf
from pathlib import Path

LINES = [  # (size, letter spacing, text)
    (10, 0, 'Kopf: Das Velo steht vor dem Spital.'),
    (8, 1.2, 'Gesperrt: Das Velo steht vor dem Spital.'),
    (5, 1.2, 'Winzig: Das Velo steht vor dem Spital, die Offerte ist gross.'),
    (4, 0.8, 'Mini: Das Velo steht beim Trottoir.'),
    (3, 0.6, 'Fusszeile: Das Velo steht vor dem Spital, die Offerte ist gross.'),
]
doc = pymupdf.open()
page = doc.new_page(width=595, height=842)
page.insert_text((72, 40), ' ', fontname='helv', fontsize=10)      # the font, as a resource
xref = page.get_contents()[0]
raw = doc.xref_stream(xref).decode('latin-1')
font = [l for l in raw.split('\n') if ' Tf' in l][0].split()[0]
esc = lambda s: s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
y, out = 780, []
for size, tc, text in LINES:
    out.append(f'BT {font} {size} Tf {tc} Tc 72 {y} Td ({esc(text)}) Tj ET')
    y -= size * 2.2
doc.update_stream(xref, (raw + '\n' + '\n'.join(out) + '\n').encode('latin-1'))
doc.save(Path(__file__).parent / 'spaced.pdf')
