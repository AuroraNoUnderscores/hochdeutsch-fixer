// PDFs open in the browser's own viewer, which no extension can reach. So a PDF
// response is answered here with that same viewer (pdfjs/, copied from the
// browser) as an ordinary page, at the PDF's own address: the tab, its URL and
// the viewer look exactly as before, but pdfview.js can now convert the text.
// The PDF's bytes are kept here and handed to the viewer as they arrive, the
// way the browser streams them to its own viewer.
const EXT = browser.runtime.getURL('');
// Marks the viewer pages this extension served, so a site cannot pass its own
// page off as one (pdfview.js does nothing until the background confirms it).
const TOKEN = crypto.randomUUID();
const loads = [];   // { url, tabId, frameId, filename, length, chunks, size, done, ports }, newest last
let template = null;

const PLATFORM = browser.runtime.getPlatformInfo().then(p => (p.os === 'win' ? 'windows' : p.os === 'mac' ? 'macos' : 'linux'));

// The viewer page: the browser's viewer.html with the extension's copies of its
// scripts and styles, and the viewer's strings in the browser's UI language.
async function viewerHtml() {
  if (!template) {
    template = (async () => {
      const html = await (await fetch(EXT + 'pdfjs/web/viewer.html')).text();
      const body = html.slice(html.indexOf('<body'), html.lastIndexOf('</html>'));
      const platform = await PLATFORM;
      const lang = browser.i18n.getUILanguage();
      const ftl = await localeFile(lang);
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return `<!doctype html>
<html dir="ltr" mozdisallowselectionprint data-hdfx-pdf="${TOKEN}" data-hdfx-lang="${esc(ftl.lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <title>PDF.js viewer</title>
    <link rel="icon" type="image/svg+xml" href="${EXT}pdfjs/skin/pdf.svg" />
    <script id="hdfx-ftl" type="text/plain">${esc(ftl.text)}</script>
    <script src="${EXT}pdfpage.mjs" type="module"></script>
    <script src="${EXT}pdfjs/build/pdf.mjs" type="module"></script>
    <link rel="stylesheet" href="${EXT}pdfjs/web/viewer.${platform}.css">
    <script src="${EXT}pdfjs/web/viewer.mjs" type="module"></script>
    <script src="${EXT}pdfjs/pdfFeaturesNotification.mjs" type="module"></script>
  </head>
  ${body}
</html>`;
    })();
  }
  return template;
}

async function localeFile(lang) {
  const tries = [lang, lang.split('-')[0], 'en-US'];
  for (const l of tries) {
    try {
      const r = await fetch(EXT + `pdfjs/locale/${l}/viewer.ftl`);
      if (r.ok) return { lang: l, text: await r.text() };
    } catch {}
  }
  return { lang: 'en-US', text: '' };
}
viewerHtml();

// Settings are kept here so the request handler can decide at once: the
// response filter must be attached before the handler returns.
let settings = { enabled: true, pdf: true, disabledSites: [] };
const readSettings = () => browser.storage.local.get(['enabled', 'disabledSites', 'pdf']).then(s => { settings = s; });
readSettings();
browser.storage.onChanged.addListener(readSettings);

function wanted(url) {
  const s = settings;
  if (s.enabled === false || s.pdf === false) return false;
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  return !(s.disabledSites || []).includes(host);
}

const header = (headers, name) => headers.find(h => h.name.toLowerCase() === name);

function filenameOf(disposition) {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch {} }
  const plain = /filename\s*=\s*("?)([^";]+)\1/.exec(disposition);
  return plain ? plain[2].trim() : null;
}

