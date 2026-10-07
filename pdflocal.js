// The page a tab showing a PDF from this computer is sent to (pdfnet.js). No
// extension may read a file by itself, so the reader hands it over: a click on
// its name opens the file dialog, or the file is dropped here. Its bytes go to
// the background, and this page becomes the same viewer as any PDF's.
(() => {
  const $ = id => document.getElementById(id);
  const file = new URLSearchParams(location.search).get('file') || '';
  let name = 'document.pdf';
  try { name = decodeURIComponent(new URL(file).pathname.split('/').pop()) || name; } catch {}

  async function open(data, fileName) {
    const html = await browser.runtime.sendMessage({ type: 'pdf-local', data, name: fileName }).catch(() => null);
    return show(html);
  }

  // the file helper (native/), where it is installed: no asking at all
  async function helper() {
    return show(await browser.runtime.sendMessage({ type: 'pdf-local-native' }).catch(() => null));
  }

  function show(html) {
    if (!html) return false;
    document.open();
    document.write(html);
    document.close();
    return true;
  }

  async function take(f) {
    if (!f) return;
    const head = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
    if (!new TextDecoder('latin1').decode(head).includes('%PDF-')) { $('error').hidden = false; return; }
    if (!(await open(await f.arrayBuffer(), f.name))) $('error').hidden = false;
  }

  function ask() {
    document.title = name;
    $('name').textContent = name;
    $('pick').textContent = `Open ${name}`;
    $('ask').hidden = false;
    $('pick').focus();
    $('pick').onclick = () => $('file').click();
    $('file').onchange = () => take($('file').files[0]);
    // Without this step from now on: the optional permission (asked for in the
    // click itself, as Firefox wants), then the helper, if it is installed
    $('helper').onclick = async e => {
      e.preventDefault();
      const granted = await browser.permissions.request({ permissions: ['nativeMessaging'] }).catch(() => false);
      if (granted && await helper()) return;
      $('setup').hidden = false;
    };
    // Back to the PDF, which Firefox then shows itself (pdfnet.js lets it through)
    $('original').onclick = e => { e.preventDefault(); history.back(); };
    const over = on => e => { e.preventDefault(); document.body.classList.toggle('over', on); };
    addEventListener('dragenter', over(true));
    addEventListener('dragover', over(true));
    addEventListener('dragleave', e => { if (!e.relatedTarget) over(false)(e); });
    addEventListener('drop', e => { over(false)(e); take(e.dataTransfer.files[0]); });
  }

  // opened again (a reload, other settings): the bytes may still be there
  open(null).then(done => done || helper()).then(done => { if (!done) ask(); });
})();
