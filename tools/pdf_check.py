"""End-to-end checks of the PDF viewer, in a real headless browser with the
extension installed (tools/zen.py; Zen by default, BROWSER=... for another
Firefox build). Serves this folder itself; needs nothing but Python.

    py tools/pdf_check.py

The test PDFs are in dev/pdf/ (made by dev/pdf/make.py).
"""
import functools, glob, http.server, json, os, sys, tempfile, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))
from zen import Zen

READY = ("window.PDFViewerApplication?.pdfViewer?.pagesCount && PDFViewerApplication.pdfViewer.getPageView(0)?.renderingState === 3 "
         "&& [...Array(PDFViewerApplication.pdfViewer.pagesCount).keys()].every(i => [0, 3].includes(PDFViewerApplication.pdfViewer.getPageView(i).renderingState)) ? 'ok' : ''")
STYLE = ("JSON.stringify([...document.querySelectorAll('#toolbarContainer *, #outerContainer > *, body, html')].map(e => {"
         " const c = getComputedStyle(e); return [e.id || e.className || e.tagName, c.color, c.backgroundColor, c.fontFamily, c.fontSize, c.width, c.height, c.display]; }))")
TEXT = "[...document.querySelectorAll('.textLayer:not(.hdfx-find)')].map(t => t.textContent).join(' ')"

failures = []
def check(name, ok, detail=''):
    print(('ok    ' if ok else 'FAIL  ') + name + (f'  ({detail})' if detail and not ok else ''))
    if not ok: failures.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass


def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/dev/pdf/'
    tmp = tempfile.mkdtemp(prefix='hdfx-pdf-')

    # 1. With nothing to convert, the extension's viewer is the browser's, pixel for pixel.
    shots, styles = {}, {}
    for label, ext in [('builtin', []), ('extension', [str(ROOT)])]:
        z = Zen(extensions=ext)
        try:
            z.nav(base + 'english.pdf'); z.wait(READY, 40); time.sleep(3)
            shots[label] = open(z.shot(os.path.join(tmp, label + '.png')), 'rb').read()
            styles[label] = json.loads(z.js(STYLE))
            if label == 'extension':
                check('viewer page is the extension\'s', z.js('document.contentType') == 'text/html')
                check('title as the browser sets it', z.js('document.title') == 'english.pdf')
        finally: z.close()
    check('looks exactly like the built-in viewer', shots['builtin'] == shots['extension'], 'screenshots differ')
    check('same computed styles as the built-in viewer', styles['builtin'] == styles['extension'],
          f"{sum(a != b for a, b in zip(styles['builtin'], styles['extension']))} rows differ")

    dl = os.path.join(tmp, 'downloads'); os.makedirs(dl)
    z = Zen(extensions=[str(ROOT)], prefs={'browser.download.dir': dl, 'browser.download.folderList': 2, 'browser.download.useDownloadDir': True,
                                          'browser.download.start_downloads_in_tmp_dir': False, 'browser.download.always_ask_before_handling_new_types': False})
    try:
        # 2. Converted, on screen and in the text layer.
        z.nav(base + 'swiss-arial.pdf'); z.wait(READY, 40); time.sleep(4)
        text = z.js(TEXT)
        for word in ['Fahranfänger', 'Führerschein', 'verbindliches Angebot', 'Bürgersteig', 'Straßenverkehrsamts', 'Sie kann innerhalb', 'Buße von 40 Franken', 'Große Teile']:
            check(f'text layer reads "{word}"', word in text)
        check('no Swiss words left in the text layer', not any(w in text for w in ['Neulenker', 'Trottoir', 'Offerte', 'Velo ']))
        check('no errors in the viewer', not [l for l in z.logs() if 'rror' in (l or '')])

        # 3. Find: every page searchable, converted, and a match carries over when pdf.js draws its page.
        z.nav(base + 'long.pdf'); z.wait(READY, 40); time.sleep(6)
        pages = z.js("String([...document.querySelectorAll('.page')].filter(p => p.querySelector('.textLayer')?.textContent).length)")
        check('all 30 pages searchable', pages == '30', pages)
        check('finds converted words on a page not yet drawn', z.js("String(window.find('Fahrrad25', false, false, true))") == 'true')
        check('the Swiss original is not found', z.js("String(window.find('Velo25', false, false, true))") == 'false')
        z.js("window.find('Fahrrad25', false, false, true), getSelection().anchorNode.parentElement.scrollIntoView({ block: 'center' }), 1")
        z.wait("document.querySelector('.page[data-page-number=\"25\"] .textLayer:not(.hdfx-find)')?.childNodes.length ? 'y' : ''", 20); time.sleep(1.5)
        check('match selected again in pdf.js\'s own layer', z.js("String(getSelection().toString() === 'Fahrrad25' && !getSelection().anchorNode.parentElement.closest('.hdfx-find'))") == 'true')
        check('no page has two text layers', z.js("String([...document.querySelectorAll('.page')].some(p => p.querySelectorAll('.textLayer').length > 1))") == 'false')

        # 4. PDFs inside pages: iframe, embed, object.
        z.nav(base + 'embed.html'); time.sleep(10)
        frames = z.cmd('browsingContext.getTree', {'root': z.ctx})['contexts'][0].get('children', [])
        got = [z.cmd('script.evaluate', {'expression': "document.contentType + '|' + (document.querySelector('.textLayer')?.textContent || '')",
                                          'target': {'context': f['context']}, 'awaitPromise': False})['result'].get('value', '') for f in frames]
        check('iframe, embed and object PDFs converted', len(got) == 3 and all(g.startswith('text/html|') and 'Fahranfänger' in g for g in got), str([g[:40] for g in got]))

        # 5. Saving gives the original file.
        z.nav(base + 'swiss-arial.pdf'); z.wait(READY, 40); time.sleep(2)
        z.js("document.getElementById('downloadButton').click(), 1")
        for _ in range(30):
            files = glob.glob(dl + '/*')
            if files and not any(f.endswith('.part') for f in files): break
            time.sleep(0.5)
        saved = glob.glob(dl + '/*')
        check('save gives the original PDF', len(saved) == 1 and open(saved[0], 'rb').read() == (ROOT / 'dev/pdf/swiss-arial.pdf').read_bytes(), str(saved))

        # 6. A page cannot pass itself off as the viewer.
        z.nav(base + 'fake.html'); time.sleep(3)
        check('a page posing as the viewer gets no answers', z.js("document.title") == 'no answer')
    finally:
        z.close()
        server.shutdown()
    print(f'\n{len(failures)} failed' if failures else '\nall passed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
