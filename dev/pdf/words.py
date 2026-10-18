"""words.pdf: justified lines drawn word by word, each word placed on its own
(as Word writes PDFs), one bold word per paragraph so they change word by word
rather than being set anew. pdf.js joins each line into one item. A longer word
there used to be squeezed into its own place. Needs PyMuPDF; base-14 Helvetica.
(Its ü and ö are measured by PyMuPDF and may sit a little off the font's.)"""
import pymupdf
from pathlib import Path

PARAS = [
    "Mit dem Velo zur Arbeit: Auf dem Trottoir ist das Velofahren verboten. Parkieren Sie Ihr Velo beim Spital auf den "
    "markierten Parkfeldern, nicht auf dem Trottoir. Wer das Velo falsch parkiert, muss eine Busse bezahlen. Die Offerte "
    "für die Velostation liegt beim Spital auf.",
    "Das Kantonsspital hat eine neue Notfallstation eröffnet. Im Spital wurden grosse Teile renoviert, und im Estrich "
    "lagern noch die alten Betten. Das Personal freut sich über die schönen Zimmer und die Glace zum Zvieri.",
]
doc = pymupdf.open()
page = doc.new_page(width=595, height=842)
page.insert_font(fontname='helv'); page.insert_font(fontname='hebo')
page.insert_text((72, 40), ' ', fontname='helv', fontsize=10)
xref = page.get_contents()[0]
raw = doc.xref_stream(xref).decode('latin-1')
W = lambda t, f: pymupdf.get_text_length(t, fontname=f, fontsize=10)
out, y, width = [], 780, 451
for para in PARAS:
    lines, cur = [], []
    for w in para.split(' '):
        if cur and W(' '.join(cur + [w]), 'helv') > width: lines.append(cur); cur = []
        cur.append(w)
    lines.append(cur)
    for li, ln in enumerate(lines):
        font = lambda k: 'hebo' if li == 0 and k == 1 else 'helv'
        ww = [W(w, font(k)) for k, w in enumerate(ln)]
        gap = (width - sum(ww)) / max(1, len(ln) - 1) if li < len(lines) - 1 else W(' ', 'helv')
        x, parts = 72, []
        for k, w in enumerate(ln):
            parts.append(f'/{font(k)} 10 Tf 1 0 0 1 {x:.2f} {y} Tm ({w}) Tj'); x += ww[k] + gap
        out.append('BT ' + ' '.join(parts) + ' ET')
        y -= 13
    y -= 10
doc.update_stream(xref, (raw + '\n' + '\n'.join(out) + '\n').encode('latin-1'))
doc.save(Path(__file__).parent / 'words.pdf')
