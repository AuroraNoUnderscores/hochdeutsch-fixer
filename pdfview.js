// Content script for PDFs. pdfnet.js answers a PDF with the browser's own
// viewer as a page; here, in that page, this script does what the browser's
// privileged side normally does for the viewer (preferences, the PDF's bytes,
// saving), and has the text pdfpage.mjs asks about converted (pdftext.js).
// For a PDF on this computer it runs as a script of the extension's own page
// (pdflocal.js), in the viewer's world rather than beside it.
(() => {
  const root = document.documentElement;
  if (root) { if (root.hasAttribute('data-hdfx-pdf')) main(); return; }
  // At document_start the <html> element may not exist yet.
  new MutationObserver((_, obs) => {
    if (!document.documentElement) return;
    obs.disconnect();
    if (document.documentElement.hasAttribute('data-hdfx-pdf')) main();
  }).observe(document, { childList: true });

  function main() {
    const root = document.documentElement;
    const token = root.getAttribute('data-hdfx-pdf');
    // nothing happens here until the background confirms it served this page
    const verified = browser.runtime.sendMessage({ type: 'pdf-verify', token }).catch(() => false);
    const page = window.wrappedJSObject || window;
    const toPage = v => (typeof cloneInto === 'function' ? cloneInto(v, window) : v);
    const fromPage = v => {
      if (v == null || typeof v !== 'object') return v;
      try { return JSON.parse(JSON.stringify(v)); } catch { return null; }   // some messages carry DOM objects
    };

    // ---------- the browser's side of the viewer (FirefoxCom) ----------

    const DEFAULTS = fetch(browser.runtime.getURL('pdfjs/prefs.json')).then(r => r.json());
    const BROWSER = browser.runtime.sendMessage({ type: 'pdf-browser-info' });

    async function getPreferences(asked) {
      const [defaults, stored, info] = await Promise.all([DEFAULTS, browser.storage.local.get('pdfjsPrefs'), BROWSER]);
      const mine = stored.pdfjsPrefs || {};
      const prefs = {};
      for (const key of Object.keys(asked || {})) {
        if (!(key in defaults)) continue;
        let v = key in mine ? mine[key] : defaults[key];
        if (typeof v === 'string' && v.startsWith('https://support.mozilla.org/') && v.includes('%'))
          v = v.replace(/%VERSION%/g, defaults._appVersion || info.version).replace(/%OS%/g, info.os).replace(/%LOCALE%/g, info.locale);
        if (typeof v === typeof asked[key]) prefs[key] = v;
      }
      return {
        browserPrefs: {
          allowedGlobalEvents: info.allowedGlobalEvents,
          canvasMaxAreaInBytes: info.canvasMaxAreaInBytes,
          isInAutomation: false,
          localeProperties: { lang: root.dataset.hdfxLang || 'en-US', isRTL: /^(ar|he|fa|ps|ur)\b/.test(root.dataset.hdfxLang || '') },
          maxCanvasDim: info.maxCanvasDim,
          nimbusDataStr: null,
          supportsDocumentFonts: true,
          // The browser's find bar searches this page's text, so the viewer's own
          // find button stays hidden, as it is in the built-in viewer.
          supportsIntegratedFind: window.top === window,
          supportsDownloading: true,
          supportsMouseWheelZoomCtrlKey: true,
          supportsMouseWheelZoomMetaKey: info.os === 'Darwin',
          supportsPinchToZoom: true,
          supportsPrinting: true,
          supportsCaretBrowsingMode: false,
          toolbarDensity: 0,
        },
        prefs,
      };
    }

    async function setPreferences(data) {
      const [defaults, s] = await Promise.all([DEFAULTS, browser.storage.local.get('pdfjsPrefs')]);
      const known = Object.fromEntries(Object.entries(data || {}).filter(([k, v]) => k in defaults && typeof v === typeof defaults[k]));
      await browser.storage.local.set({ pdfjsPrefs: { ...(s.pdfjsPrefs || {}), ...known } });
      return null;
    }

    async function download({ blobUrl, originalUrl, filename, isAttachment }) {
      if (typeof filename !== 'string' || (!/\.pdf$/i.test(filename) && !isAttachment)) filename = 'document.pdf';
      let data = null;
      if (blobUrl) { try { data = await (await fetch(blobUrl)).arrayBuffer(); } catch {} }
      data ||= (await bytes.whenDone).buffer;
      await browser.runtime.sendMessage({ type: 'pdf-download', token, data, filename, url: originalUrl });
    }

    const ACTIONS = {
      getPreferences: data => getPreferences(data),
      setPreferences: data => setPreferences(data),
      initPassiveLoading: () => { startLoading(); return true; },
      requestDataRange: data => { bytes.range(data.begin, data.end); },
      abortLoading: () => {},
      download: data => { download(data); },
      createSandbox: () => false,              // scripts in PDFs stay off, as pdfjs.enableScripting is
      dispatchEventInSandbox: () => {},
      destroySandbox: () => {},
      mlGuess: () => null, mlDelete: () => null, loadAIEngine: () => null,
      handleSignature: () => null,
      verifyPdfSignature: () => ({ error: 'no-actor' }),
      viewPdfCertificate: () => false,
    };

    document.addEventListener('pdf.js.message', async e => {
      if (!(await verified)) return;
      const raw = (e.wrappedJSObject || e).detail;
      const action = raw?.action, responseExpected = !!raw?.responseExpected;
      if (!(action in ACTIONS) && !responseExpected) return;   // telemetry, find bar and editor state updates
      const data = fromPage(raw?.data);
      const node = e.target;
      let response = null;
      try { response = await ACTIONS[action]?.(data); } catch (err) { console.error('[Hochdeutsch-Fixer]', action, err); }
      if (!responseExpected) return;
      const detail = toPage({ response });
      const d = detail.wrappedJSObject || detail;
      // the browser hands this one over as a Set, which a clone would not keep
      if (action === 'getPreferences' && response) d.response.browserPrefs.allowedGlobalEvents = new page.Set(toPage(response.browserPrefs.allowedGlobalEvents));
      const opts = new page.Object();
      opts.bubbles = false;
      opts.detail = detail;
      node.dispatchEvent(new page.CustomEvent('pdf.js.response', opts));
    }, true);

    function post(message) {
      page.dispatchEvent(new page.MessageEvent('message', toPage({ data: message })));
    }

    // ---------- the PDF's bytes, streamed as the browser streams them ----------

    const bytes = {
      chunks: [], size: 0, done: false, waiting: [],
      whenDone: null,
      all() {
        const out = new Uint8Array(this.size);
        let at = 0;
        for (const c of this.chunks) { out.set(c, at); at += c.byteLength; }
        this.chunks = [out];
        return out;
      },
      range(begin, end) {
        if (end <= this.size) post({ pdfjsLoadAction: 'range', begin, chunk: this.all().slice(begin, end) });
        else this.waiting.push([begin, end]);
      },
    };
    let resolveDone;
    bytes.whenDone = new Promise(r => { resolveDone = r; });
    let started = false, viewerWaiting = false, info = null;
    let port = null;
    verified.then(ok => { if (ok) { port = browser.runtime.connect({ name: 'hdfx-pdf' }); port.onMessage.addListener(onBytes); } });
    function onBytes(msg) {
      if (msg.type === 'missing') { info = { missing: true }; if (viewerWaiting) startLoading(); return; }
      if (msg.type === 'start') {
        info = msg;
        if (msg.data) { bytes.chunks.push(msg.data); bytes.size = msg.data.byteLength; }
        bytes.done = msg.done;
        if (msg.done) resolveDone(bytes.all());
        if (viewerWaiting) startLoading();
        return;
      }
      if (msg.type === 'chunk') {
        bytes.chunks.push(msg.chunk); bytes.size += msg.chunk.byteLength;
        if (started) post({ pdfjsLoadAction: 'progressiveRead', loaded: msg.loaded, total: msg.total, chunk: msg.chunk });
        return;
      }
      if (msg.type === 'done') {
        bytes.done = true;
        resolveDone(bytes.all());
        if (started) post({ pdfjsLoadAction: 'progressiveDone' });
        for (const [b, e] of bytes.waiting.splice(0)) bytes.range(b, e);
        return;
      }
      if (msg.type === 'error') {
        bytes.failed = true;
        if (started) post({ pdfjsLoadAction: 'progressiveDone' });
      }
    }

    function startLoading() {
      if (started) return;
      if (!info) { viewerWaiting = true; return; }
      started = true;
      if (info.missing && location.protocol === 'moz-extension:') {
        // a PDF from this computer: only the reader (or the file helper) can
        // hand it over again (pdflocal.js). Once: were the bytes missing again
        // right after, reloading would only go round and round.
        let again = false;
        try {
          again = Date.now() - Number(sessionStorage.getItem('hdfx-pdf-reloaded') || 0) < 15000;
          sessionStorage.setItem('hdfx-pdf-reloaded', String(Date.now()));
        } catch {}
        if (!again) { location.reload(); return; }
        console.error('[Hochdeutsch-Fixer] the PDF\'s bytes are missing again after a reload');
        post({ pdfjsLoadAction: 'supportsRangedLoading', length: 0, data: null, done: true });
        return;
      }
      if (info.missing) {
        // The bytes are gone (the extension was reloaded): fetch the PDF again.
        fetch(location.href, { credentials: 'include' }).then(r => r.arrayBuffer()).then(buf => {
          const data = new Uint8Array(buf);
          bytes.chunks = [data]; bytes.size = data.byteLength; bytes.done = true; resolveDone(data);
          post({ pdfjsLoadAction: 'supportsRangedLoading', rangeEnabled: false, streamingEnabled: true, pdfUrl: location.href, length: data.byteLength, data, done: true, filename: null });
        }, () => post({ pdfjsLoadAction: 'supportsRangedLoading', length: 0, data: null, done: true }));
        return;
      }
      const data = bytes.size ? bytes.all().slice() : undefined;
      post({
        pdfjsLoadAction: 'supportsRangedLoading', rangeEnabled: false, streamingEnabled: true,
        pdfUrl: info.url, length: info.length ?? -1, data, done: bytes.done, filename: info.filename,
      });
    }

    document.addEventListener('hdfx-pdf-req', async e => {
      if (!(await verified)) return;
      const { id, type, payload } = JSON.parse(e.detail);
      const reply = data => document.dispatchEvent(new page.CustomEvent('hdfx-pdf-res', toPage({ detail: JSON.stringify({ id, data }) })));
      const redraw = data => document.dispatchEvent(new page.CustomEvent('hdfx-pdf-redraw', toPage({ detail: JSON.stringify(data) })));
      if (type === 'page') HD_PDFTEXT.convertPage(payload, reply, redraw).catch(err => { console.error('[Hochdeutsch-Fixer]', err); reply({ edits: [], version: 0 }); });
    });

    browser.runtime.onMessage.addListener(msg => {
      if (msg === 'hd-status' && window.top === window)
        return Promise.resolve({ host: location.hostname, ...HD_PDFTEXT.status(), active: true, meta: false, pending: 0 });
    });

    // Switching off, or another flavour: the page is opened again, by the
    // browser's viewer or with the new settings.
    browser.storage.onChanged.addListener(async (ch, area) => {
      if (area !== 'local' || !['enabled', 'disabledSites', 'mode', 'llm', 'pdf'].some(k => k in ch)) return;
      location.reload();
    });
  }
})();
