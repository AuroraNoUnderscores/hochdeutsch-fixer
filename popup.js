const $ = id => document.getElementById(id);
let host = null;

async function refresh() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let page = null;
  try { page = await browser.tabs.sendMessage(tab.id, 'hd-status'); } catch {}
  let llm = null, tab_ = null;
  try { llm = await browser.runtime.sendMessage({ type: 'llm-status' }); } catch {}
  try { tab_ = await browser.runtime.sendMessage({ type: 'tab-count', tabId: tab.id }); } catch {}
  const s = await browser.storage.local.get(['enabled', 'disabledSites', 'mode', 'llm']);

  $('enabled').checked = s.enabled !== false;
  $('mode').value = s.mode || 'hamburg';
  $('llm').checked = s.llm !== false;

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
}

const later = () => setTimeout(refresh, 150);

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
