// The baby models, run locally via transformers.js on WASM. Neither writes text.
//
// - eszett: German DistilBERT fine-tuned on one job, deciding for every "ss" in
//   Swiss text whether German spells it ß (training/). Bundled in models/.
// - the general model: the same base model untouched, which ranks the few
//   remaining candidates (article forms, wording) by how natural they sound.
import { AutoTokenizer, AutoModelForMaskedLM, AutoModelForTokenClassification, Tensor, env } from './vendor/transformers.min.js';

export const MODEL = 'onnx-community/distilbert-base-german-cased-ONNX';
export const ESZETT = 'hdfx-eszett';
const BATCH = 24;

// The fine-tuned model ships inside the extension; the general one downloads.
env.allowLocalModels = true;
// Root-relative on purpose: transformers.js skips its local lookup for absolute
// http(s) paths, and extension pages resolve "/models/" inside the extension.
env.localModelPath = '/models/';
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('./vendor/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
  wasm: new URL('./vendor/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
};

let loading = null;

export function load(onProgress = () => {}) {
  loading ??= (async () => {
    const opts = { progress_callback: onProgress };
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL, opts);
    const model = await AutoModelForMaskedLM.from_pretrained(MODEL, { ...opts, dtype: 'q8', device: 'wasm' });
    return { tokenizer, model };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// Pseudo-log-likelihood of each text (Salazar et al. 2020): mask each token in
// turn and sum log P(token | rest). Only tokens in and next to the region where
// the candidates differ are scored; the shared rest contributes about equally.
export async function score(texts) {
  const { tokenizer, model } = await load();
  const ids = texts.map(t => Array.from(tokenizer(t).input_ids.data, Number));
  const first = ids[0], minLen = Math.min(...ids.map(a => a.length));
  let pre = 0;
  while (pre < minLen && ids.every(a => a[pre] === first[pre])) pre++;
  let suf = 0;
  while (suf < minLen - pre && ids.every(a => a[a.length - 1 - suf] === first[first.length - 1 - suf])) suf++;

  const jobs = []; // [candidate, position]
  ids.forEach((a, k) => {
    const from = Math.max(1, pre - 1), to = Math.min(a.length - 1, a.length - suf + 1);
    for (let i = from; i < to; i++) jobs.push([k, i]);
  });

  const scores = texts.map(() => 0);
  for (let b = 0; b < jobs.length; b += BATCH) {
    const chunk = jobs.slice(b, b + BATCH);
    const T = Math.max(...chunk.map(([k]) => ids[k].length));
    const input = new BigInt64Array(chunk.length * T), mask = new BigInt64Array(chunk.length * T);
    chunk.forEach(([k, pos], r) => {
      ids[k].forEach((id, i) => {
        input[r * T + i] = BigInt(i === pos ? tokenizer.mask_token_id : id);
        mask[r * T + i] = 1n;
      });
    });
    const { logits } = await model({
      input_ids: new Tensor('int64', input, [chunk.length, T]),
      attention_mask: new Tensor('int64', mask, [chunk.length, T]),
    });
    const V = logits.dims[2], L = logits.data;
    chunk.forEach(([k, pos], r) => {
      const off = (r * T + pos) * V;
      let max = -Infinity;
      for (let j = 0; j < V; j++) if (L[off + j] > max) max = L[off + j];
      let sum = 0;
      for (let j = 0; j < V; j++) sum += Math.exp(L[off + j] - max);
      scores[k] += L[off + ids[k][pos]] - max - Math.log(sum);
    });
  }
  return scores;
}

let eszettLoading = null;

export function loadEszett() {
  eszettLoading ??= (async () => {
    const tokenizer = await AutoTokenizer.from_pretrained(ESZETT);
    const model = await AutoModelForTokenClassification.from_pretrained(ESZETT, { dtype: 'q8', device: 'wasm' });
    return { tokenizer, model };
  })();
  eszettLoading.catch(() => { eszettLoading = null; });
  return eszettLoading;
}

// Where each WordPiece token sits in the text. The tokenizer is cased and does
// not strip accents, so every token is a substring of the text; transformers.js
// has no offset mapping, so it is rebuilt here (and checked against Python's in
// dev/offsets.html).
// Whitespace, Unicode punctuation, and the ASCII symbols BERT also counts as punctuation.
const BERT_SPLIT = /[\s\p{P}!-\/:-@\[-`{-~]/u;

export function alignTokens(text, tokens) {
  const out = [];
  let pos = 0;
  for (const t of tokens) {
    if (t === '[UNK]') {
      // An unknown word is one BERT pre-token: a run up to whitespace or any
      // punctuation, which BERT always splits off ("cm³" in "500-cm³-Klasse").
      while (pos < text.length && /\s/.test(text[pos])) pos++;
      let end = pos + 1;
      while (end < text.length && !BERT_SPLIT.test(text[end])) end++;
      out.push([pos, end]);
      pos = end;
      continue;
    }
    const piece = t.startsWith('##') ? t.slice(2) : t;
    let at = text.startsWith(piece, pos) ? pos : text.indexOf(piece, pos);
    // only whitespace may be skipped between tokens; anything else means lost sync
    if (at < 0 || /\S/.test(text.slice(pos, at))) { out.push(null); continue; }
    out.push([at, at + piece.length]);
    pos = at + piece.length;
  }
  return out;
}

// Chunks of at most ~1200 characters, cut at sentence ends, so long text stays
// within the model's 512 tokens.
function chunks(text) {
  const out = [];
  let start = 0;
  const ends = [...text.matchAll(/[.!?]\s+/g)].map(m => m.index + m[0].length);
  let last = 0;
  for (const end of [...ends, text.length]) {
    if (end - start > 1200 && last > start) { out.push([start, last]); start = last; }
    last = end;
  }
  if (start < text.length) out.push([start, text.length]);
  return out;
}

// Output columns 2-6 of a model trained with names (training/names_data.py).
export const NAME_KINDS = ['O', 'PER', 'ORG', 'LOC', 'OTH'];

// One pass over the text answers two questions:
// - ss: probability that the "ss" starting at each offset is ß in German spelling
// - names: for each [start, end) span, how likely it is part of a name and which
//   kind ({ p, kind }), from the word's most name-like token
// null where the text could not be aligned (the rules decide those), and names
// is null altogether for a model trained without them.
export async function eszett(text, offsets, wordSpans = []) {
  const { tokenizer, model } = await loadEszett();
  const probs = offsets.map(() => null);
  const names = wordSpans.map(() => null);
  let hasNames = false;
  for (const [a, b] of chunks(text)) {
    const want = offsets.map((o, k) => [o, k]).filter(([o]) => o >= a && o < b);
    const wantSpans = wordSpans.map((s, k) => [s, k]).filter(([s]) => s[0] >= a && s[1] <= b);
    if (!want.length && !wantSpans.length) continue;
    const piece = text.slice(a, b);
    const tokens = tokenizer.tokenize(piece);
    const enc = tokenizer(piece, { truncation: true, max_length: 512 });
    if (enc.input_ids.dims[1] !== tokens.length + 2) continue;   // truncated: leave to the rules
    const spans = alignTokens(piece, tokens);
    const { logits } = await model(enc);
    const L = logits.data, C = logits.dims[2];
    for (const [o, k] of want) {
      const rel = o - a;
      const t = spans.findIndex(s => s && s[0] <= rel && rel < s[1]);
      if (t < 0) continue;
      const i = (t + 1) * C;                                     // +1 for [CLS]
      const e0 = Math.exp(L[i]), e1 = Math.exp(L[i + 1]);
      probs[k] = e1 / (e0 + e1);
    }
    if (C < 2 + NAME_KINDS.length) continue;
    hasNames = true;
    for (const [[s0, s1], k] of wantSpans) {
      let best = null;
      spans.forEach((s, t) => {
        if (!s || s[1] <= s0 - a || s[0] >= s1 - a) return;
        const i = (t + 1) * C + 2;
        const top = Math.max(...NAME_KINDS.map((_, c) => L[i + c]));
        const e = NAME_KINDS.map((_, c) => Math.exp(L[i + c] - top));
        const sum = e.reduce((x, y) => x + y, 0);
        const p = 1 - e[0] / sum;
        if (!best || p > best.p) best = { p, kind: NAME_KINDS[1 + e.slice(1).indexOf(Math.max(...e.slice(1)))] };
      });
      names[k] = best;
    }
  }
  return { ss: probs, names: hasNames ? names : null };
}
