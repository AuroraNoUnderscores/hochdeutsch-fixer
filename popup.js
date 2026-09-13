const $ = id => document.getElementById(id);
let host = null;

async function refresh() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let page = null;
  try { page = await browser.tabs.sendMessage(tab.id, 'hd-status'); } catch {}
  let llm = null, tab_ = null;
  try { llm = await browser.runtime.sendMessage({ type: 'llm-status' }); } catch {}
  try { tab_ = await browser.runtime.sendMessage({ type: 'tab-count', tabId: tab.id }); } catch {}
  const s = await browser.storage.local.get(['enabled', 'disabledSites', 'mode', 'llm', 'highlight']);

  $('enabled').checked = s.enabled !== false;
  $('mode').value = s.mode || 'hamburg';
  $('llm').checked = s.llm !== false;
  $('highlight').checked = !!s.highlight;
  showChanges(tab_);

  if (page) {
    host = page.host;
    $('site-label').textContent = host;
    $('site').checked = !(s.disabledSites || []).includes(host);
    const n = tab_ ? tab_.count : page.count;
    const inFrames = tab_ && tab_.frames > 1 ? ` in ${tab_.frames} frames` : '';
    $('count').textContent = !page.active ? 'Off on this page'
      : page.meta ? 'Page is about language — left as is'
      : `${n} replacement${n === 1 ? '' : 's'} on this page${inFrames}`;
  } else {
    $('site-row').hidden = true;
    $('count').textContent = tab_ && tab_.count
      ? `${tab_.count} replacement${tab_.count === 1 ? '' : 's'} in this tab`
      : 'Not available on this page.';
  }

  const bar = $('bar');
  bar.hidden = true;
  if (s.llm === false) $('llm-status').textContent = 'Model off — rules only.';
  else if (!llm || llm.status === 'idle') $('llm-status').textContent = 'Model loads when a page needs it.';
  else if (llm.status === 'loading') {
    $('llm-status').textContent = `Downloading model… ${llm.progress}%`;
    bar.hidden = false;
    bar.firstElementChild.style.width = `${llm.progress}%`;
  } else if (llm.status === 'error') $('llm-status').textContent = `Model error: ${llm.error}`;
  else $('llm-status').textContent = `Model ready — ${llm.decided} decision${llm.decided === 1 ? '' : 's'} made.`;

  // What the model recently did, so its calls can be checked rather than guessed at.
  $('log').replaceChildren(...(llm?.log || []).map(d => {
    const row = document.createElement('div');
    if (d.kept) row.className = 'kept';
    row.append(d.kept ? 'kept ' : '', Object.assign(document.createElement('b'), { textContent: d.kept ? d.from : d.to }));
    row.append(d.kept ? ` over ${d.to} (${d.margin})` : ` for ${d.from} (${d.margin})`);
    return row;
  }));
}

// Every word changed on the page (all frames), and the words the model kept
// because they are part of a name. Rebuilt only when it differs, so the list
// keeps its scroll position between refreshes.
let shownChanges = '';
function showChanges(total) {
  const box = $('changes');
  if (box.hidden) return;
  const changes = total?.changes || [], names = total?.names || [];
  const sig = JSON.stringify([changes, names]);
  if (sig === shownChanges) return;
  shownChanges = sig;
  const row = (words, n) => {
    const div = document.createElement('div');
    const w = document.createElement('span');
    w.className = 'words';
    w.append(...words);
    w.title = w.textContent;
    div.append(w, Object.assign(document.createElement('span'), { className: 'n', textContent: n > 1 ? `×${n}` : '' }));
    return div;
  };
  const items = [];
  if (!changes.length && !names.length)
    items.push(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Nothing changed on this page.' }));
  if (changes.length) {
    items.push(Object.assign(document.createElement('h4'), { textContent: 'Changed' }));
    for (const [from, to, n] of changes)
      items.push(row([Object.assign(document.createElement('s'), { textContent: from || '∅' }), ' → ',
                      Object.assign(document.createElement('b'), { textContent: to || '∅' })], n));
  }
  if (names.length) {
    items.push(Object.assign(document.createElement('h4'), { textContent: 'Kept as names' }));
    for (const [word, n] of names) items.push(row([word], n));
  }
  box.replaceChildren(...items);
}

const later = () => setTimeout(refresh, 150);

$('show-changes').onclick = e => {
  const open = $('changes').hidden;
  $('changes').hidden = !open;
  e.target.setAttribute('aria-pressed', open);
  e.target.textContent = open ? 'Hide changed words' : 'Show changed words';
  shownChanges = '';
  refresh();
};
$('highlight').onchange = e => browser.storage.local.set({ highlight: e.target.checked }).then(later);

$('enabled').onchange = e => browser.storage.local.set({ enabled: e.target.checked }).then(later);
$('mode').onchange = e => browser.storage.local.set({ mode: e.target.value }).then(later);
$('llm').onchange = async e => {
  await browser.storage.local.set({ llm: e.target.checked });
  if (e.target.checked) browser.runtime.sendMessage({ type: 'llm-load' }).catch(() => {});
  later();
};
$('site').onchange = async e => {
  const { disabledSites = [] } = await browser.storage.local.get('disabledSites');
  const sites = disabledSites.filter(h => h !== host);
  if (!e.target.checked) sites.push(host);
  await browser.storage.local.set({ disabledSites: sites });
  later();
};

refresh();
setInterval(refresh, 1000);