function onHeaders(d) {
  if (d.statusCode < 200 || d.statusCode >= 300 || d.statusCode === 206) return;
  const type = header(d.responseHeaders, 'content-type');
  if (!type || !/^\s*application\/(x-)?pdf\s*(;|$)/i.test(type.value)) return;
  if (!wanted(d.url)) return;

  const disposition = header(d.responseHeaders, 'content-disposition')?.value;
  const lengthHeader = header(d.responseHeaders, 'content-length')?.value;
  const encoded = header(d.responseHeaders, 'content-encoding')?.value;
  const load = {
    url: d.url, tabId: d.tabId, frameId: d.frameId,
    filename: filenameOf(disposition),
    // a compressed transfer has no useful length for the progress bar
    length: lengthHeader && (!encoded || encoded === 'identity') ? +lengthHeader : undefined,
    chunks: [], size: 0, done: false, failed: false, ports: new Set(),
  };
  loads.push(load);
  if (loads.length > 20) loads.splice(0, loads.length - 20).forEach(l => l.ports.size || (l.chunks = []));
  const filter = browser.webRequest.filterResponseData(d.requestId);
  const html = viewerHtml().then(t => new TextEncoder().encode(t));
  // the viewer goes first; the PDF's bytes are only collected, never written
  let written = null;
  filter.onstart = () => { written = html.then(h => filter.write(h)); };
  filter.ondata = e => {
    const chunk = new Uint8Array(e.data);
    load.chunks.push(chunk);
    load.size += chunk.byteLength;
    for (const port of load.ports) port.postMessage({ type: 'chunk', chunk, loaded: load.size, total: load.length });
  };
  filter.onstop = async () => {
    load.done = true;
    await written;
    filter.close();
    for (const port of load.ports) port.postMessage({ type: 'done' });
  };
  filter.onerror = () => {
    load.failed = true;
    for (const port of load.ports) port.postMessage({ type: 'error', error: filter.error });
  };
  // The viewer is HTML; and the PDF's own headers must not stop it from running:
  // a Content-Security-Policy for the PDF, or an attachment disposition (the
  // browser shows those PDFs inline too). The bytes are still the PDF.
  const drop = /^(content-type|content-security-policy|content-security-policy-report-only|content-disposition|x-content-type-options|content-length)$/i;
  return {
    responseHeaders: [
      ...d.responseHeaders.filter(h => !drop.test(h.name)),
      { name: 'Content-Type', value: 'text/html; charset=utf-8' },
    ],
  };
}

browser.webRequest.onHeadersReceived.addListener(
  onHeaders,
  { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'object'] },
  ['blocking', 'responseHeaders'],
);

function joined(load) {
  const all = new Uint8Array(load.size);
  let at = 0;
  for (const c of load.chunks) { all.set(c, at); at += c.byteLength; }
  load.chunks = [all];
  return all;
}

// The viewer page's content script (pdfview.js) collects the bytes here.
browser.runtime.onConnect.addListener(port => {
  if (port.name !== 'hdfx-pdf') return;
  // the newest load of this address, in this tab and frame when the browser says which
  const url = port.sender.url, tab = port.sender.tab?.id, frame = port.sender.frameId ?? 0;
  const load = [...loads].reverse().find(l => l.url === url && (tab == null || l.tabId < 0 || (l.tabId === tab && l.frameId === frame)));
  if (!load) { port.postMessage({ type: 'missing' }); port.disconnect(); return; }
  load.ports.add(port);
  port.postMessage({
    type: 'start', url: load.url, filename: load.filename, length: load.length,
    data: load.size ? joined(load).slice() : null, done: load.done, failed: load.failed,
  });
  port.onMessage.addListener(msg => {
    if (msg.type === 'range') {
      const all = joined(load);
      if (msg.end <= all.byteLength) port.postMessage({ type: 'range', begin: msg.begin, chunk: all.slice(msg.begin, msg.end) });
    }
  });
  port.onDisconnect.addListener(() => {
    load.ports.delete(port);
    // keep the bytes while the same document may still ask (a reload of the frame reconnects)
    setTimeout(() => { if (!load.ports.size) { const n = loads.indexOf(load); if (n >= 0) loads.splice(n, 1); } }, 30000);
  });
});

browser.tabs.onRemoved.addListener(tabId => {
  for (let n = loads.length - 1; n >= 0; n--) if (loads[n].tabId === tabId) loads.splice(n, 1);
});

// ---------- PDFs on this computer ----------
// Firefox shows a file:// PDF in its own viewer, which no extension may enter,
// and no extension may read a file by itself. So such a tab goes to the
// extension's page for it (pdflocal.html), where the reader hands the file over
// once (a click on its name, or dropping it); its bytes then go to the same
// viewer as any PDF's, kept here like a download's.
const LOCAL = EXT + 'pdflocal.html';
const shown = new Map();   // tabId -> the file:// PDF its pdflocal.html is for
const isLocalPdf = url => { try { const u = new URL(url); return u.protocol === 'file:' && /\.pdf$/i.test(u.pathname); } catch { return false; } };

browser.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url || info.url.startsWith(LOCAL)) return;
  // Back from pdflocal.html (or its "Firefox's viewer" button) shows the PDF as Firefox does
  const back = shown.get(tabId) === info.url;
  shown.delete(tabId);
  if (back || !isLocalPdf(info.url) || !wanted(info.url)) return;
  shown.set(tabId, info.url);
  // the file in the query; its #page=… stays the hash, which the viewer reads as for any PDF
  const u = new URL(info.url), hash = u.hash;
  u.hash = '';
  browser.tabs.update(tabId, { url: `${LOCAL}?file=${encodeURIComponent(u.href)}${hash}` }).catch(() => shown.delete(tabId));
});
browser.tabs.onRemoved.addListener(tabId => shown.delete(tabId));

// The viewer page for a PDF from this computer: the same viewer, and the
// scripts that are content scripts on any other page (an extension page gets none).
async function localViewerHtml() {
  const html = await viewerHtml();
  const files = browser.runtime.getManifest().content_scripts.flatMap(c => c.js).filter(f => f !== 'content.js');
  const tags = [...new Set(files)].map(f => `<script src="${EXT}${f}"></script>`).join('\n    ');
  return html.replace('<script src="' + EXT + 'pdfpage.mjs"', tags + '\n    <script src="' + EXT + 'pdfpage.mjs"');
}

// pdflocal.js: the file the reader handed over (data), or, when the page is
// opened again (a reload, other settings), whether its bytes are still here.
export async function local({ data, name }, sender) {
  const url = sender.url, tabId = sender.tab?.id ?? -1, frameId = sender.frameId ?? 0;
  if (!url?.startsWith(LOCAL)) return null;
  let load = [...loads].reverse().find(l => l.url === url && l.tabId === tabId);
  if (data) {
    const bytes = new Uint8Array(data);
    load = { url, tabId, frameId, filename: String(name || 'document.pdf'), length: bytes.byteLength,
      chunks: [bytes], size: bytes.byteLength, done: true, failed: false, ports: new Set() };
    loads.push(load);
    if (loads.length > 20) loads.splice(0, loads.length - 20).forEach(l => l.ports.size || (l.chunks = []));
  }
  if (!load || !load.done || !load.size) return null;
  return localViewerHtml();
}

// Is this the viewer page served for a PDF at this address, in this tab and frame?
export function verify(token, sender) {
  if (token !== TOKEN) return false;
  const tab = sender.tab?.id, frame = sender.frameId ?? 0;
  return loads.some(l => l.url === sender.url && (tab == null || l.tabId < 0 || (l.tabId === tab && l.frameId === frame)));
}

// "Save" in the viewer: the PDF as the viewer has it (with any annotations the
// reader added), under its name, through the browser's normal download flow.
export async function download({ data, filename }) {
  // only ever a PDF, under a PDF's name
  const head = new Uint8Array(data, 0, Math.min(1024, data.byteLength));
  if (!new TextDecoder('latin1').decode(head).includes('%PDF-')) return;
  filename = String(filename || 'document.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_');
  if (!/\.pdf$/i.test(filename)) filename += '.pdf';
  const blob = new Blob([data], { type: 'application/pdf' });
  const href = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url: href, filename: filename || 'document.pdf' });
  } finally {
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }
}
